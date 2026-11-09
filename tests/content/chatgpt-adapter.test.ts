/** @jest-environment jsdom */

import { ChatGptAdapter } from '../../src/content/site-adapters/chatgpt-adapter';
import { findLooseTokenAnchors } from '../../src/content/banner-anchor';
import {
  PasteInterceptor,
  type ComposerMatch,
  type PasteInterceptorCallbacks,
} from '../../src/content/paste-interceptor';
import { DEFAULT_SETTINGS } from '../../src/shared/constants';
import { deriveChipReason } from '../../src/shared/page-status-chip-reason';
import type { SystemCompatibilityStatus } from '../../src/shared/message-types';

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

  describe('app shell client', () => {
    /**
     * Turn markup of the build with `[data-app-shell-*]` chrome, which has no
     * role attributes. Ancestor chain and unit keys as captured from
     * chatgpt.com on 2026-11-08 (`fallback-turn-0:0:user`,
     * `fallback-turn-0:1:assistant`); paragraph content is synthetic.
     *
     * The second turn is the first one's sibling with the two unit-key
     * attributes nested the other way round, since the site sets them side
     * by side and the adapter promises to cope with either order.
     */
    function mountAppShellClient(): void {
      document.body.innerHTML = `
        <main data-app-shell-main-surface="browser">
          <div data-thread-find-target="conversation">
            <div data-turn-key="a40187b1">
              <div data-content-search-turn-key="fallback-turn-0">
                <div data-chatgpt-search-unit-key="fallback-turn-0:0:user">
                  <div data-content-search-unit-key="fallback-turn-0:0:user">
                    <div data-user-message-bubble="true">
                      <div><p data-d-component="text">Please reply to [PERSON_1].</p></div>
                    </div>
                  </div>
                </div>
                <div data-chatgpt-search-unit-key="fallback-turn-0:1:assistant">
                  <div data-content-search-unit-key="fallback-turn-0:1:assistant">
                    <p data-d-component="text">From: [PERSON_1]</p>
                    <div data-d-component="divider"></div>
                    <p data-d-component="text">Send the money to [PERSON_4].</p>
                  </div>
                </div>
              </div>
            </div>
            <div data-turn-key="b51298c2">
              <div data-content-search-turn-key="fallback-turn-1">
                <div data-content-search-unit-key="fallback-turn-1:0:user">
                  <div data-chatgpt-search-unit-key="fallback-turn-1:0:user">
                    <div data-user-message-bubble="true">
                      <div><p data-d-component="text">And cc [PERSON_2].</p></div>
                    </div>
                  </div>
                </div>
                <div data-content-search-unit-key="fallback-turn-1:1:assistant">
                  <div data-chatgpt-search-unit-key="fallback-turn-1:1:assistant">
                    <p data-d-component="text">Done, [PERSON_2] is copied.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>`;
    }

    /** The unit key an element carries, whichever of the two attributes it is. */
    function unitKey(element: HTMLElement): string | null {
      return (
        element.getAttribute('data-chatgpt-search-unit-key') ??
        element.getAttribute('data-content-search-unit-key')
      );
    }

    it('finds one element per assistant message, not one per nested unit key', () => {
      mountAppShellClient();
      const responses = adapter.getResponseElements();
      expect(responses.map(unitKey)).toEqual([
        'fallback-turn-0:1:assistant',
        'fallback-turn-1:1:assistant',
      ]);
      expect(responses[0].textContent).toContain('[PERSON_4]');
      expect(responses[1].textContent).toContain('[PERSON_2]');
    });

    it('keeps the outer unit whichever attribute the site nests on top', () => {
      mountAppShellClient();
      const [first, second] = adapter.getResponseElements();
      // Turn 0 nests chatgpt > content, turn 1 the other way round. Either
      // way the kept element must be the one that holds the whole message.
      expect(first.hasAttribute('data-chatgpt-search-unit-key')).toBe(true);
      expect(first.querySelector('[data-content-search-unit-key]')).not.toBeNull();
      expect(second.hasAttribute('data-content-search-unit-key')).toBe(true);
      expect(second.querySelector('[data-chatgpt-search-unit-key]')).not.toBeNull();
      // Nothing returned may sit inside another returned element.
      expect(first.contains(second)).toBe(false);
      expect(second.contains(first)).toBe(false);
    });

    it('finds one element per user message so none ever carries a banner', () => {
      mountAppShellClient();
      const users = adapter.getUserMessageElements();
      expect(users.map(unitKey)).toEqual(['fallback-turn-0:0:user', 'fallback-turn-1:0:user']);
      expect(users[0].textContent).toContain('Please reply to');
      expect(users[1].textContent).toContain('And cc');
    });

    it('never files a user message as a reply or a reply as a user message', () => {
      mountAppShellClient();
      const responses = adapter.getResponseElements();
      const users = adapter.getUserMessageElements();
      for (const user of users) {
        for (const response of responses) {
          expect(user).not.toBe(response);
          expect(user.contains(response)).toBe(false);
          expect(response.contains(user)).toBe(false);
        }
      }
      // The role is a key suffix: no reply may carry a user key and vice versa.
      expect(responses.every((el) => unitKey(el)?.endsWith(':assistant'))).toBe(true);
      expect(users.every((el) => unitKey(el)?.endsWith(':user'))).toBe(true);
    });

    it('matches on the role suffix alone, not on the turn or index', () => {
      // A reply that is the first unit of its turn, under a differently
      // shaped turn key, must still be found by the `:assistant` suffix.
      document.body.innerHTML = `
        <main data-app-shell-main-surface="browser">
          <div data-chatgpt-search-unit-key="conv-9f3:0:assistant">
            <div data-content-search-unit-key="conv-9f3:0:assistant">
              <p data-d-component="text">Hello</p>
            </div>
          </div>
          <div data-chatgpt-search-unit-key="conv-9f3:1:user">
            <div data-content-search-unit-key="conv-9f3:1:user">
              <p data-d-component="text">Hi</p>
            </div>
          </div>
        </main>`;
      expect(adapter.getResponseElements().map(unitKey)).toEqual(['conv-9f3:0:assistant']);
      expect(adapter.getUserMessageElements().map(unitKey)).toEqual(['conv-9f3:1:user']);
    });

    it('leaves the generic fallback nothing to annotate', () => {
      mountAppShellClient();
      const anchors = findLooseTokenAnchors(
        document.body,
        adapter.getResponseElements(),
        null,
        (text) => /\[PERSON_\d+\]/.test(text),
        adapter.getUserMessageElements(),
      );
      expect(anchors).toEqual([]);
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
    onComposerLookup: jest.fn(),
  });

  /** A system with nothing wrong with it, so only the page can be at fault. */
  const healthySystem: SystemCompatibilityStatus = {
    schemaVersion: 1,
    policyVersion: 2,
    checkedAt: 1,
    browserMemoryGb: 16,
    webGpu: 'available',
    tier: 'ok',
    recommendation: 'none',
    notes: [],
    localAiState: 'enabled',
    runtimeState: 'ready',
    criticalModal: 'none',
  };

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

  it('reviews and reports a page whose composer no adapter selector matches', () => {
    // The pre-#32 world in miniature: a real message box wearing markup this
    // adapter knows nothing about. The paste used to go through unreviewed;
    // now the target itself is taken as the message box, and the page says so
    // rather than presenting the guess as a healthy match.
    document.body.innerHTML = `
      <main>
        <div data-message-role="assistant">hi</div>
        <form><textarea data-composer-shape-we-have-never-seen></textarea></form>
      </main>`;
    const composer = document.querySelector('textarea') as HTMLTextAreaElement;
    const seen: ComposerMatch[] = [];
    const callbacks = {
      ...makeCallbacks(),
      onComposerLookup: (match: ComposerMatch) => {
        seen.push(match);
      },
    };
    const interceptor = new PasteInterceptor(new ChatGptAdapter(), callbacks);
    interceptor.start();

    const paste = new Event('paste', {
      bubbles: true,
      cancelable: true,
      composed: true,
    }) as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: () => PASTE_TEXT },
    });
    composer.dispatchEvent(paste);

    expect(paste.defaultPrevented).toBe(true);
    expect(seen).toEqual(['generic']);
    // Nothing about the system is degraded, and protection held, so the chip
    // stays clear — the degraded state is the popup's quiet line, not the
    // warning reserved for pastes that really were not reviewed.
    expect(deriveChipReason({ status: healthySystem })).toBeNull();
    expect(
      deriveChipReason({ status: healthySystem, composerMissing: seen.includes('none') }),
    ).toBeNull();

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
