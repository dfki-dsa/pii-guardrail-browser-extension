/** @jest-environment jsdom */

import {
  AutoReplaceToast,
  AUTO_REPLACE_UNDO_FAILED_MESSAGE,
  replacedItemsLabel,
} from '../../src/ui/auto-replace-toast/auto-replace-toast';

describe('AutoReplaceToast', () => {
  const originalAttachShadow = HTMLElement.prototype.attachShadow;

  beforeEach(() => {
    jest.useFakeTimers();
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
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function getHost(): HTMLElement | null {
    return document.getElementById('pg-auto-replace-toast-host');
  }

  function button(id: string): HTMLButtonElement {
    return getHost()?.shadowRoot?.querySelector(`#${id}`) as HTMLButtonElement;
  }

  function root(): HTMLElement {
    return getHost()?.shadowRoot?.querySelector('.pg-toast') as HTMLElement;
  }

  /** Let an awaited callback inside a click handler run to completion. */
  async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  const callbacks = (overrides = {}) => ({
    onUndo: jest.fn().mockResolvedValue(true),
    onReview: jest.fn(),
    ...overrides,
  });

  it('says how many items were replaced and offers Review and Undo', () => {
    new AutoReplaceToast('dark', 3, callbacks()).show();

    expect(getHost()?.shadowRoot?.textContent).toContain('3 items replaced');
    expect(button('pg-auto-review-btn').textContent).toBe('Review');
    expect(button('pg-auto-undo-btn').textContent).toBe('Undo');
    expect(root().classList.contains('pg-design-surface')).toBe(true);
    expect(root().getAttribute('role')).toBe('status');
  });

  it('counts a single item in the singular', () => {
    expect(replacedItemsLabel(1)).toBe('1 item replaced');
    expect(replacedItemsLabel(2)).toBe('2 items replaced');
  });

  it('applies the requested theme', () => {
    new AutoReplaceToast('light', 1, callbacks()).show();

    expect(root().getAttribute('data-theme')).toBe('light');
  });

  it('opens the review exactly once and leaves', () => {
    const cbs = callbacks();
    new AutoReplaceToast('dark', 2, cbs).show();
    const review = button('pg-auto-review-btn');

    review.click();
    review.click();

    expect(cbs.onReview).toHaveBeenCalledTimes(1);
    expect(getHost()).toBeNull();
  });

  it('confirms a successful undo and then leaves', async () => {
    const cbs = callbacks();
    new AutoReplaceToast('dark', 2, cbs).show();

    button('pg-auto-undo-btn').click();
    await flush();

    expect(cbs.onUndo).toHaveBeenCalledTimes(1);
    expect(getHost()?.shadowRoot?.textContent).toContain('Original restored');
    expect(root().getAttribute('data-state')).toBe('done');
    expect(button('pg-auto-undo-btn').hidden).toBe(true);
    expect(button('pg-auto-review-btn').hidden).toBe(true);

    jest.advanceTimersByTime(1800);
    expect(getHost()).toBeNull();
  });

  it('says so when the original could not be restored, and stays up long enough to read', async () => {
    const cbs = callbacks({ onUndo: jest.fn().mockResolvedValue(false) });
    new AutoReplaceToast('dark', 2, cbs).show();

    button('pg-auto-undo-btn').click();
    await flush();

    expect(getHost()?.shadowRoot?.textContent).toContain(AUTO_REPLACE_UNDO_FAILED_MESSAGE);
    expect(root().getAttribute('data-state')).toBe('failed');

    jest.advanceTimersByTime(4999);
    expect(getHost()).not.toBeNull();
    jest.advanceTimersByTime(1);
    expect(getHost()).toBeNull();
  });

  it('treats an undo that throws as not restored', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const cbs = callbacks({ onUndo: jest.fn().mockRejectedValue(new Error('boom')) });
    new AutoReplaceToast('dark', 2, cbs).show();

    button('pg-auto-undo-btn').click();
    await flush();

    expect(root().getAttribute('data-state')).toBe('failed');
  });

  it('runs undo once however often the button is clicked', async () => {
    const cbs = callbacks();
    new AutoReplaceToast('dark', 2, cbs).show();
    const undo = button('pg-auto-undo-btn');

    undo.click();
    undo.click();
    button('pg-auto-review-btn').click();
    await flush();

    expect(cbs.onUndo).toHaveBeenCalledTimes(1);
    expect(cbs.onReview).not.toHaveBeenCalled();
  });

  it('keeps the replacement and leaves by itself after ~8 seconds when ignored', () => {
    const onDispose = jest.fn();
    const cbs = callbacks({ onDispose });
    new AutoReplaceToast('dark', 2, cbs).show();

    jest.advanceTimersByTime(7999);
    expect(getHost()).not.toBeNull();
    jest.advanceTimersByTime(1);
    expect(getHost()).toBeNull();
    expect(onDispose).toHaveBeenCalledTimes(1);
    expect(cbs.onUndo).not.toHaveBeenCalled();
    expect(cbs.onReview).not.toHaveBeenCalled();
  });

  it('pauses the countdown while hovered or focused and resumes afterwards', () => {
    new AutoReplaceToast('dark', 2, callbacks()).show();

    jest.advanceTimersByTime(5000);
    root().dispatchEvent(new Event('mouseenter'));
    jest.advanceTimersByTime(60_000);
    expect(getHost()).not.toBeNull();
    root().dispatchEvent(new Event('mouseleave'));

    jest.advanceTimersByTime(5000);
    root().dispatchEvent(new Event('focusin'));
    jest.advanceTimersByTime(60_000);
    expect(getHost()).not.toBeNull();
    root().dispatchEvent(new Event('focusout'));

    jest.advanceTimersByTime(7999);
    expect(getHost()).not.toBeNull();
    jest.advanceTimersByTime(1);
    expect(getHost()).toBeNull();
  });

  it('disposes once and reports it once', () => {
    const onDispose = jest.fn();
    const toast = new AutoReplaceToast('dark', 2, callbacks({ onDispose }));
    toast.show();

    toast.dispose();
    toast.dispose();

    expect(getHost()).toBeNull();
    expect(toast.isMounted()).toBe(false);
    expect(onDispose).toHaveBeenCalledTimes(1);
  });

  it('does not touch the page if disposed while an undo is still running', async () => {
    let finish: (restored: boolean) => void = () => undefined;
    const cbs = callbacks({
      onUndo: jest.fn(() => new Promise<boolean>((resolve) => { finish = resolve; })),
    });
    const toast = new AutoReplaceToast('dark', 2, cbs);
    toast.show();

    button('pg-auto-undo-btn').click();
    toast.dispose();
    finish(true);
    await flush();

    expect(getHost()).toBeNull();
  });
});
