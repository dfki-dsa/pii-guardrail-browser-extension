/**
 * Privacy Guardrail — Clipboard Interceptor (isolated coordinator)
 *
 * Drives a singleton "Replace with originals" toast. Two trigger sources:
 *
 *   1. `WRITE_INTERCEPTED` postMessages forwarded by the main-world patch
 *      (covers code paths that call `navigator.clipboard.writeText`).
 *   2. Capture + bubble-phase `copy` DOM events on `document` — the path
 *      used by Ctrl+C / right-click → Copy and by copy implementations that
 *      stage text through `clipboardData.setData(...)`. Capture gives manual
 *      selection copies a reliable selection fallback; bubble sees text that
 *      page handlers staged during the event.
 *
 * On Replace, route the de-anonymised text back to the system clipboard.
 * For postMessage triggers we send `REPLACE_CLIPBOARD` to the main world
 * (which uses the captured-original `writeText`); for `copy`-event
 * triggers the isolated world calls `navigator.clipboard.writeText`
 * directly (a different JS world from the page, so the page-world patch
 * doesn't observe it).
 *
 * State is intentionally minimal: the entity-map / vault snapshot is
 * provided by an injected resolver callback, keeping this module
 * decoupled from storage and easily testable.
 */

import { ClipboardToast } from '../ui/clipboard-toast/clipboard-toast';
import type { ResolveResult } from '../shared/placeholder-resolver';

const SOURCE = 'pg-clipboard-intercept';

interface WriteInterceptedMessage {
  source: typeof SOURCE;
  kind: 'WRITE_INTERCEPTED';
  text: string;
  requestId: string;
}

export type ResolveCallback = (
  text: string,
) => ResolveResult | Promise<ResolveResult>;

export interface ClipboardInterceptorOptions {
  /** Returns the unified resolver decision for the just-copied text.
   *  Implementations are expected to load the latest conversation
   *  entity map + identity vault, augment, and call `resolveText`. */
  resolve: ResolveCallback;
  /** Theme to render the toast in. Updated via {@link setTheme}. */
  theme?: 'dark' | 'light';
  /** Whether the feature is currently enabled. Updated via
   *  {@link setEnabled}. */
  enabled?: boolean;
}

/** Function that performs the actual clipboard replacement when the
 *  user clicks "Replace with originals". The path that performs the
 *  replacement depends on the trigger source. */
type ReplaceFn = (deAnonText: string) => void;

export class ClipboardInterceptor {
  private resolve: ResolveCallback;
  private theme: 'dark' | 'light';
  private enabled: boolean;
  private toast: ClipboardToast | null = null;
  /** Most recent "what we just saw copied" — used to suppress duplicate
   *  triggers when both the writeText patch and the `copy` DOM event
   *  fire for one logical user action. */
  private lastSeenText: string | null = null;
  private lastSeenAt = 0;
  private messageListener: ((event: MessageEvent) => void) | null = null;
  private copyListener: ((event: ClipboardEvent) => void) | null = null;
  private started = false;

  constructor(opts: ClipboardInterceptorOptions) {
    this.resolve = opts.resolve;
    this.theme = opts.theme ?? 'dark';
    this.enabled = opts.enabled ?? true;
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    this.messageListener = (event: MessageEvent) => this.onWindowMessage(event);
    window.addEventListener('message', this.messageListener);

    this.copyListener = (event: ClipboardEvent) => this.onCopy(event);
    // Capture phase covers manual selections early; bubble phase preserves
    // support for pages that populate clipboardData in their own handlers.
    document.addEventListener('copy', this.copyListener, true);
    document.addEventListener('copy', this.copyListener, false);
  }

  stop(): void {
    if (!this.started) return;
    if (this.messageListener)
      window.removeEventListener('message', this.messageListener);
    if (this.copyListener) {
      document.removeEventListener('copy', this.copyListener, true);
      document.removeEventListener('copy', this.copyListener, false);
    }
    this.messageListener = null;
    this.copyListener = null;
    this.started = false;
    this.disposeToast();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.disposeToast();
  }

  setTheme(theme: 'dark' | 'light'): void {
    this.theme = theme;
  }

  /** Trigger the toast pipeline for an arbitrary copied string. The
   *  `replace` callback is what actually performs the clipboard swap if
   *  the user clicks Replace. Public so tests can drive the coordinator
   *  without round-tripping through DOM events or postMessage. */
  async handleCopiedText(text: string, replace: ReplaceFn): Promise<void> {
    if (!this.enabled) return;
    if (!text) return;

    // Dedupe: if the same text was just observed within ~250 ms, skip.
    // Two trigger sources may fire for one user action (e.g. a button
    // that calls `writeText` AND dispatches a copy event); we only want
    // one toast per logical copy.
    const now = Date.now();
    if (this.lastSeenText === text && now - this.lastSeenAt < 250) return;
    this.lastSeenText = text;
    this.lastSeenAt = now;

    let result: ResolveResult;
    try {
      result = await this.resolve(text);
    } catch {
      return;
    }
    if (!result || result.matches.length === 0) return;

    this.disposeToast();
    this.toast = new ClipboardToast(this.theme, {
      onReplace: () => replace(result.deAnonText),
      onDispose: () => {
        this.toast = null;
      },
    });
    this.toast.show();
  }

  /** Test seam preserved from the original API. Routes through the
   *  postMessage-style replace path. */
  handleIntercepted(text: string, requestId: string): Promise<void> {
    return this.handleCopiedText(text, (deAnonText) => {
      const msg = {
        source: SOURCE,
        kind: 'REPLACE_CLIPBOARD',
        text: deAnonText,
        requestId,
      };
      window.postMessage(msg, '*');
    });
  }

  private onWindowMessage(event: MessageEvent): void {
    if (event.source !== window) return;
    const data = event.data as WriteInterceptedMessage | undefined;
    if (!data || data.source !== SOURCE) return;
    if (data.kind !== 'WRITE_INTERCEPTED') return;
    void this.handleIntercepted(data.text, data.requestId);
  }

  private onCopy(event: ClipboardEvent): void {
    if (!this.enabled) return;
    // Prefer text already staged on the event. Fall back to the current
    // selection — needed for Ctrl+C / right-click copy paths where the
    // browser default action writes to the system clipboard after JS has
    // observed the event and does not expose that default text via
    // clipboardData.getData().
    let text = '';
    try {
      text = event.clipboardData?.getData('text/plain') ?? '';
    } catch {
      text = '';
    }
    if (!text) {
      const selection = window.getSelection?.();
      text = selection ? selection.toString() : '';
    }
    if (!text) return;

    void this.handleCopiedText(text, (deAnonText) => {
      // Different JS world from the page, so navigator.clipboard.writeText
      // here is the unmodified browser implementation — no recursion.
      navigator.clipboard?.writeText(deAnonText).catch(() => {
        // Swallow; the user has already moved past the toast.
      });
    });
  }

  private disposeToast(): void {
    if (this.toast) {
      this.toast.dispose();
      this.toast = null;
    }
  }
}
