/** @jest-environment jsdom */

import { ChatGptAdapter } from '../../src/content/site-adapters/chatgpt-adapter';
import { PasteInterceptor, type PasteInterceptorCallbacks } from '../../src/content/paste-interceptor';
import { DEFAULT_SETTINGS } from '../../src/shared/constants';

const PASTE_TEXT = 'Synthetic private text that needs a review before it can be pasted.';

/** Composer markup of ChatGPT's current "lightweight web" client. */
function mountCurrentClient(): HTMLTextAreaElement {
  document.body.innerHTML = `
    <main>
      <div data-conversation-transcript>
        <div data-message-role="user">hello</div>
        <div data-message-role="assistant"><div data-assistant-markdown>hi</div></div>
      </div>
      <form class="wm-composer-composer">
        <textarea id="mobile-composer-prompt" class="wm-composer-textarea"
                  data-mobile-composer-prompt name="prompt"></textarea>
      </form>
    </main>`;
  return document.querySelector('textarea') as HTMLTextAreaElement;
}

/** Composer markup of the older React/ProseMirror client. */
function mountLegacyClient(): HTMLElement {
  document.body.innerHTML = `
    <main>
      <div data-message-author-role="user">hello</div>
      <div data-message-author-role="assistant">hi</div>
      <form>
        <div id="prompt-textarea" contenteditable="true" role="textbox" class="ProseMirror"><p></p></div>
      </form>
    </main>`;
  return document.querySelector('#prompt-textarea') as HTMLElement;
}

describe('ChatGptAdapter', () => {
  const adapter = new ChatGptAdapter();

  afterEach(() => {
    document.body.replaceChildren();
  });

  describe('current lightweight web client', () => {
    it('finds the textarea composer', () => {
      const composer = mountCurrentClient();
      expect(adapter.getInputElement()).toBe(composer);
    });

    it('finds assistant turns marked with data-message-role', () => {
      mountCurrentClient();
      const responses = adapter.getResponseElements();
      expect(responses).toHaveLength(1);
      expect(responses[0].getAttribute('data-message-role')).toBe('assistant');
    });

    it('skips a composer the site has disabled or made inert', () => {
      mountCurrentClient();
      const composer = document.querySelector('textarea') as HTMLTextAreaElement;
      composer.disabled = true;
      expect(adapter.getInputElement()).toBeNull();

      composer.disabled = false;
      (composer.closest('form') as HTMLElement).setAttribute('inert', '');
      expect(adapter.getInputElement()).toBeNull();
    });

    it('prefers a rendered composer over a hidden one from another build', () => {
      // Guards the ordering risk: a build that ships both a hidden mweb
      // composer and a live ProseMirror one must not resolve to the hidden one.
      document.body.innerHTML = `
        <main>
          <form>
            <textarea data-mobile-composer-prompt name="prompt"></textarea>
            <div id="prompt-textarea" contenteditable="true" role="textbox"><p></p></div>
          </form>
        </main>`;
      const hidden = document.querySelector('textarea') as HTMLTextAreaElement;
      const live = document.querySelector('#prompt-textarea') as HTMLElement;

      // jsdom reports no layout for either, so pin the distinction explicitly.
      jest.spyOn(hidden, 'getBoundingClientRect').mockReturnValue({ width: 0, height: 0 } as DOMRect);
      jest.spyOn(live, 'getBoundingClientRect').mockReturnValue({ width: 400, height: 40 } as DOMRect);

      expect(adapter.getInputElement()).toBe(live);
    });

    it('still returns a match when no candidate reports layout', () => {
      const composer = mountCurrentClient();
      // jsdom gives every element a zero rect; the composer must not be dropped.
      expect(adapter.getInputElement()).toBe(composer);
    });

    it('inserts at the caret without clobbering existing text', () => {
      const composer = mountCurrentClient();
      composer.value = 'AB';
      composer.focus();
      composer.setSelectionRange(1, 1);

      adapter.insertText(composer, 'X');

      expect(composer.value).toBe('AXB');
    });
  });

  describe('legacy React client', () => {
    it('still finds the ProseMirror composer', () => {
      const composer = mountLegacyClient();
      expect(adapter.getInputElement()).toBe(composer);
    });

    it('still finds assistant turns marked with data-message-author-role', () => {
      mountLegacyClient();
      const responses = adapter.getResponseElements();
      expect(responses).toHaveLength(1);
      expect(responses[0].getAttribute('data-message-author-role')).toBe('assistant');
    });
  });
});

describe('PasteInterceptor on the current ChatGPT client', () => {
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

  it('holds a paste into the textarea composer for review', async () => {
    const composer = mountCurrentClient();
    const callbacks = makeCallbacks();
    const interceptor = new PasteInterceptor(new ChatGptAdapter(), callbacks);
    interceptor.start();

    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: () => PASTE_TEXT },
    });
    composer.dispatchEvent(paste);

    expect(paste.defaultPrevented).toBe(true);
    await Promise.resolve();
    expect(callbacks.onAnalyzing).toHaveBeenCalledTimes(1);

    interceptor.stop();
  });

  it('restores the textarea caret when it pastes the original text back', () => {
    const composer = mountCurrentClient();
    composer.value = 'AB';
    const interceptor = new PasteInterceptor(new ChatGptAdapter(), makeCallbacks());
    interceptor.start();

    composer.focus();
    composer.setSelectionRange(1, 1);

    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: () => PASTE_TEXT },
    });
    composer.dispatchEvent(paste);

    // The overlay's "paste original" path runs after the caret has moved on.
    composer.setSelectionRange(2, 2);
    interceptor.pasteOriginal('X');

    expect(composer.value).toBe(`AXB`);

    interceptor.stop();
  });
});
