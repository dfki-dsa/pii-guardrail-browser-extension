/** @jest-environment jsdom */

import { ClipboardToast } from '../../src/ui/clipboard-toast/clipboard-toast';

describe('ClipboardToast', () => {
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
    return document.getElementById('pg-clipboard-toast-host');
  }

  it('renders the prompt copy and a Replace button on show()', () => {
    const toast = new ClipboardToast('dark', { onReplace: jest.fn() });
    toast.show();

    const host = getHost();
    expect(host).not.toBeNull();
    expect(host?.shadowRoot?.textContent).toContain('contains anonymized items');
    expect(host?.shadowRoot?.querySelector('.pg-toast')?.classList.contains('pg-design-surface')).toBe(true);
    expect(host?.shadowRoot?.querySelector('.pg-toast')?.getAttribute('aria-atomic')).toBe('true');
    const btn = host?.shadowRoot?.querySelector('.pg-toast-btn');
    expect(btn?.textContent).toBe('Replace with originals');
  });

  it('applies the requested theme to the toast root', () => {
    const dark = new ClipboardToast('dark', { onReplace: jest.fn() });
    dark.show();
    expect(getHost()?.shadowRoot?.querySelector('.pg-toast')?.getAttribute('data-theme')).toBe('dark');
    dark.dispose();

    const light = new ClipboardToast('light', { onReplace: jest.fn() });
    light.show();
    expect(getHost()?.shadowRoot?.querySelector('.pg-toast')?.getAttribute('data-theme')).toBe('light');
  });

  it('invokes onReplace when the button is clicked and shows the confirmation', () => {
    const onReplace = jest.fn();
    const toast = new ClipboardToast('dark', { onReplace });
    toast.show();

    const btn = getHost()?.shadowRoot?.querySelector('.pg-toast-btn') as HTMLButtonElement;
    btn.click();

    expect(onReplace).toHaveBeenCalledTimes(1);
    expect(getHost()?.shadowRoot?.textContent).toContain('Clipboard replaced');
    expect(btn.hidden).toBe(true);
  });

  it('auto-dismisses after ~6 seconds when ignored', () => {
    const onDispose = jest.fn();
    const toast = new ClipboardToast('dark', { onReplace: jest.fn(), onDispose });
    toast.show();

    expect(getHost()).not.toBeNull();
    jest.advanceTimersByTime(5999);
    expect(getHost()).not.toBeNull();
    jest.advanceTimersByTime(1);
    expect(getHost()).toBeNull();
    expect(onDispose).toHaveBeenCalledTimes(1);
  });

  it('pauses the auto-dismiss while the pointer hovers and resumes on leave', () => {
    const toast = new ClipboardToast('dark', { onReplace: jest.fn() });
    toast.show();
    const toastEl = getHost()?.shadowRoot?.querySelector('.pg-toast') as HTMLElement;

    jest.advanceTimersByTime(3000);
    toastEl.dispatchEvent(new Event('mouseenter'));
    jest.advanceTimersByTime(60_000);
    expect(getHost()).not.toBeNull();

    toastEl.dispatchEvent(new Event('mouseleave'));
    jest.advanceTimersByTime(5999);
    expect(getHost()).not.toBeNull();
    jest.advanceTimersByTime(1);
    expect(getHost()).toBeNull();
  });

  it('disposes immediately when dispose() is called and fires onDispose once', () => {
    const onDispose = jest.fn();
    const toast = new ClipboardToast('dark', { onReplace: jest.fn(), onDispose });
    toast.show();
    toast.dispose();
    expect(getHost()).toBeNull();
    toast.dispose();
    expect(onDispose).toHaveBeenCalledTimes(1);
  });

  it('only one toast is mounted at a time when a second one supersedes', () => {
    const a = new ClipboardToast('dark', { onReplace: jest.fn() });
    a.show();
    const firstHost = getHost();
    expect(firstHost).not.toBeNull();

    a.dispose();
    const b = new ClipboardToast('dark', { onReplace: jest.fn() });
    b.show();
    const hosts = document.querySelectorAll('#pg-clipboard-toast-host');
    expect(hosts.length).toBe(1);
  });

  it('removes the host after the confirmation visible window', () => {
    const toast = new ClipboardToast('dark', { onReplace: jest.fn() });
    toast.show();
    const btn = getHost()?.shadowRoot?.querySelector('.pg-toast-btn') as HTMLButtonElement;
    btn.click();
    expect(getHost()?.shadowRoot?.textContent).toContain('Clipboard replaced');
    jest.advanceTimersByTime(1500);
    expect(getHost()).toBeNull();
  });
});
