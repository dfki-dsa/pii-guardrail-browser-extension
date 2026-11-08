import type { SiteAdapter } from './adapter-interface';
import { insertTextCompat } from './adapter-interface';

/**
 * ChatGPT serves two different web builds whose DOM contracts share nothing.
 * Both verified directly against chatgpt.com:
 *
 * - "web-mobile" (OpenAI's `/unauth-mweb/` bundle): rooted at
 *   `#web-mobile-root`, with `main[data-mobile-shell="desktop"]` at desktop
 *   widths. The composer is a `<textarea>` tagged
 *   `[data-mobile-composer-prompt]` — the selector the site's own scripts use
 *   — and turns are `li[data-message-role]`. No `#prompt-textarea` exists.
 * - The build this extension was written against: `#prompt-textarea` is the
 *   live ProseMirror `contenteditable`, and turns are marked
 *   `data-message-author-role`.
 *
 * Do not treat the web-mobile build as the signed-out case. It was first
 * observed that way, but it is also served to signed-in desktop users with
 * persisted conversations. Both contracts below must hold for either build.
 *
 * The two also differ in how they route a conversation (`/c/<id>` against
 * `/uc/<id>`), which this adapter deliberately does not encode. Matching
 * routes here was tried and rotted silently; continuity is decided from page
 * content instead — see `conversation-continuity.ts`.
 *
 * Matching both is what makes the web-mobile case work. The `isRendered`
 * tie-break below is purely defensive: no observed page needs it, since the
 * two contracts have so far never appeared together. It exists because
 * matching two contracts introduces an ordering hazard that returning the
 * first match unconditionally would hide — and the old code's unconditional
 * `querySelector` failure mode was a silent no-op, which is the worst
 * possible way for this to break.
 */
const INPUT_SELECTORS = [
  '[data-mobile-composer-prompt]',
  '#prompt-textarea',
  'form textarea[name="prompt"]',
  '[contenteditable="true"][role="textbox"]',
  '[contenteditable="true"]',
];

/**
 * A third build, the "app shell" (`[data-app-shell-*]` chrome, text rendered
 * as `[data-d-component="text"]`), carries neither role attribute. Its turns
 * are a user/assistant pair under `[data-turn-key]`, and each message is a
 * search unit keyed `<turn>:<index>:<role>`, e.g. `fallback-turn-0:0:user`.
 * The role is only readable as that key's suffix. Both unit attributes are
 * matched, since the site sets the two side by side and either may go first.
 *
 * Without these the adapter matches no reply on that build, and the generic
 * fallback puts a banner over every paragraph that holds a token — including
 * the user's own message, which only these selectors can exclude.
 */
const RESPONSE_SELECTOR = [
  '[data-message-role="assistant"]',
  '[data-message-author-role="assistant"]',
  '[data-content-search-unit-key$=":assistant"]',
  '[data-chatgpt-search-unit-key$=":assistant"]',
].join(', ');

const USER_MESSAGE_SELECTOR = [
  '[data-message-role="user"]',
  '[data-message-author-role="user"]',
  '[data-content-search-unit-key$=":user"]',
  '[data-chatgpt-search-unit-key$=":user"]',
].join(', ');

/**
 * Keep only the outermost of nested matches. In the app shell build the two
 * unit-key attributes sit on a parent and child, so one message matches twice;
 * a banner each would put the duplication straight back.
 *
 * Relies on `querySelectorAll` returning document order: an element's
 * descendants follow it contiguously, so comparing against the last kept
 * match is enough. This runs on every mutation while a reply streams.
 */
function outermost(elements: Iterable<HTMLElement>): HTMLElement[] {
  const kept: HTMLElement[] = [];
  for (const element of elements) {
    const last = kept[kept.length - 1];
    if (last && last.contains(element)) continue;
    kept.push(element);
  }
  return kept;
}


/**
 * Reject composer candidates the site itself treats as unusable. Mirrors
 * ChatGPT's own guard (`disabled`, or nested in `[hidden]`/`[inert]`), which
 * matters at desktop widths where a second, inert composer can be present.
 * Deliberately avoids layout-dependent checks such as `offsetParent`, since
 * the content script runs at `document_start`.
 */
function isUsableInput(element: HTMLElement): boolean {
  if ((element as HTMLTextAreaElement).disabled) return false;
  if (element.closest('[hidden],[inert]')) return false;
  return true;
}

/**
 * Whether the element is actually rendered. Only consulted to break ties
 * between usable candidates: `getInputElement` runs on paste, long after
 * layout, but must still return something if layout is unavailable.
 */
function isRendered(element: HTMLElement): boolean {
  if (element.offsetParent !== null) return true;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}

export class ChatGptAdapter implements SiteAdapter {
  readonly name = 'ChatGPT';

  getInputElement(): HTMLElement | null {
    let fallback: HTMLElement | null = null;

    for (const selector of INPUT_SELECTORS) {
      const candidates = document.querySelectorAll<HTMLElement>(selector);
      for (const candidate of candidates) {
        if (!isUsableInput(candidate)) continue;
        if (isRendered(candidate)) return candidate;
        fallback ??= candidate;
      }
    }

    // Nothing was rendered — either the page is still building or layout is
    // unavailable. Returning the best match still beats dropping the paste.
    return fallback;
  }

  getResponseElements(): HTMLElement[] {
    return outermost(document.querySelectorAll<HTMLElement>(RESPONSE_SELECTOR));
  }

  getUserMessageElements(): HTMLElement[] {
    return outermost(document.querySelectorAll<HTMLElement>(USER_MESSAGE_SELECTOR));
  }

  insertText(element: HTMLElement, text: string): void {
    insertTextCompat(element, text);
  }

  observeResponses(callback: (element: HTMLElement) => void): MutationObserver {
    // Observe `main` (the app shell) rather than the transcript element:
    // both clients replace the transcript on conversation switches, which
    // would silently disconnect an observer bound to it.
    const container =
      document.querySelector('main') || document.body;

    const seen = new WeakSet<HTMLElement>();

    const observer = new MutationObserver(() => {
      const responses = this.getResponseElements();
      for (const el of responses) {
        if (!seen.has(el)) {
          seen.add(el);
          callback(el);
        }
      }
    });

    observer.observe(container, { childList: true, subtree: true });
    return observer;
  }
}
