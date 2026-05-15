/** @jest-environment jsdom */

import { TextDecoder, TextEncoder } from 'util';
import type { PiiSpan } from '../../src/shared/message-types';

(global as unknown as { TextEncoder: typeof TextEncoder }).TextEncoder = TextEncoder;
(global as unknown as { TextDecoder: typeof TextDecoder }).TextDecoder = TextDecoder;

const { ReviewOverlay } = require('../../src/ui/overlay/overlay') as typeof import('../../src/ui/overlay/overlay');

describe('ReviewOverlay cancellation', () => {
  const originalAttachShadow = HTMLElement.prototype.attachShadow;

  beforeEach(() => {
    document.body.innerHTML = '';
    jest
      .spyOn(HTMLElement.prototype, 'attachShadow')
      .mockImplementation(function attachOpenShadow(
        this: HTMLElement,
        init: ShadowRootInit,
      ): ShadowRoot {
        return originalAttachShadow.call(this, { ...init, mode: 'open' });
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function callbacks() {
    return {
      onConfirm: jest.fn(),
      onPasteOriginal: jest.fn(),
      onCancel: jest.fn(),
      onFeedback: jest.fn(),
      onAddToAllowlist: jest.fn(),
      onEditDetails: jest.fn(),
    };
  }

  const spans: PiiSpan[] = [
    { start: 0, end: 3, entity_type: 'PERSON', score: 0.99, text: 'Ada', source: 'manual' },
  ];

  it('routes Escape through cancel rather than immediate paste-original', () => {
    const cb = callbacks();
    const overlay = new ReviewOverlay('Ada secret', spans, cb, 0.5);
    overlay.show();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(cb.onCancel).toHaveBeenCalledTimes(1);
    expect(cb.onPasteOriginal).not.toHaveBeenCalled();
    expect(document.getElementById('pg-review-overlay-host')).toBeNull();
  });

  it('routes a model.cancel() (close button / programmatic) through onCancel', () => {
    // Note: the X close button is rendered inside the Svelte ReviewOverlay
    // component; in this Jest environment the component is stubbed (see
    // tests/mocks/svelte-component-stub.ts). We exercise the same code
    // path the click handler uses — model.cancel() — to verify the
    // wrapper tears down and forwards onCancel exactly once.
    const cb = callbacks();
    const overlay = new ReviewOverlay('Ada secret', spans, cb, 0.5);
    overlay.show();

    (overlay as unknown as { model: { cancel: () => void } }).model.cancel();

    expect(cb.onCancel).toHaveBeenCalledTimes(1);
    expect(cb.onPasteOriginal).not.toHaveBeenCalled();
    expect(document.getElementById('pg-review-overlay-host')).toBeNull();
  });
});
