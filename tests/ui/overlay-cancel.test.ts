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

  describe('Enter', () => {
    // Each pop-up listens on the document until it is closed; one left open
    // by an earlier case would answer the next case's key press.
    const open: Array<{ destroy: () => void }> = [];
    const show = (cb: ReturnType<typeof callbacks>): void => {
      const overlay = new ReviewOverlay('Ada secret', spans, cb, 0.5);
      overlay.show();
      open.push(overlay);
    };
    afterEach(() => {
      for (const overlay of open.splice(0)) overlay.destroy();
    });

    /** A control inside the pop-up, standing in for the stubbed component. */
    function controlInside(html: string): HTMLElement {
      const host = document.getElementById('pg-review-overlay-host')!;
      const holder = document.createElement('div');
      holder.innerHTML = html;
      const control = holder.firstElementChild as HTMLElement;
      host.shadowRoot!.append(control);
      return control;
    }

    const pressEnter = (): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
      document.dispatchEvent(event);
      return event;
    };

    it('confirms the pop-up while focus is not on one of its controls', () => {
      const cb = callbacks();
      show(cb);

      const event = pressEnter();

      expect(cb.onConfirm).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it.each([
      ['the second button', '<button type="button" id="pg-paste-original-btn">Restore original</button>'],
      ['the auto-mode switch', '<button type="button" role="switch" aria-checked="false"></button>'],
      ['a type dropdown', '<select><option>PERSON</option></select>'],
      ['a text field', '<input type="text" />'],
    ])('leaves Enter to %s when it has focus', (_name, html) => {
      // Taking Enter here would make it do the opposite of the focused
      // control: "Restore original" would replace and paste.
      const cb = callbacks();
      show(cb);
      controlInside(html).focus();

      const event = pressEnter();

      expect(cb.onConfirm).not.toHaveBeenCalled();
      expect(cb.onCancel).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
      expect(document.getElementById('pg-review-overlay-host')).not.toBeNull();
    });

    it('still closes on Escape whatever has focus', () => {
      const cb = callbacks();
      show(cb);
      controlInside('<button type="button">Restore original</button>').focus();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(cb.onCancel).toHaveBeenCalledTimes(1);
    });
  });
});
