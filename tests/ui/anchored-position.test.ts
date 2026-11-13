/** @jest-environment jsdom */

import {
  anchorCenterX,
  anchorShiftX,
  centerOverAnchor,
} from '../../src/ui/shared/anchored-position';

/** jsdom lays nothing out, so geometry is supplied per element. */
function withRect(element: HTMLElement, left: number, width: number): HTMLElement {
  element.getBoundingClientRect = () =>
    ({ left, width, right: left + width, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
  return element;
}

function withWidth(element: HTMLElement, width: number): HTMLElement {
  Object.defineProperty(element, 'offsetWidth', { configurable: true, value: width });
  return element;
}

function mounted(): HTMLElement {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
}

describe('anchored notice position', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    // A 1200px window: its middle is 600.
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1200 });
  });

  describe('anchorCenterX', () => {
    it('is the horizontal middle of the message box', () => {
      // A 260px sidebar pushes an 800px chat column to the right.
      expect(anchorCenterX(withRect(mounted(), 330, 800))).toBe(730);
    });

    it('has no answer without an anchor, or for one that left the page', () => {
      const detached = withRect(document.createElement('div'), 330, 800);

      expect(anchorCenterX(null)).toBeNull();
      expect(anchorCenterX(undefined)).toBeNull();
      expect(anchorCenterX(detached)).toBeNull();
    });

    it('has no answer for an anchor with no width or outside the window', () => {
      expect(anchorCenterX(withRect(mounted(), 330, 0))).toBeNull();
      expect(anchorCenterX(withRect(mounted(), -900, 800))).toBeNull();
      expect(anchorCenterX(withRect(mounted(), 1300, 400))).toBeNull();
    });
  });

  describe('anchorShiftX', () => {
    it('moves a small surface all the way over the message box', () => {
      // Window middle 600, message box middle 730.
      expect(anchorShiftX(300, withRect(mounted(), 330, 800))).toBe(130);
    });

    it('moves a wide dialog only as far as keeps its margin to the window edge', () => {
      // A 1000px dialog can centre no further right than 1200 - 500 - 24.
      expect(anchorShiftX(1000, withRect(mounted(), 330, 800), 24)).toBe(76);
    });

    it('moves left when the message box is left of the middle', () => {
      expect(anchorShiftX(300, withRect(mounted(), 100, 400))).toBe(-300);
    });

    it('does not move a dialog that already fills the window', () => {
      expect(anchorShiftX(1160, withRect(mounted(), 330, 800), 24)).toBe(0);
    });

    it('does not move without a usable anchor', () => {
      expect(anchorShiftX(300, null)).toBe(0);
      expect(anchorShiftX(300, withRect(document.createElement('div'), 330, 800))).toBe(0);
    });
  });

  describe('centerOverAnchor', () => {
    it('moves the notice over the message box instead of the middle of the window', () => {
      const notice = withWidth(mounted(), 300);

      centerOverAnchor(notice, withRect(mounted(), 330, 800));

      expect(notice.style.left).toBe('730px');
    });

    it('keeps a notice fully on screen when the message box hugs an edge', () => {
      const notice = withWidth(mounted(), 300);

      centerOverAnchor(notice, withRect(mounted(), 1000, 190));
      // Centre 1095 would overflow: 1200 - 150 - 16 margin.
      expect(notice.style.left).toBe('1034px');

      centerOverAnchor(notice, withRect(mounted(), 0, 100));
      // Centre 50 would overflow on the left: 150 + 16 margin.
      expect(notice.style.left).toBe('166px');
    });

    it('leaves the stylesheet centring in charge when there is nothing to anchor to', () => {
      const notice = withWidth(mounted(), 300);
      notice.style.left = '730px';

      centerOverAnchor(notice, null);

      expect(notice.style.left).toBe('');
    });

    it('does not fight a notice wider than the window', () => {
      const notice = withWidth(mounted(), 1400);

      centerOverAnchor(notice, withRect(mounted(), 330, 800));

      expect(notice.style.left).toBe('730px');
    });

    it('tolerates a missing notice', () => {
      expect(() => centerOverAnchor(null, withRect(mounted(), 330, 800))).not.toThrow();
    });
  });
});
