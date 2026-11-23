/** @jest-environment jsdom */

import { TextDecoder, TextEncoder } from 'util';
import { get } from 'svelte/store';
import type { PiiSpan } from '../../src/shared/message-types';

(global as unknown as { TextEncoder: typeof TextEncoder }).TextEncoder = TextEncoder;
(global as unknown as { TextDecoder: typeof TextDecoder }).TextDecoder = TextDecoder;

const { OverlayModel } = require('../../src/ui/overlay/overlay-model') as typeof import('../../src/ui/overlay/overlay-model');

const TEXT = 'Ada wrote to bob@example.com from Kiel';

const spans: PiiSpan[] = [
  { start: 0, end: 3, entity_type: 'PERSON', score: 0.99, text: 'Ada', source: 'ner' },
  { start: 13, end: 28, entity_type: 'EMAIL', score: 0.95, text: 'bob@example.com', source: 'regex' },
  // Below the 0.5 threshold: listed, but not ticked when the pop-up opens.
  { start: 34, end: 38, entity_type: 'LOCATION', score: 0.3, text: 'Kiel', source: 'ner' },
];

function callbacks() {
  return {
    onConfirm: jest.fn(),
    onPasteOriginal: jest.fn(),
    onCancel: jest.fn(),
    onFeedback: jest.fn(),
    onAddToAllowlist: jest.fn(),
    onEditDetails: jest.fn(),
    onSetAutoMode: jest.fn(),
  };
}

function model(cb = callbacks(), options: { context?: 'paste' | 'replaced'; autoMode?: boolean } = {}) {
  return { cb, model: new OverlayModel(TEXT, spans, cb, 0.5, undefined, undefined, options) };
}

describe('review pop-up: "Auto-mode"', () => {
  it('starts off for a held paste unless told otherwise', () => {
    expect(get(model().model.autoMode)).toBe(false);
    expect(get(model(callbacks(), { autoMode: true }).model.autoMode)).toBe(true);
  });

  it('applies the switch at once, in both directions', () => {
    const { cb, model: m } = model();

    m.setAutoMode(true);
    expect(get(m.autoMode)).toBe(true);
    expect(cb.onSetAutoMode).toHaveBeenLastCalledWith(true);

    m.setAutoMode(false);
    expect(get(m.autoMode)).toBe(false);
    expect(cb.onSetAutoMode).toHaveBeenLastCalledWith(false);
    expect(cb.onSetAutoMode).toHaveBeenCalledTimes(2);
  });

  it('does not report a switch that did not move', () => {
    const { cb, model: m } = model();

    m.setAutoMode(false);

    expect(cb.onSetAutoMode).not.toHaveBeenCalled();
  });

  it('leaves the paste itself undecided', () => {
    const { cb, model: m } = model();

    m.setAutoMode(true);

    expect(cb.onConfirm).not.toHaveBeenCalled();
    expect(cb.onPasteOriginal).not.toHaveBeenCalled();
    expect(cb.onCancel).not.toHaveBeenCalled();
    expect(m.isDestroyed()).toBe(false);
  });

  it('tolerates a caller that does not listen for the switch', () => {
    const { onSetAutoMode: _unused, ...withoutListener } = callbacks();
    const m = new OverlayModel(TEXT, spans, withoutListener, 0.5);

    expect(() => m.setAutoMode(true)).not.toThrow();
    expect(get(m.autoMode)).toBe(true);
  });
});

describe('review pop-up: knowing whether anything was changed', () => {
  it('opens unchanged', () => {
    const { model: m } = model();

    expect(m.hasChanges()).toBe(false);
  });

  it('counts unticking, ticking, retyping and marking by hand as changes', () => {
    const untick = model().model;
    untick.toggle(0, false);
    expect(untick.hasChanges()).toBe(true);

    const tick = model().model;
    tick.toggle(2, true);
    expect(tick.hasChanges()).toBe(true);

    const retype = model().model;
    retype.retype(0, 'ORGANIZATION');
    expect(retype.hasChanges()).toBe(true);

    const mark = model().model;
    mark.addManual('wrote', 'MISC');
    expect(mark.hasChanges()).toBe(true);
  });

  it('is unchanged again once a change is taken back', () => {
    const { model: m } = model();

    m.toggle(0, false);
    m.toggle(0, true);

    expect(m.hasChanges()).toBe(false);
  });
});

describe('review pop-up: the main button', () => {
  it('replaces and pastes a held paste', () => {
    const { cb, model: m } = model();

    m.primary();

    expect(cb.onConfirm).toHaveBeenCalledTimes(1);
    expect(cb.onConfirm.mock.calls[0][0].map((s: PiiSpan) => s.text)).toEqual(['Ada', 'bob@example.com']);
    expect(cb.onCancel).not.toHaveBeenCalled();
  });

  it('keeps an automatic replacement when nothing was changed', () => {
    // The replaced text is already in the message box. With nothing to apply
    // there is nothing to swap, so the pop-up just closes.
    const { cb, model: m } = model(callbacks(), { context: 'replaced', autoMode: true });

    m.primary();

    expect(cb.onCancel).toHaveBeenCalledTimes(1);
    expect(cb.onConfirm).not.toHaveBeenCalled();
    expect(cb.onPasteOriginal).not.toHaveBeenCalled();
  });

  it('applies the new selection to an automatic replacement once something was changed', () => {
    const { cb, model: m } = model(callbacks(), { context: 'replaced', autoMode: true });

    m.toggle(1, false);
    m.primary();

    expect(cb.onConfirm).toHaveBeenCalledTimes(1);
    expect(cb.onConfirm.mock.calls[0][0].map((s: PiiSpan) => s.text)).toEqual(['Ada']);
    expect(cb.onCancel).not.toHaveBeenCalled();
  });

  it('restores the original through the second button in either context', () => {
    const held = model();
    held.model.pasteOriginal();
    expect(held.cb.onPasteOriginal).toHaveBeenCalledTimes(1);

    const replaced = model(callbacks(), { context: 'replaced' });
    replaced.model.pasteOriginal();
    expect(replaced.cb.onPasteOriginal).toHaveBeenCalledTimes(1);
  });
});

describe('review pop-up: a value that appears more than once', () => {
  const REPEATED = 'Ada met Ada, then Ada left Kiel';
  const repeated: PiiSpan[] = [
    { start: 0, end: 3, entity_type: 'PERSON', score: 0.99, text: 'Ada', source: 'ner' },
    // The model was unsure about this occurrence of the same name.
    { start: 8, end: 11, entity_type: 'PERSON', score: 0.3, text: 'Ada', source: 'ner' },
    { start: 18, end: 21, entity_type: 'PERSON', score: 0.9, text: 'Ada', source: 'ner' },
    { start: 27, end: 31, entity_type: 'LOCATION', score: 0.8, text: 'Kiel', source: 'ner' },
  ];

  function repeatedModel(cb = callbacks()) {
    return { cb, m: new OverlayModel(REPEATED, repeated, cb, 0.5) };
  }

  it('lists it once and counts it once', () => {
    const { m } = repeatedModel();
    expect(get(m.mainIndices)).toEqual([0, 3]);
    expect(get(m.totalCount)).toBe(2);
    expect(get(m.enabledCount)).toBe(2);
    expect(m.occurrences(0)).toBe(3);
    expect(m.occurrences(3)).toBe(1);
    expect(m.groupScore(0)).toBe(0.99);
  });

  it('ticks every occurrence when one of them is confident enough', () => {
    const { m } = repeatedModel();
    expect(get(m.spanStates).map((s) => s.enabled)).toEqual([true, true, true, true]);
    expect(m.isBelowThreshold(get(m.spanStates)[0])).toBe(false);
  });

  it('applies one untick to every occurrence', () => {
    const { m, cb } = repeatedModel();
    m.toggle(0, false);
    expect(get(m.spanStates).map((s) => s.enabled)).toEqual([false, false, false, true]);
    m.confirm();
    expect(cb.onConfirm.mock.calls[0][0].map((s: PiiSpan) => s.text)).toEqual(['Kiel']);
  });

  it('retypes every occurrence and reports the correction once', () => {
    const { m, cb } = repeatedModel();
    m.retype(0, 'ORGANIZATION');
    expect(get(m.spanStates).map((s) => s.entityType)).toEqual([
      'ORGANIZATION', 'ORGANIZATION', 'ORGANIZATION', 'LOCATION',
    ]);
    expect(cb.onFeedback).toHaveBeenCalledTimes(1);
  });

  it('dismisses every occurrence as not personal data', () => {
    const { m, cb } = repeatedModel();
    m.openDismissMenu(0, { top: 0, right: 0, bottom: 0, left: 0 });
    m.confirmDismiss('value');
    expect(get(m.spanStates).slice(0, 3).every((s) => !s.enabled && s.whitelisted)).toBe(true);
    expect(cb.onAddToAllowlist).toHaveBeenCalledTimes(1);
  });

  it('keeps the same text under different types as separate rows', () => {
    const mixed: PiiSpan[] = [
      { start: 0, end: 3, entity_type: 'PERSON', score: 0.9, text: 'Ada', source: 'ner' },
      { start: 8, end: 11, entity_type: 'ORGANIZATION', score: 0.9, text: 'Ada', source: 'ner' },
    ];
    const m = new OverlayModel(REPEATED, mixed, callbacks(), 0.5);
    expect(get(m.mainIndices)).toEqual([0, 1]);
  });

  it('unticks the whole group only when the slider passes every occurrence', () => {
    const { m } = repeatedModel();
    m.setThreshold(0.95);
    expect(get(m.spanStates).map((s) => s.enabled)).toEqual([true, true, true, false]);
    m.setThreshold(1);
    expect(get(m.spanStates).map((s) => s.enabled)).toEqual([false, false, false, false]);
  });
});
