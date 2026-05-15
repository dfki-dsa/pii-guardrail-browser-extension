import type { SiteAdapter } from './site-adapters/adapter-interface';
import { hasPotentialPlaceholderShape } from '../shared/placeholder-variants';
import { RESPONSE_DEBOUNCE_MS } from '../shared/constants';

export interface ResponseObserverCallbacks {
  onResponseWithPlaceholders: (element: HTMLElement, text: string) => void;
  /** Optional sync predicate that returns true when `text` contains a
   *  known synthetic value from the identity vault. The shape gate alone
   *  misses responses that only echo back synthetic strings (e.g.
   *  "Jordan Park"), which have no placeholder-like form. */
  hasKnownSynthetic?: (text: string) => boolean;
}

/**
 * Watches for AI response elements containing anonymized placeholders.
 * Uses debouncing to wait for streaming responses to stabilize.
 */
export class ResponseObserver {
  private adapter: SiteAdapter;
  private callbacks: ResponseObserverCallbacks;
  private observer: MutationObserver | null = null;
  private debounceTimers = new Map<HTMLElement, number>();

  constructor(adapter: SiteAdapter, callbacks: ResponseObserverCallbacks) {
    this.adapter = adapter;
    this.callbacks = callbacks;
  }

  /** Start observing for AI responses. */
  start(): void {
    this.observer = this.adapter.observeResponses((element) => {
      this.watchElement(element);
    });

    // Also check existing response elements
    for (const el of this.adapter.getResponseElements()) {
      this.checkForPlaceholders(el);
    }
  }

  /** Stop observing. */
  stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  /**
   * Watch a response element for changes (streaming) and check for
   * placeholders once the content stabilizes.
   */
  private watchElement(element: HTMLElement): void {
    const innerObserver = new MutationObserver(() => {
      // Debounce: reset timer on each mutation
      const existing = this.debounceTimers.get(element);
      if (existing) clearTimeout(existing);

      const timer = window.setTimeout(() => {
        this.debounceTimers.delete(element);
        innerObserver.disconnect();
        this.checkForPlaceholders(element);
      }, RESPONSE_DEBOUNCE_MS);

      this.debounceTimers.set(element, timer);
    });

    innerObserver.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Also do an immediate check in case content is already complete
    setTimeout(() => this.checkForPlaceholders(element), RESPONSE_DEBOUNCE_MS);
  }

  private checkForPlaceholders(element: HTMLElement): void {
    const text = collectResponseText(element);
    // Permissive shape gate so the banner-attach path also fires for
    // responses where every placeholder was mangled (`PERSON 1`,
    // `person_1`, …). False positives are harmless: the banner re-checks
    // against the entity map and bails when nothing is revealable.
    const hasShape = hasPotentialPlaceholderShape(text);
    const hasSynthetic = this.callbacks.hasKnownSynthetic?.(text) ?? false;
    if (hasShape || hasSynthetic) {
      this.callbacks.onResponseWithPlaceholders(element, text);
    }
  }
}

/**
 * Concatenate the response's visible text with the current `value` of any
 * descendant form controls. Artifact-style replies (e.g. Claude's "open in
 * mail" card) render their content into `<input>` / `<textarea>`, whose
 * current value lives on the `.value` property and is not surfaced via
 * `Node.textContent` for controlled React components.
 */
function collectResponseText(element: HTMLElement): string {
  const parts: string[] = [element.textContent || ''];
  const controls = element.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'input, textarea',
  );
  for (const control of controls) {
    if (control.value) parts.push(control.value);
  }
  return parts.join('\n');
}
