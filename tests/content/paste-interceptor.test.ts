/** @jest-environment jsdom */

import { PasteInterceptor, type PasteInterceptorCallbacks } from '../../src/content/paste-interceptor';
import { insertTextCompat, type SiteAdapter } from '../../src/content/site-adapters/adapter-interface';
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

    it('says whether the anonymized text had somewhere to land', () => {
      const input = document.createElement('textarea');
      document.body.append(input);

      const landed = new PasteInterceptor(
        { ...adapter, getInputElement: () => input, insertText: jest.fn() },
        makeCallbacks(),
      );
      const lost = new PasteInterceptor(adapter, makeCallbacks());

      expect(landed.pasteAnonymized('Redacted [PERSON_1] text.')).toBe(true);
      expect(lost.pasteAnonymized('Redacted [PERSON_1] text.')).toBe(false);
      expect(landed.pasteOriginal('Original text.')).toBe(true);
      expect(lost.pasteOriginal('Original text.')).toBe(false);
    });
  });

  describe('swapping text that was already inserted', () => {
    const REPLACED = 'Dear [PERSON_1], your code is [PHONE_1].';
    const ORIGINAL = 'Dear Jane Doe, your code is 0431 555 0199.';

    /** An adapter that really inserts, the way every site adapter does. */
    const insertingAdapter = (input: HTMLElement): SiteAdapter => ({
      ...adapter,
      getInputElement: () => input,
      insertText: (element, text) => insertTextCompat(element, text),
    });

    it('restores the original in a textarea and leaves the rest of the draft alone', async () => {
      const input = document.createElement('textarea');
      input.value = 'Draft: ';
      document.body.append(input);
      input.setSelectionRange(7, 7);
      const interceptor = new PasteInterceptor(insertingAdapter(input), makeCallbacks());

      interceptor.pasteAnonymized(REPLACED);
      expect(input.value).toBe(`Draft: ${REPLACED}`);

      await expect(interceptor.replaceInserted(REPLACED, ORIGINAL)).resolves.toBe(true);
      expect(input.value).toBe(`Draft: ${ORIGINAL}`);
    });

    it('restores the original in a rich editor', async () => {
      const input = document.createElement('div');
      input.setAttribute('contenteditable', 'true');
      document.body.append(input);
      const interceptor = new PasteInterceptor(insertingAdapter(input), makeCallbacks());

      interceptor.pasteAnonymized(REPLACED);
      expect(input.textContent).toBe(REPLACED);

      await expect(interceptor.replaceInserted(REPLACED, ORIGINAL)).resolves.toBe(true);
      expect(input.textContent).toBe(ORIGINAL);
    });

    it('changes nothing once the user has edited the inserted text', async () => {
      const input = document.createElement('textarea');
      document.body.append(input);
      const interceptor = new PasteInterceptor(insertingAdapter(input), makeCallbacks());

      interceptor.pasteAnonymized(REPLACED);
      input.value = 'Dear [PERSON_1], I changed my mind about the rest.';

      await expect(interceptor.replaceInserted(REPLACED, ORIGINAL)).resolves.toBe(false);
      expect(input.value).toBe('Dear [PERSON_1], I changed my mind about the rest.');
    });

    it('changes nothing once the message was sent and the box emptied', async () => {
      const input = document.createElement('div');
      input.setAttribute('contenteditable', 'true');
      document.body.append(input);
      const interceptor = new PasteInterceptor(insertingAdapter(input), makeCallbacks());

      interceptor.pasteAnonymized(REPLACED);
      input.replaceChildren();

      await expect(interceptor.replaceInserted(REPLACED, ORIGINAL)).resolves.toBe(false);
      expect(input.textContent).toBe('');
    });

    it('reports failure when the editor puts the old text back', async () => {
      // An editor that owns its content redraws from its own state. A swap it
      // did not accept must not be reported as done.
      const input = document.createElement('textarea');
      document.body.append(input);
      const interceptor = new PasteInterceptor(insertingAdapter(input), makeCallbacks());

      interceptor.pasteAnonymized(REPLACED);
      input.addEventListener('input', () => {
        input.value = REPLACED;
      });

      await expect(interceptor.replaceInserted(REPLACED, ORIGINAL)).resolves.toBe(false);
      expect(input.value).toBe(REPLACED);
    });

    it('has nothing to swap before anything was inserted, or after the box is gone', async () => {
      const input = document.createElement('textarea');
      document.body.append(input);
      const interceptor = new PasteInterceptor(insertingAdapter(input), makeCallbacks());

      await expect(interceptor.replaceInserted(REPLACED, ORIGINAL)).resolves.toBe(false);

      interceptor.pasteAnonymized(REPLACED);
      input.remove();

      await expect(interceptor.replaceInserted(REPLACED, ORIGINAL)).resolves.toBe(false);
    });

    it('knows whether any of a paste\'s tokens are still in the message box', () => {
      const input = document.createElement('div');
      input.setAttribute('contenteditable', 'true');
      document.body.append(input);
      const interceptor = new PasteInterceptor(insertingAdapter(input), makeCallbacks());
      const tokens = ['[PERSON_1]', '[PHONE_1]'];

      // Nothing inserted yet.
      expect(interceptor.composerContainsAny(tokens)).toBe(false);

      interceptor.pasteAnonymized(REPLACED);
      expect(interceptor.composerContainsAny(tokens)).toBe(true);

      // An editor reshaping the text around the tokens does not lose them.
      input.innerHTML = '<ul><li>Dear <b>[PERSON_1]</b></li><li>your code is [PHONE_1]</li></ul>';
      expect(interceptor.composerContainsAny(tokens)).toBe(true);

      // One token edited away: the other still marks the paste as there.
      input.innerHTML = '<p>Dear Jane, your code is [PHONE_1].</p>';
      expect(interceptor.composerContainsAny(tokens)).toBe(true);

      // Sent: the site empties the box.
      input.replaceChildren();
      expect(interceptor.composerContainsAny(tokens)).toBe(false);
    });

    it('finds nothing in a box that left the page, or when asked about nothing', () => {
      const input = document.createElement('textarea');
      document.body.append(input);
      const interceptor = new PasteInterceptor(insertingAdapter(input), makeCallbacks());

      interceptor.pasteAnonymized(REPLACED);
      expect(interceptor.composerContainsAny(['[PERSON_1]'])).toBe(true);
      expect(interceptor.composerContainsAny([])).toBe(false);
      expect(interceptor.composerContainsAny([' \n '])).toBe(false);

      input.remove();
      expect(interceptor.composerContainsAny(['[PERSON_1]'])).toBe(false);
    });

    describe('when the same text was pasted twice', () => {
      beforeEach(() => {
        // Detection never answers: these tests supply the replaced text
        // themselves, and a pending paste must not finish behind their back.
        (chrome.runtime.sendMessage as jest.Mock).mockReturnValue(new Promise(() => undefined));
      });

      /** Paste through the real event, so the caret the text goes in at is recorded. */
      const pasteAt = (
        interceptor: PasteInterceptor,
        input: HTMLTextAreaElement,
        caret: number,
        replaced: string,
      ): void => {
        input.setSelectionRange(caret, caret);
        input.dispatchEvent(pasteEvent('Synthetic private text, long enough to be held for review.'));
        interceptor.pasteAnonymized(replaced);
      };

      it('restores the second copy in a textarea and says so', async () => {
        // The check used to be "is the old text gone from the box?". With a
        // second copy still there it answered no, and the user was told
        // nothing had changed while the original sat in the message box.
        const input = document.createElement('textarea');
        document.body.append(input);
        const interceptor = new PasteInterceptor(insertingAdapter(input), makeCallbacks());
        interceptor.start();

        pasteAt(interceptor, input, 0, REPLACED);
        input.value += '\n';
        pasteAt(interceptor, input, input.value.length, REPLACED);
        expect(input.value).toBe(`${REPLACED}\n${REPLACED}`);

        await expect(interceptor.replaceInserted(REPLACED, ORIGINAL)).resolves.toBe(true);
        expect(input.value).toBe(`${REPLACED}\n${ORIGINAL}`);

        interceptor.stop();
      });

      it('restores the second copy in a rich editor', async () => {
        const input = document.createElement('div');
        input.setAttribute('contenteditable', 'true');
        document.body.append(input);
        const interceptor = new PasteInterceptor(insertingAdapter(input), makeCallbacks());

        interceptor.pasteAnonymized(REPLACED);
        interceptor.pasteAnonymized(REPLACED);
        expect(input.textContent).toBe(REPLACED + REPLACED);

        await expect(interceptor.replaceInserted(REPLACED, ORIGINAL)).resolves.toBe(true);
        expect(input.textContent).toBe(REPLACED + ORIGINAL);
      });

      it('changes nothing in a rich editor once a copy was removed and it cannot tell which is left', async () => {
        const input = document.createElement('div');
        input.setAttribute('contenteditable', 'true');
        document.body.append(input);
        const interceptor = new PasteInterceptor(insertingAdapter(input), makeCallbacks());

        interceptor.pasteAnonymized(REPLACED);
        interceptor.pasteAnonymized(REPLACED);
        // The user deletes one of the two. The survivor may be the earlier
        // paste, which Undo has no business touching.
        input.textContent = REPLACED;

        await expect(interceptor.replaceInserted(REPLACED, ORIGINAL)).resolves.toBe(false);
        expect(input.textContent).toBe(REPLACED);
      });
    });

    it('treats a swap for identical text as done only while the text is still there', async () => {
      const input = document.createElement('textarea');
      document.body.append(input);
      const interceptor = new PasteInterceptor(insertingAdapter(input), makeCallbacks());

      interceptor.pasteAnonymized(REPLACED);
      await expect(interceptor.replaceInserted(REPLACED, REPLACED)).resolves.toBe(true);

      input.value = '';
      await expect(interceptor.replaceInserted(REPLACED, REPLACED)).resolves.toBe(false);
    });
  });
});
