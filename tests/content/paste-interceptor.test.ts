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
    (chrome.storage.local.get as jest.Mock).mockResolvedValue({
      pg_settings: DEFAULT_SETTINGS,
    });
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
    expect(interceptor.pasteOriginal).toHaveBeenCalledWith('secret text');
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
    expect(interceptor.pasteOriginal).toHaveBeenCalledWith('secret text');
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
});
