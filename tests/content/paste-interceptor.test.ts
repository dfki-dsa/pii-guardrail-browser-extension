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
    onComposerLookup: jest.fn(),
  });

  /** A paste event carrying `text` as its clipboard payload. Composed, as a
   *  real one is, so it crosses a shadow boundary the way the browser's does. */
  const pasteEvent = (text: string): ClipboardEvent => {
    const event = new Event('paste', {
      bubbles: true,
      cancelable: true,
      composed: true,
    }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: () => text },
    });
    return event;
  };

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
    await Promise.resolve();
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
    await Promise.resolve();
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

  describe('message box lookup reporting', () => {
    const LONG_ENOUGH = 'Synthetic private text that should have been reviewed.';

    it('still reviews a qualifying paste the adapter does not recognize', () => {
      // The signed-out ChatGPT case (#32): a real composer wearing markup the
      // adapter knows nothing about. Protection used to end here; now the
      // paste target itself is taken as the message box, and the guess is
      // reported rather than passed off as a healthy match.
      const composer = document.createElement('textarea');
      document.body.append(composer);
      const callbacks = makeCallbacks();
      const interceptor = new PasteInterceptor(adapter, callbacks);
      interceptor.start();

      const paste = pasteEvent(LONG_ENOUGH);
      composer.dispatchEvent(paste);

      expect(paste.defaultPrevented).toBe(true);
      expect(callbacks.onComposerLookup).toHaveBeenCalledWith('generic');
      expect(callbacks.onComposerLookup).not.toHaveBeenCalledWith('none');

      interceptor.stop();
    });

    it('reviews a paste dispatched at a node inside a contenteditable composer', () => {
      const composer = document.createElement('div');
      composer.setAttribute('contenteditable', 'true');
      const paragraph = document.createElement('p');
      composer.append(paragraph);
      document.body.append(composer);
      const callbacks = makeCallbacks();
      const interceptor = new PasteInterceptor(adapter, callbacks);
      interceptor.start();

      // Browsers dispatch at the deepest editable node, not at the host.
      const paste = pasteEvent(LONG_ENOUGH);
      paragraph.dispatchEvent(paste);

      expect(paste.defaultPrevented).toBe(true);
      expect(callbacks.onComposerLookup).toHaveBeenCalledWith('generic');

      interceptor.stop();
    });

    it('reviews a paste into a composer inside a shadow root', () => {
      // `event.target` is retargeted at the shadow host, which used to read
      // as a missing message box. The composed path names the real target.
      const host = document.createElement('div');
      document.body.append(host);
      const shadow = host.attachShadow({ mode: 'open' });
      const composer = document.createElement('textarea');
      shadow.append(composer);

      const callbacks = makeCallbacks();
      const interceptor = new PasteInterceptor(adapter, callbacks);
      interceptor.start();

      const paste = pasteEvent(LONG_ENOUGH);
      composer.dispatchEvent(paste);

      expect(paste.defaultPrevented).toBe(true);
      expect(callbacks.onComposerLookup).toHaveBeenCalledWith('generic');

      interceptor.stop();
    });

    it('stays quiet for a paste too short to have been reviewed', () => {
      const composer = document.createElement('textarea');
      document.body.append(composer);
      const callbacks = makeCallbacks();
      const interceptor = new PasteInterceptor(adapter, callbacks);
      interceptor.start();

      composer.dispatchEvent(pasteEvent('short'));

      expect(callbacks.onComposerLookup).not.toHaveBeenCalled();

      interceptor.stop();
    });

    it('neither reviews nor reports a paste into a single-line field that is no composer', () => {
      // A search or settings field on a supported host. No site's message box
      // is an <input>, so this says nothing about whether the adapter still
      // matches — and a warning here would be a false alarm the user cannot
      // clear.
      const searchField = document.createElement('input');
      searchField.type = 'text';
      document.body.append(searchField);
      const callbacks = makeCallbacks();
      const interceptor = new PasteInterceptor(adapter, callbacks);
      interceptor.start();

      const paste = pasteEvent(LONG_ENOUGH);
      searchField.dispatchEvent(paste);

      expect(paste.defaultPrevented).toBe(false);
      expect(callbacks.onComposerLookup).not.toHaveBeenCalled();

      interceptor.stop();
    });

    it('stays quiet for a paste at a target that could not have accepted text', () => {
      // Chrome delivers Ctrl+V here with nothing focused. It is not evidence
      // that the adapter stopped matching, and it must not raise a warning.
      const callbacks = makeCallbacks();
      const interceptor = new PasteInterceptor(adapter, callbacks);
      interceptor.start();

      document.body.dispatchEvent(pasteEvent(LONG_ENOUGH));

      expect(callbacks.onComposerLookup).not.toHaveBeenCalled();

      interceptor.stop();
    });

    it('stays quiet while interception is disabled', () => {
      const composer = document.createElement('textarea');
      document.body.append(composer);
      const callbacks = makeCallbacks();
      const interceptor = new PasteInterceptor(adapter, callbacks);
      interceptor.setEnabled(false);
      interceptor.start();

      composer.dispatchEvent(pasteEvent(LONG_ENOUGH));

      expect(callbacks.onComposerLookup).not.toHaveBeenCalled();

      interceptor.stop();
    });

    it('reports a resolved message box so a stale warning clears', () => {
      const input = document.createElement('div');
      input.setAttribute('contenteditable', 'true');
      document.body.append(input);
      const callbacks = makeCallbacks();
      const interceptor = new PasteInterceptor(
        { ...adapter, getInputElement: () => input },
        callbacks,
      );
      interceptor.start();

      input.dispatchEvent(pasteEvent(LONG_ENOUGH));

      expect(callbacks.onComposerLookup).toHaveBeenCalledWith('adapter');
      expect(callbacks.onComposerLookup).not.toHaveBeenCalledWith('generic');
      expect(callbacks.onComposerLookup).not.toHaveBeenCalledWith('none');

      interceptor.stop();
    });

    it('reports a lookup that succeeds for a paste aimed elsewhere on the page', () => {
      // A paste into a search field proves the adapter still matches, even
      // though this paste is none of the interceptor's business.
      const input = document.createElement('div');
      input.setAttribute('contenteditable', 'true');
      const elsewhere = document.createElement('input');
      document.body.append(input, elsewhere);
      const callbacks = makeCallbacks();
      const interceptor = new PasteInterceptor(
        { ...adapter, getInputElement: () => input },
        callbacks,
      );
      interceptor.start();

      const paste = pasteEvent(LONG_ENOUGH);
      elsewhere.dispatchEvent(paste);

      expect(callbacks.onComposerLookup).toHaveBeenCalledWith('adapter');
      expect(paste.defaultPrevented).toBe(false);

      interceptor.stop();
    });

    it('reports the missing message box when reviewed text has nowhere to land', () => {
      // The composer went away between the paste and the insert: review ran,
      // and its result would otherwise vanish without a word.
      const callbacks = makeCallbacks();
      const interceptor = new PasteInterceptor(adapter, callbacks);

      interceptor.pasteAnonymized('Redacted [PERSON_1] text.');

      expect(callbacks.onComposerLookup).toHaveBeenCalledWith('none');
      expect(adapter.insertText).not.toHaveBeenCalled();
    });

    it('inserts and reports success when the message box is still there', () => {
      const input = document.createElement('div');
      input.setAttribute('contenteditable', 'true');
      document.body.append(input);
      const callbacks = makeCallbacks();
      const insertingAdapter: SiteAdapter = {
        ...adapter,
        getInputElement: () => input,
        insertText: jest.fn(),
      };
      const interceptor = new PasteInterceptor(insertingAdapter, callbacks);

      interceptor.pasteAnonymized('Redacted [PERSON_1] text.');

      expect(insertingAdapter.insertText).toHaveBeenCalledWith(
        input,
        'Redacted [PERSON_1] text.',
      );
      expect(callbacks.onComposerLookup).not.toHaveBeenCalledWith('none');
    });

    it('inserts back into the composer the paste came from, not a fresh lookup', () => {
      // Review is asynchronous. Asking the adapter again afterwards means the
      // reviewed text can land somewhere other than where it was taken from —
      // or nowhere, if the adapter has stopped matching in the meantime.
      const composer = document.createElement('textarea');
      const decoy = document.createElement('div');
      decoy.setAttribute('contenteditable', 'true');
      document.body.append(composer, decoy);

      const callbacks = makeCallbacks();
      const insertText = jest.fn();
      let resolved: HTMLElement | null = null;
      const interceptor = new PasteInterceptor(
        { ...adapter, getInputElement: () => resolved, insertText },
        callbacks,
      );
      interceptor.start();

      composer.dispatchEvent(pasteEvent(LONG_ENOUGH));

      // The site rebuilds while detection runs and the adapter now matches
      // something else entirely.
      resolved = decoy;
      interceptor.pasteAnonymized('Redacted [PERSON_1] text.');

      expect(insertText).toHaveBeenCalledWith(composer, 'Redacted [PERSON_1] text.');

      interceptor.stop();
    });
  });
});
