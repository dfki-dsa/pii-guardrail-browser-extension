/** @jest-environment jsdom */

import { ClipboardInterceptor } from '../../src/content/clipboard-interceptor';
import type { ClipboardInterceptorOptions } from '../../src/content/clipboard-interceptor';
import type { ResolveResult } from '../../src/shared/placeholder-resolver';

const SOURCE = 'pg-clipboard-intercept';

const NO_MATCHES: ResolveResult = { matches: [], deAnonText: '' };

function makeMatchResult(deAnonText: string): ResolveResult {
  return {
    matches: [
      {
        start: 0,
        end: 11,
        matchText: '[PERSON_1]',
        originalText: 'Alice',
        styleKey: 'person',
        kind: 'placeholder',
      },
    ],
    deAnonText,
  };
}

describe('ClipboardInterceptor', () => {
  const originalAttachShadow = HTMLElement.prototype.attachShadow;
  let interceptors: ClipboardInterceptor[] = [];

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
    for (const interceptor of interceptors) interceptor.stop();
    interceptors = [];
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function createInterceptor(opts: ClipboardInterceptorOptions): ClipboardInterceptor {
    const interceptor = new ClipboardInterceptor(opts);
    interceptors.push(interceptor);
    return interceptor;
  }

  function getToastHost(): HTMLElement | null {
    return document.getElementById('pg-clipboard-toast-host');
  }

  async function flushCopyPipeline(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  it('shows a toast when the resolver returns at least one match', async () => {
    const interceptor = createInterceptor({
      resolve: (text) => makeMatchResult(text.replace('[PERSON_1]', 'Alice')),
    });
    interceptor.start();
    await interceptor.handleIntercepted('Hello [PERSON_1]', 'req-1');
    expect(getToastHost()).not.toBeNull();
  });

  it('does NOT show a toast when the resolver returns no matches', async () => {
    const interceptor = createInterceptor({
      resolve: () => NO_MATCHES,
    });
    interceptor.start();
    await interceptor.handleIntercepted('plain text', 'req-1');
    expect(getToastHost()).toBeNull();
  });

  it('disposes the previous toast when a new copy arrives (singleton)', async () => {
    const interceptor = createInterceptor({
      resolve: (text) => makeMatchResult(text + '!'),
    });
    interceptor.start();
    await interceptor.handleIntercepted('first', 'req-1');
    const firstHost = getToastHost();
    expect(firstHost).not.toBeNull();
    await interceptor.handleIntercepted('second', 'req-2');
    expect(document.querySelectorAll('#pg-clipboard-toast-host').length).toBe(1);
  });

  it('posts REPLACE_CLIPBOARD with the original requestId when Replace is clicked', async () => {
    const postSpy = jest.spyOn(window, 'postMessage');
    const interceptor = createInterceptor({
      resolve: () => makeMatchResult('Hello Alice'),
    });
    interceptor.start();
    await interceptor.handleIntercepted('Hello [PERSON_1]', 'req-42');

    const btn = getToastHost()?.shadowRoot?.querySelector('.pg-toast-btn') as HTMLButtonElement;
    btn.click();

    const replaceCall = postSpy.mock.calls.find(
      (c) => (c[0] as { kind?: string })?.kind === 'REPLACE_CLIPBOARD',
    );
    expect(replaceCall).toBeDefined();
    const payload = replaceCall![0] as { source: string; text: string; requestId: string };
    expect(payload.source).toBe(SOURCE);
    expect(payload.text).toBe('Hello Alice');
    expect(payload.requestId).toBe('req-42');
  });

  it('drops messages that do not match the source field', async () => {
    const resolve = jest.fn();
    const interceptor = createInterceptor({
      resolve: resolve as unknown as () => ResolveResult,
    });
    interceptor.start();
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: { source: 'someone-else', kind: 'WRITE_INTERCEPTED', text: 'x', requestId: '1' },
      }),
    );
    await Promise.resolve();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('processes valid WRITE_INTERCEPTED messages received via window message events', async () => {
    const interceptor = createInterceptor({
      resolve: (text) => makeMatchResult(text + '!'),
    });
    interceptor.start();
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: { source: SOURCE, kind: 'WRITE_INTERCEPTED', text: 'Hi [PERSON_1]', requestId: 'r1' },
      }),
    );
    // Allow the awaited resolve() in handleIntercepted to settle.
    await flushCopyPipeline();
    expect(getToastHost()).not.toBeNull();
  });

  it('triggers the toast pipeline from a bubble-phase copy DOM event', async () => {
    const interceptor = createInterceptor({
      resolve: () => makeMatchResult('Hello Alice'),
    });
    interceptor.start();

    const evt = new Event('copy', { bubbles: true }) as ClipboardEvent;
    Object.defineProperty(evt, 'clipboardData', {
      value: { getData: (mime: string) => (mime === 'text/plain' ? 'Hello [PERSON_1]' : '') },
    });
    document.dispatchEvent(evt);

    await flushCopyPipeline();
    expect(getToastHost()).not.toBeNull();
  });

  it('falls back to the current selection for Ctrl+C / manual copy events', async () => {
    const resolve = jest.fn((text: string) =>
      makeMatchResult(text.replace('[PERSON_1]', 'Alice')),
    );
    jest.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'Selected [PERSON_1]',
    } as Selection);

    const interceptor = createInterceptor({ resolve });
    interceptor.start();

    document.dispatchEvent(new Event('copy', { bubbles: true }) as ClipboardEvent);

    await flushCopyPipeline();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith('Selected [PERSON_1]');
    expect(getToastHost()).not.toBeNull();
  });

  it('keeps manual selections with no resolver matches silent', async () => {
    jest.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'Selected ordinary text',
    } as Selection);

    const interceptor = createInterceptor({
      resolve: () => NO_MATCHES,
    });
    interceptor.start();

    document.dispatchEvent(new Event('copy', { bubbles: true }) as ClipboardEvent);

    await flushCopyPipeline();
    expect(getToastHost()).toBeNull();
  });

  it('on copy-event Replace, calls navigator.clipboard.writeText with the de-anonymized text', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const interceptor = createInterceptor({
      resolve: () => makeMatchResult('Hello Alice'),
    });
    interceptor.start();

    const evt2 = new Event('copy', { bubbles: true }) as ClipboardEvent;
    Object.defineProperty(evt2, 'clipboardData', {
      value: { getData: (mime: string) => (mime === 'text/plain' ? 'Hello [PERSON_1]' : '') },
    });
    document.dispatchEvent(evt2);
    await flushCopyPipeline();

    const btn = getToastHost()?.shadowRoot?.querySelector('.pg-toast-btn') as HTMLButtonElement;
    btn.click();
    expect(writeText).toHaveBeenCalledWith('Hello Alice');
  });

  it('a manual copy supersedes a pending native-copy toast and uses the manual replace path', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    jest.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'Manual [PERSON_1]',
    } as Selection);

    const interceptor = createInterceptor({
      resolve: (text) => makeMatchResult(text.replace('[PERSON_1]', 'Alice')),
    });
    interceptor.start();

    await interceptor.handleIntercepted('Native [PERSON_1]', 'req-1');
    const nativeHost = getToastHost();
    expect(nativeHost).not.toBeNull();

    document.dispatchEvent(new Event('copy', { bubbles: true }) as ClipboardEvent);
    await flushCopyPipeline();

    expect(document.querySelectorAll('#pg-clipboard-toast-host').length).toBe(1);
    expect(getToastHost()).not.toBe(nativeHost);

    const btn = getToastHost()?.shadowRoot?.querySelector('.pg-toast-btn') as HTMLButtonElement;
    btn.click();
    expect(writeText).toHaveBeenCalledWith('Manual Alice');
  });

  it('a native copy supersedes a pending manual-copy toast and posts the native request id', async () => {
    const postSpy = jest.spyOn(window, 'postMessage');
    jest.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'Manual [PERSON_1]',
    } as Selection);

    const interceptor = createInterceptor({
      resolve: (text) => makeMatchResult(text.replace('[PERSON_1]', 'Alice')),
    });
    interceptor.start();

    document.dispatchEvent(new Event('copy', { bubbles: true }) as ClipboardEvent);
    await flushCopyPipeline();
    const manualHost = getToastHost();
    expect(manualHost).not.toBeNull();

    await interceptor.handleIntercepted('Native [PERSON_1]', 'req-2');
    expect(document.querySelectorAll('#pg-clipboard-toast-host').length).toBe(1);
    expect(getToastHost()).not.toBe(manualHost);

    const btn = getToastHost()?.shadowRoot?.querySelector('.pg-toast-btn') as HTMLButtonElement;
    btn.click();

    const replaceCall = postSpy.mock.calls.find(
      (c) => (c[0] as { kind?: string; requestId?: string })?.requestId === 'req-2',
    );
    expect((replaceCall?.[0] as { kind?: string })?.kind).toBe('REPLACE_CLIPBOARD');
  });

  it('does not prevent default copy behavior for form-field text with no matches', async () => {
    const interceptor = createInterceptor({
      resolve: () => NO_MATCHES,
    });
    interceptor.start();

    const input = document.createElement('input');
    input.value = 'ordinary form text';
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(0, input.value.length);

    const evt = new Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(evt, 'clipboardData', {
      value: { getData: (mime: string) => (mime === 'text/plain' ? input.value : '') },
    });
    input.dispatchEvent(evt);

    await flushCopyPipeline();
    expect(evt.defaultPrevented).toBe(false);
    expect(getToastHost()).toBeNull();
  });

  it('respects setEnabled(false) — no toast is created and any open toast is disposed', async () => {
    const interceptor = createInterceptor({
      resolve: () => makeMatchResult('x'),
    });
    interceptor.start();
    await interceptor.handleIntercepted('Hi [PERSON_1]', 'r1');
    expect(getToastHost()).not.toBeNull();
    interceptor.setEnabled(false);
    expect(getToastHost()).toBeNull();
    await interceptor.handleIntercepted('Hi [PERSON_1]', 'r2');
    expect(getToastHost()).toBeNull();
  });

  it('ignores both WRITE_INTERCEPTED and copy DOM events while disabled', async () => {
    const resolve = jest.fn(() => makeMatchResult('Hello Alice'));
    jest.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'Selected [PERSON_1]',
    } as Selection);

    const interceptor = createInterceptor({
      resolve,
      enabled: false,
    });
    interceptor.start();

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          source: SOURCE,
          kind: 'WRITE_INTERCEPTED',
          text: 'Hello [PERSON_1]',
          requestId: 'r-disabled',
        },
      }),
    );
    document.dispatchEvent(new Event('copy', { bubbles: true }) as ClipboardEvent);
    await flushCopyPipeline();

    expect(resolve).not.toHaveBeenCalled();
    expect(getToastHost()).toBeNull();
  });
});
