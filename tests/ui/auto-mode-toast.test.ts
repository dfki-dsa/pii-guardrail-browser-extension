/** @jest-environment jsdom */

import {
  AutoModeToast,
  replacedItemsLabel,
  skippedItemsLabel,
} from '../../src/ui/auto-mode-toast/auto-mode-toast';

describe('AutoModeToast', () => {
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
    return document.getElementById('pg-auto-mode-toast-host');
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
    new AutoModeToast('dark', { replaced: 3, skipped: 0 }, callbacks()).show();

    const title = getHost()?.shadowRoot?.querySelector('.pg-toast-title')?.textContent;
    expect(title).toBe('3 items replaced');
    expect(getHost()?.shadowRoot?.textContent).toContain('Auto-mode is on');
    expect(button('pg-auto-review-btn').textContent).toBe('Review');
    expect(button('pg-auto-undo-btn').textContent).toBe('Undo');
    expect(root().classList.contains('pg-design-surface')).toBe(true);
    expect(root().getAttribute('role')).toBe('status');
  });

  it('counts a single item in the singular', () => {
    expect(replacedItemsLabel(1)).toBe('1 item replaced');
    expect(replacedItemsLabel(2)).toBe('2 items replaced');
  });

  it('says when detected items were left unreplaced', () => {
    // In the review pop-up those items would have been listed. Auto-mode
    // leaves them alone the same way, but not out of sight.
    new AutoModeToast('dark', { replaced: 3, skipped: 2 }, callbacks()).show();

    expect(getHost()?.shadowRoot?.querySelector('.pg-toast-title')?.textContent).toBe('3 items replaced');
    expect(getHost()?.shadowRoot?.querySelector('.pg-toast-sub')?.textContent).toBe('2 detected items not replaced');
    expect(root().getAttribute('data-state')).toBe('partial');
    expect(skippedItemsLabel(1)).toBe('1 detected item not replaced');
  });

  it('offers Review but no Undo when nothing was replaced', () => {
    new AutoModeToast('dark', { replaced: 0, skipped: 2 }, callbacks()).show();

    expect(getHost()?.shadowRoot?.querySelector('.pg-toast-title')?.textContent).toBe('Nothing replaced');
    expect(button('pg-auto-undo-btn').hidden).toBe(true);
    expect(button('pg-auto-review-btn').hidden).toBe(false);
    expect(replacedItemsLabel(0)).toBe('Nothing replaced');
  });

  it('applies the requested theme', () => {
    new AutoModeToast('light', { replaced: 1, skipped: 0 }, callbacks()).show();

    expect(root().getAttribute('data-theme')).toBe('light');
  });

  it('opens the review exactly once and leaves', () => {
    const cbs = callbacks();
    new AutoModeToast('dark', { replaced: 2, skipped: 0 }, cbs).show();
    const review = button('pg-auto-review-btn');

    review.click();
    review.click();

    expect(cbs.onReview).toHaveBeenCalledTimes(1);
    expect(getHost()).toBeNull();
  });

  it('confirms a successful undo and then leaves', async () => {
    const cbs = callbacks();
    new AutoModeToast('dark', { replaced: 2, skipped: 0 }, cbs).show();

    button('pg-auto-undo-btn').click();
    await flush();

    expect(cbs.onUndo).toHaveBeenCalledTimes(1);
    expect(getHost()?.shadowRoot?.textContent).toContain('Original text restored');
    expect(getHost()?.shadowRoot?.textContent).toContain('Nothing is replaced');
    expect(root().getAttribute('data-state')).toBe('done');
    expect(button('pg-auto-undo-btn').hidden).toBe(true);
    expect(button('pg-auto-review-btn').hidden).toBe(true);

    jest.advanceTimersByTime(1800);
    expect(getHost()).toBeNull();
  });

  it('says so when the original could not be restored, and stays up long enough to read', async () => {
    const cbs = callbacks({ onUndo: jest.fn().mockResolvedValue(false) });
    new AutoModeToast('dark', { replaced: 2, skipped: 0 }, cbs).show();

    button('pg-auto-undo-btn').click();
    await flush();

    expect(getHost()?.shadowRoot?.textContent).toContain("Couldn't restore the original");
    expect(getHost()?.shadowRoot?.textContent).toContain('Nothing was changed.');
    expect(root().getAttribute('data-state')).toBe('failed');

    jest.advanceTimersByTime(4999);
    expect(getHost()).not.toBeNull();
    jest.advanceTimersByTime(1);
    expect(getHost()).toBeNull();
  });

  it('treats an undo that throws as not restored', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const cbs = callbacks({ onUndo: jest.fn().mockRejectedValue(new Error('boom')) });
    new AutoModeToast('dark', { replaced: 2, skipped: 0 }, cbs).show();

    button('pg-auto-undo-btn').click();
    await flush();

    expect(root().getAttribute('data-state')).toBe('failed');
  });

  it('runs undo once however often the button is clicked', async () => {
    const cbs = callbacks();
    new AutoModeToast('dark', { replaced: 2, skipped: 0 }, cbs).show();
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
    new AutoModeToast('dark', { replaced: 2, skipped: 0 }, cbs).show();

    jest.advanceTimersByTime(7999);
    expect(getHost()).not.toBeNull();
    jest.advanceTimersByTime(1);
    expect(getHost()).toBeNull();
    expect(onDispose).toHaveBeenCalledTimes(1);
    expect(cbs.onUndo).not.toHaveBeenCalled();
    expect(cbs.onReview).not.toHaveBeenCalled();
  });

  it('pauses the countdown while hovered or focused and resumes afterwards', () => {
    new AutoModeToast('dark', { replaced: 2, skipped: 0 }, callbacks()).show();

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

  it('centres itself over the message box when given one, and over the window otherwise', () => {
    const composer = document.createElement('div');
    document.body.append(composer);
    composer.getBoundingClientRect = () =>
      ({ left: 330, width: 800, right: 1130, top: 0, bottom: 0, height: 0, x: 330, y: 0, toJSON: () => ({}) }) as DOMRect;

    const anchored = new AutoModeToast('dark', { replaced: 2, skipped: 0 }, callbacks(), composer);
    anchored.show();
    expect(root().style.left).toBe('730px');
    anchored.dispose();

    new AutoModeToast('dark', { replaced: 2, skipped: 0 }, callbacks()).show();
    expect(root().style.left).toBe('');
  });

  it('can be closed by hand, which keeps the replacement', () => {
    const onDispose = jest.fn();
    const cbs = callbacks({ onDispose });
    new AutoModeToast('dark', { replaced: 2, skipped: 0 }, cbs).show();
    const close = button('pg-auto-close-btn');

    expect(close.getAttribute('aria-label')).toBe('Dismiss');
    close.click();

    expect(getHost()).toBeNull();
    expect(onDispose).toHaveBeenCalledTimes(1);
    expect(cbs.onUndo).not.toHaveBeenCalled();
    expect(cbs.onReview).not.toHaveBeenCalled();
  });

  it('disposes once and reports it once', () => {
    const onDispose = jest.fn();
    const toast = new AutoModeToast('dark', { replaced: 2, skipped: 0 }, callbacks({ onDispose }));
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
    const toast = new AutoModeToast('dark', { replaced: 2, skipped: 0 }, cbs);
    toast.show();

    button('pg-auto-undo-btn').click();
    toast.dispose();
    finish(true);
    await flush();

    expect(getHost()).toBeNull();
  });
});
