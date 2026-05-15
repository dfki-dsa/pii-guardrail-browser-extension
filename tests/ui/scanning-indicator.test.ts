/** @jest-environment jsdom */

import { ScanningIndicator } from '../../src/ui/scanning-indicator/scanning-indicator';

describe('ScanningIndicator', () => {
  const originalAttachShadow = HTMLElement.prototype.attachShadow;
  let attachShadowSpy: jest.SpyInstance<ShadowRoot, [ShadowRootInit]>;

  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '';

    attachShadowSpy = jest
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

  it('mounts a closed-shadow indicator with the tier-1 scanning copy', () => {
    const indicator = new ScanningIndicator();

    indicator.start();

    const host = document.getElementById('pg-scanning-indicator-host') as HTMLElement | null;
    expect(host).not.toBeNull();
    expect(attachShadowSpy).toHaveBeenCalledWith({ mode: 'closed' });

    const shadow = host?.shadowRoot;
    expect(shadow).not.toBeNull();
    expect(shadow?.textContent).toContain('Scanning for personal data');
    expect(shadow?.textContent).toContain('Cancel');
  });

  it('invokes the cancel callback from the indicator action', () => {
    const onCancel = jest.fn();
    const indicator = new ScanningIndicator('dark', onCancel);

    indicator.start();

    const host = document.getElementById('pg-scanning-indicator-host') as HTMLElement | null;
    const cancel = host?.shadowRoot?.querySelector('.pg-cancel') as HTMLButtonElement | null;
    cancel?.click();

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('invokes the cancel callback once when Escape is pressed during scanning', () => {
    const onCancel = jest.fn();
    const indicator = new ScanningIndicator('dark', onCancel);

    indicator.start();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('removes the Escape cancel listener when stopped', () => {
    const onCancel = jest.fn();
    const indicator = new ScanningIndicator('dark', onCancel);

    indicator.start();
    indicator.stop();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(onCancel).not.toHaveBeenCalled();
  });

  it('escalates the copy to tier 2 after 2 seconds', () => {
    const indicator = new ScanningIndicator();

    indicator.start();

    const host = document.getElementById('pg-scanning-indicator-host') as HTMLElement | null;
    const shadow = host?.shadowRoot;

    expect(shadow?.textContent).toContain('Scanning for personal data');

    jest.advanceTimersByTime(2000);

    expect(shadow?.textContent).toContain('Still scanning');
    expect(shadow?.textContent).not.toContain('for personal data');
  });

  it('adds an inline elapsed counter at 15 seconds and updates it in place every second', () => {
    const indicator = new ScanningIndicator();

    indicator.start();

    const host = document.getElementById('pg-scanning-indicator-host') as HTMLElement | null;
    const shadow = host?.shadowRoot;
    const counter = shadow?.querySelector('.pg-counter') as HTMLSpanElement | null;

    jest.advanceTimersByTime(14999);

    expect(shadow?.textContent).not.toContain('· 15s');
    expect(counter?.textContent).toBe('');

    jest.advanceTimersByTime(1);

    expect(shadow?.textContent).toContain('Still scanning');
    expect(shadow?.textContent).toContain('· 15s');

    const sameCounter = shadow?.querySelector('.pg-counter');
    expect(sameCounter).toBe(counter);

    jest.advanceTimersByTime(1000);

    expect(counter?.textContent).toBe(' · 16s');
    expect(shadow?.textContent).toContain('· 16s');
    expect(shadow?.querySelector('.pg-counter')).toBe(counter);

    jest.advanceTimersByTime(44000);

    expect(counter?.textContent).toBe(' · 60s');
    expect(shadow?.textContent).toContain('· 60s');
  });

  it('escalates to a soft-cap warning at 120 seconds while the counter keeps ticking', () => {
    const indicator = new ScanningIndicator();

    indicator.start();

    const host = document.getElementById('pg-scanning-indicator-host') as HTMLElement | null;
    const shadow = host?.shadowRoot;
    const counter = shadow?.querySelector('.pg-counter') as HTMLSpanElement | null;

    jest.advanceTimersByTime(119999);

    expect(shadow?.textContent).toContain('Still scanning');
    expect(shadow?.textContent).not.toContain('This is taking unusually long');
    expect(counter?.textContent).toBe(' · 119s');

    jest.advanceTimersByTime(1);

    expect(shadow?.textContent).toContain('⚠ This is taking unusually long');
    expect(counter?.textContent).toBe(' · 120s');

    jest.advanceTimersByTime(5000);

    expect(shadow?.textContent).toContain('⚠ This is taking unusually long');
    expect(counter?.textContent).toBe(' · 125s');
  });

  it('removes the host element from the DOM when stopped', () => {
    const indicator = new ScanningIndicator();

    indicator.start();
    indicator.stop();

    expect(document.getElementById('pg-scanning-indicator-host')).toBeNull();
  });

  it('cancels the tier-2 timer when stopped before escalation', () => {
    const indicator = new ScanningIndicator();

    indicator.start();
    indicator.stop();

    expect(jest.getTimerCount()).toBe(0);
    expect(() => {
      jest.advanceTimersByTime(60000);
    }).not.toThrow();
    expect(document.getElementById('pg-scanning-indicator-host')).toBeNull();
  });

  it('clears the elapsed counter interval when stopped after tier 3 begins', () => {
    const indicator = new ScanningIndicator();

    indicator.start();
    jest.advanceTimersByTime(15000);

    const host = document.getElementById('pg-scanning-indicator-host') as HTMLElement | null;
    const counter = host?.shadowRoot?.querySelector('.pg-counter') as HTMLSpanElement | null;
    const textBeforeStop = counter?.textContent;

    indicator.stop();

    expect(jest.getTimerCount()).toBe(0);

    jest.advanceTimersByTime(5000);

    expect(document.getElementById('pg-scanning-indicator-host')).toBeNull();
    expect(counter?.textContent).toBe(textBeforeStop);
  });

  it('clears the warning timer and counter updates when stopped after the warning fires', () => {
    const indicator = new ScanningIndicator();

    indicator.start();
    jest.advanceTimersByTime(120000);

    const host = document.getElementById('pg-scanning-indicator-host') as HTMLElement | null;
    const shadow = host?.shadowRoot;
    const counter = shadow?.querySelector('.pg-counter') as HTMLSpanElement | null;
    const textBeforeStop = counter?.textContent;

    indicator.stop();

    expect(jest.getTimerCount()).toBe(0);

    expect(() => {
      jest.advanceTimersByTime(10000);
    }).not.toThrow();

    expect(document.getElementById('pg-scanning-indicator-host')).toBeNull();
    expect(shadow?.textContent).toContain('⚠ This is taking unusually long');
    expect(counter?.textContent).toBe(textBeforeStop);
  });
});
