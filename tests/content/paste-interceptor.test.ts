/** @jest-environment jsdom */

import { PasteInterceptor, type PasteInterceptorCallbacks } from '../../src/content/paste-interceptor';
import type { SiteAdapter } from '../../src/content/site-adapters/adapter-interface';
import { DEFAULT_SETTINGS } from '../../src/shared/constants';

describe('PasteInterceptor', () => {
  const adapter: SiteAdapter = {
    name: 'test',
    getInputElement: () => null,
    getResponseElements: () => [],
    insertText: jest.fn(),
    observeResponses: jest.fn() as unknown as SiteAdapter['observeResponses'],
  };

  const makeCallbacks = (): PasteInterceptorCallbacks & Record<string, jest.Mock> => ({
    onAnalyzing: jest.fn(),
    onNoPii: jest.fn(),
    onPiiDetected: jest.fn(),
    onError: jest.fn(),
    onCanceled: jest.fn(),
  });

  beforeEach(() => {
    jest.resetAllMocks();
    document.body.replaceChildren();
    (chrome.storage.local.get as jest.Mock).mockResolvedValue({
      pg_settings: DEFAULT_SETTINGS,
    });
  });

  it('holds a qualifying paste before an existing ChatGPT capture listener can receive it', async () => {
    const input = document.createElement('div');
    input.contentEditable = 'true';
    document.body.append(input);

    const chatGptAdapter: SiteAdapter = {
      ...adapter,
      getInputElement: () => input,
    };
    const callbacks = makeCallbacks();
    const interceptor = new PasteInterceptor(chatGptAdapter, callbacks);
    const chatGptCaptureListener = jest.fn();

    document.addEventListener('paste', chatGptCaptureListener, true);
    interceptor.start();

    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: () => 'Synthetic private text that needs a review before it can be pasted.' },
    });
    input.dispatchEvent(paste);

    expect(paste.defaultPrevented).toBe(true);
    expect(chatGptCaptureListener).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(callbacks.onAnalyzing).toHaveBeenCalledTimes(1);

    interceptor.stop();
    document.removeEventListener('paste', chatGptCaptureListener, true);
  });

  it('registers the paste guard before settings initialization completes', async () => {
    const input = document.createElement('div');
    input.contentEditable = 'true';
    document.body.append(input);

    let finishInitialization: () => void = () => undefined;
    const initialization = new Promise<void>((resolve) => {
      finishInitialization = resolve;
    });
    const callbacks = makeCallbacks();
    const interceptor = new PasteInterceptor(
      { ...adapter, getInputElement: () => input },
      callbacks,
      { waitForReady: () => initialization },
    );
    const pageCaptureListener = jest.fn();

    document.addEventListener('paste', pageCaptureListener, true);
    interceptor.start();

    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: () => 'Synthetic private text that is held while settings initialize.' },
    });
    input.dispatchEvent(paste);

    expect(paste.defaultPrevented).toBe(true);
    expect(pageCaptureListener).not.toHaveBeenCalled();
    expect(callbacks.onAnalyzing).not.toHaveBeenCalled();

    finishInitialization();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(callbacks.onAnalyzing).toHaveBeenCalledTimes(1);

    interceptor.stop();
    document.removeEventListener('paste', pageCaptureListener, true);
  });

  it('restores an initial paste when content initialization fails', async () => {
    const input = document.createElement('div');
    input.contentEditable = 'true';
    document.body.append(input);
    const callbacks = makeCallbacks();
    const failingAdapter: SiteAdapter = {
      ...adapter,
      getInputElement: () => input,
    };
    const interceptor = new PasteInterceptor(failingAdapter, callbacks, {
      waitForReady: async () => {
        throw new Error('Initial state could not be restored');
      },
    });
    interceptor.start();

    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: () => 'Synthetic private text that must not be silently lost.' },
    });
    input.dispatchEvent(paste);

    await Promise.resolve();
    await Promise.resolve();

    expect(callbacks.onError).toHaveBeenCalledWith('Initial state could not be restored');
    expect(failingAdapter.insertText).toHaveBeenCalledWith(input, 'Synthetic private text that must not be silently lost.');

    interceptor.stop();
  });

  it('normalizes invalid NER model settings before detection requests', async () => {
    const callbacks = makeCallbacks();
    const interceptor = new PasteInterceptor(adapter, callbacks) as any;
    (chrome.storage.local.get as jest.Mock).mockResolvedValueOnce({
      pg_settings: { ...DEFAULT_SETTINGS, nerModel: 'banana' },
    });
    (chrome.runtime.sendMessage as jest.Mock).mockResolvedValueOnce({
      type: 'PII_RESULT',
      payload: { requestId: 'test', spans: [] },
    });

    await interceptor.analyze('secret text');

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'DETECT_PII',
        payload: expect.objectContaining({
          config: expect.objectContaining({
            ner_provider: 'transformers',
            ner_model: 'bardsai',
          }),
        }),
      })
    );
  });

  it('does not paste original text when the extension context was invalidated', async () => {
    const callbacks = makeCallbacks();
    const interceptor = new PasteInterceptor(adapter, callbacks) as any;

    interceptor.pasteOriginal = jest.fn();
    (chrome.runtime.sendMessage as jest.Mock).mockRejectedValueOnce(
      new Error('Extension context invalidated.')
    );

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await interceptor.analyze('secret text');

    expect(callbacks.onError).toHaveBeenCalledWith(
      'Extension reloaded. Refresh this page and paste again.'
    );
    expect(interceptor.pasteOriginal).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('still pastes the original text for other detection errors', async () => {
    const callbacks = makeCallbacks();
    const interceptor = new PasteInterceptor(adapter, callbacks) as any;

    interceptor.pasteOriginal = jest.fn();
    (chrome.runtime.sendMessage as jest.Mock).mockRejectedValueOnce(
      new Error('Unexpected detection failure')
    );

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await interceptor.analyze('secret text');

    expect(callbacks.onError).toHaveBeenCalledWith('Unexpected detection failure');
    expect(interceptor.pasteOriginal).toHaveBeenCalledWith(
      'secret text',
      expect.stringMatching(/^paste_/),
    );
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('sends a cancellation request and does not paste when the user cancels detection without a paste decision handler', async () => {
    const callbacks = makeCallbacks();
    const interceptor = new PasteInterceptor(adapter, callbacks) as any;

    (chrome.runtime.sendMessage as jest.Mock).mockImplementation((message) => {
      if (message.type === 'DETECT_PII') {
        return new Promise(() => undefined);
      }
      return Promise.resolve({
        type: 'DETECTION_CANCELED',
        payload: { requestId: message.payload.requestId },
      });
    });

    interceptor.pasteOriginal = jest.fn();
    const detection = interceptor.analyze('secret text');
    await Promise.resolve();

    interceptor.cancelActiveDetection();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'CANCEL_DETECTION',
        payload: expect.objectContaining({ requestId: expect.stringMatching(/^pg_/) }),
      })
    );
    expect(callbacks.onCanceled).toHaveBeenCalledWith(true);
    expect(callbacks.onCanceled).toHaveBeenCalledTimes(1);
    expect(interceptor.pasteOriginal).not.toHaveBeenCalled();

    void detection;
  });

  it('serializes overlapping analyses so cancellation stays with the displayed request', async () => {
    const callbacks = makeCallbacks();
    const interceptor = new PasteInterceptor(adapter, callbacks) as any;
    let resolveFirstDetection: (value: unknown) => void = () => undefined;

    interceptor.activePastes.set('paste-1', { targetElement: null, savedSelection: null });
    interceptor.activePastes.set('paste-2', { targetElement: null, savedSelection: null });

    (chrome.runtime.sendMessage as jest.Mock).mockImplementation((message) => {
      if (message.type === 'CANCEL_DETECTION') {
        return Promise.resolve({
          type: 'DETECTION_CANCELED',
          payload: { requestId: message.payload.requestId },
        });
      }

      const detectionCalls = (chrome.runtime.sendMessage as jest.Mock).mock.calls
        .map(([request]) => request)
        .filter((request) => request.type === 'DETECT_PII');
      if (detectionCalls.length === 1) {
        return new Promise((resolve) => {
          resolveFirstDetection = resolve;
        });
      }

      return Promise.resolve({
        type: 'PII_RESULT',
        payload: { requestId: message.payload.requestId, spans: [] },
      });
    });

    const first = interceptor.processPaste('first private text', 'paste-1');
    const second = interceptor.processPaste('second private text', 'paste-2');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const firstRequest = (chrome.runtime.sendMessage as jest.Mock).mock.calls
      .map(([request]) => request)
      .find((request) => request.type === 'DETECT_PII');
    expect(firstRequest).toBeDefined();
    expect(callbacks.onAnalyzing).toHaveBeenCalledTimes(1);

    interceptor.cancelActiveDetection();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'CANCEL_DETECTION',
      payload: { requestId: firstRequest.payload.requestId },
    });

    resolveFirstDetection({
      type: 'PII_RESULT',
      payload: { requestId: firstRequest.payload.requestId, spans: [] },
    });
    await first;
    await second;

    const detectionRequests = (chrome.runtime.sendMessage as jest.Mock).mock.calls
      .map(([request]) => request)
      .filter((request) => request.type === 'DETECT_PII');
    expect(detectionRequests).toHaveLength(2);
    expect(detectionRequests[1].payload.requestId).not.toBe(firstRequest.payload.requestId);
    expect(callbacks.onAnalyzing).toHaveBeenCalledTimes(2);
  });

  it('pastes original text when explicit cancellation decision chooses paste without checking', async () => {
    const callbacks = makeCallbacks();
    callbacks.onExplicitCancelDecision = jest.fn().mockResolvedValue('paste-original');
    const interceptor = new PasteInterceptor(adapter, callbacks) as any;

    (chrome.runtime.sendMessage as jest.Mock).mockImplementation((message) => {
      if (message.type === 'DETECT_PII') return new Promise(() => undefined);
      return Promise.resolve({ type: 'DETECTION_CANCELED', payload: { requestId: message.payload.requestId } });
    });

    interceptor.pasteOriginal = jest.fn();
    const detection = interceptor.analyze('secret text');
    await Promise.resolve();

    interceptor.cancelActiveDetection();
    await Promise.resolve();

    expect(callbacks.onExplicitCancelDecision).toHaveBeenCalledWith('secret text');
    expect(interceptor.pasteOriginal).toHaveBeenCalledWith(
      'secret text',
      expect.stringMatching(/^paste_/),
    );
    void detection;
  });

  it('drops original text when explicit cancellation decision chooses don’t paste', async () => {
    const callbacks = makeCallbacks();
    callbacks.onExplicitCancelDecision = jest.fn().mockResolvedValue('drop');
    const interceptor = new PasteInterceptor(adapter, callbacks) as any;

    (chrome.runtime.sendMessage as jest.Mock).mockImplementation((message) => {
      if (message.type === 'DETECT_PII') return new Promise(() => undefined);
      return Promise.resolve({ type: 'DETECTION_CANCELED', payload: { requestId: message.payload.requestId } });
    });

    interceptor.pasteOriginal = jest.fn();
    const detection = interceptor.analyze('secret text');
    await Promise.resolve();

    interceptor.cancelActiveDetection();
    await Promise.resolve();

    expect(callbacks.onExplicitCancelDecision).toHaveBeenCalledWith('secret text');
    expect(interceptor.pasteOriginal).not.toHaveBeenCalled();
    void detection;
  });

  it('ignores late detection results after explicit user cancellation wins the race', async () => {
    const callbacks = makeCallbacks();
    callbacks.onExplicitCancelDecision = jest.fn().mockResolvedValue('drop');
    const interceptor = new PasteInterceptor(adapter, callbacks) as any;
    let resolveDetection: (value: unknown) => void = () => undefined;

    (chrome.runtime.sendMessage as jest.Mock).mockImplementation((message) => {
      if (message.type === 'DETECT_PII') {
        return new Promise((resolve) => { resolveDetection = resolve; });
      }
      return Promise.resolve({ type: 'DETECTION_CANCELED', payload: { requestId: message.payload.requestId } });
    });

    const detection = interceptor.analyze('secret text');
    await Promise.resolve();
    interceptor.cancelActiveDetection();
    await Promise.resolve();

    resolveDetection({ type: 'PII_RESULT', payload: { requestId: 'late', spans: [{ start: 0, end: 6, entity_type: 'PERSON', score: 1, text: 'secret', source: 'manual' }] } });
    await detection;

    expect(callbacks.onPiiDetected).not.toHaveBeenCalled();
    expect(callbacks.onNoPii).not.toHaveBeenCalled();
  });

  it('restores paste into the specific target editable element rather than default adapter input', () => {
    const defaultInput = { focus: jest.fn() } as unknown as HTMLElement;
    const specificTargetInput = { focus: jest.fn() } as unknown as HTMLElement;

    const testAdapter: SiteAdapter = {
      name: 'test',
      getInputElement: () => defaultInput,
      getResponseElements: () => [],
      insertText: jest.fn(),
      observeResponses: jest.fn() as unknown as SiteAdapter['observeResponses'],
    };

    const callbacks = makeCallbacks();
    const interceptor = new PasteInterceptor(testAdapter, callbacks);

    (interceptor as any).activePastes.set('paste-1', { targetElement: specificTargetInput, savedSelection: null });
    interceptor.pasteOriginal('restored text', 'paste-1');

    expect(testAdapter.insertText).toHaveBeenCalledWith(specificTargetInput, 'restored text');
    expect(testAdapter.insertText).not.toHaveBeenCalledWith(defaultInput, 'restored text');
  });

  it('keeps destinations separate for concurrent pastes with identical text', () => {
    const firstTarget = { focus: jest.fn() } as unknown as HTMLElement;
    const secondTarget = { focus: jest.fn() } as unknown as HTMLElement;
    const testAdapter: SiteAdapter = {
      ...adapter,
      insertText: jest.fn(),
    };
    const interceptor = new PasteInterceptor(testAdapter, makeCallbacks());

    (interceptor as any).activePastes.set('paste-1', {
      targetElement: firstTarget,
      savedSelection: null,
    });
    (interceptor as any).activePastes.set('paste-2', {
      targetElement: secondTarget,
      savedSelection: null,
    });

    interceptor.pasteOriginal('identical private text', 'paste-2');
    interceptor.pasteOriginal('identical private text', 'paste-1');

    expect(testAdapter.insertText).toHaveBeenNthCalledWith(
      1,
      secondTarget,
      'identical private text',
    );
    expect(testAdapter.insertText).toHaveBeenNthCalledWith(
      2,
      firstTarget,
      'identical private text',
    );
    expect((interceptor as any).activePastes.size).toBe(0);
  });
});
