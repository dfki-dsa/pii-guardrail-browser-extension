import type { SiteAdapter } from './adapter-interface';
import { insertTextCompat } from './adapter-interface';

/**
 * ChatGPT serves two different web builds depending on auth state, and their
 * DOM contracts share nothing. Both verified directly against chatgpt.com:
 *
 * - Signed out: assets under `/unauth-mweb/` (OpenAI's "web-mobile" bundle,
 *   served at desktop widths too). The composer is a `<textarea>` tagged
 *   `[data-mobile-composer-prompt]` — the selector the site's own scripts use
 *   — and turns are marked `data-message-role`. No `#prompt-textarea` exists.
 * - Signed in: the build this extension was written against. `#prompt-textarea`
 *   is the live ProseMirror `contenteditable`, and turns are marked
 *   `data-message-author-role`.
 *
 * Matching both is what makes the signed-out case work. The `isRendered`
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

const RESPONSE_SELECTOR =
  '[data-message-role="assistant"], [data-message-author-role="assistant"]';

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
    return Array.from(
      document.querySelectorAll<HTMLElement>(RESPONSE_SELECTOR)
    );
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
