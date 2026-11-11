import type { SiteAdapter } from './site-adapters/adapter-interface';
import { isTextFormControl, replaceTextCompat } from './site-adapters/adapter-interface';
import { readComposerText, stripIgnorable } from './composer-text-range';
import type {
  CancelDetectionRequest,
  ComposerMatchState,
  DetectPiiRequest,
  DetectionCanceledResponse,
  PiiResultResponse,
  PiiSpan,
} from '../shared/message-types';
import { MIN_PASTE_LENGTH } from '../shared/constants';
import { detectionOptionsFromSettings } from '../shared/detection-config';
import { loadSettings } from '../shared/storage';
import { sendRuntimeMessageBestEffort } from './runtime-messaging';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

function isExtensionReloadError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('extension context invalidated') ||
    normalized.includes('context invalidated') ||
    normalized.includes('receiving end does not exist')
  );
}

/**
 * How long a site's editor gets to react to a swap before the composer is
 * read back. Rich editors reconcile the DOM with their own state on a
 * microtask or the next frame; this is comfortably past both, and short
 * enough that the user never sees a pause.
 */
const EDITOR_SETTLE_MS = 60;

function editorSettled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, EDITOR_SETTLE_MS));
}

export type CanceledPasteDecision = 'paste-original' | 'drop';

/**
 * How this page's message box was found for a paste.
 *
 * `adapter` — the site adapter resolved it, the intended case.
 * `generic` — the adapter did not, and the paste target itself was taken as
 *   the message box. Protection held; what the adapter knows about this site
 *   has gone stale.
 * `none` — neither. Text reached the page unreviewed, or reviewed text had
 *   nowhere to land.
 */
export type ComposerMatch = ComposerMatchState;

export interface PasteInterceptorCallbacks {
  onAnalyzing: () => void;
  onNoPii: (text: string) => void;
  onPiiDetected: (text: string, spans: PiiSpan[], timings?: { totalMs: number }) => void;
  onError: (error: string) => void;
  onCanceled: (explicitUserCancel?: boolean) => void;
  onExplicitCancelDecision?: (text: string) => Promise<CanceledPasteDecision> | CanceledPasteDecision;
  /**
   * Reports how the page's message box was found, each time it matters.
   *
   * `adapter` is proof on its own and clears any standing warning — a
   * supported site can stop matching for one route or one moment of a page's
   * build and match again afterwards. The other two are only reported for a
   * paste that mattered: enough text to have been reviewed, aimed at
   * something that could have accepted it.
   */
  onComposerLookup?: (match: ComposerMatch) => void;
}

export interface PasteInterceptorOptions {
  /** Delays detection until the content script has restored its local state. */
  waitForReady?: () => Promise<void>;
}

/**
 * Saved cursor/selection state so we can restore it after async detection.
 * `<textarea>` composers (ChatGPT's current client) keep their caret on
 * `selectionStart`/`selectionEnd`, which no DOM Range can describe, so the
 * two cases are tracked separately.
 */
type SavedSelection =
  | { kind: 'range'; range: Range; inputElement: HTMLElement }
  | {
      kind: 'formControl';
      start: number;
      end: number;
      inputElement: HTMLTextAreaElement | HTMLInputElement;
    };

/**
 * Manages paste event interception on a monitored LLM chat page.
 */
export class PasteInterceptor {
  private adapter: SiteAdapter;
  private callbacks: PasteInterceptorCallbacks;
  private enabled = true;
  private requestCounter = 0;
  private activeRequestId: string | null = null;
  private canceledRequestIds = new Set<string>();
  private savedSelection: SavedSelection | null = null;
  /**
   * Where the last insert went, so `replaceInserted` addresses the same
   * message box. `start` is the caret a form control's text went in at.
   */
  private lastInsert: { inputElement: HTMLElement; start?: number } | null = null;
  private activePasteText: string | null = null;
  private waitForReady: () => Promise<void>;

  constructor(
    adapter: SiteAdapter,
    callbacks: PasteInterceptorCallbacks,
    options: PasteInterceptorOptions = {},
  ) {
    this.adapter = adapter;
    this.callbacks = callbacks;
    this.waitForReady = options.waitForReady ?? (() => Promise.resolve());
  }

  /** Start listening for paste events on the input element. */
  start(): void {
    // Capture on window so a page-level document listener cannot insert the
    // clipboard contents before the asynchronous review flow holds the paste.
    window.addEventListener('paste', this.handlePaste, true);
  }

  /** Stop listening for paste events. */
  stop(): void {
    window.removeEventListener('paste', this.handlePaste, true);
  }

  /** Enable or disable interception. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  cancelActiveDetection(): void {
    if (!this.activeRequestId) return;

    const requestId = this.activeRequestId;
    const text = this.activePasteText;
    this.canceledRequestIds.add(requestId);
    this.activeRequestId = null;

    const request: CancelDetectionRequest = {
      type: 'CANCEL_DETECTION',
      payload: { requestId },
    };
    sendRuntimeMessageBestEffort(request);

    this.callbacks.onCanceled(true);
    void this.resolveExplicitCancellation(text);
  }

  private handlePaste = (event: ClipboardEvent): void => {
    if (!this.enabled) return;

    const target = composedTarget(event);
    const adapterInput = this.adapter.getInputElement();

    // A successful lookup is evidence about the adapter regardless of where
    // this paste is aimed, so it is reported before anything else and clears
    // a standing warning even for a paste this interceptor will ignore.
    if (adapterInput) this.callbacks.onComposerLookup?.('adapter');

    const adapterOwnsTarget =
      !!adapterInput && (adapterInput === target || adapterInput.contains(target as Node | null));

    let inputElement: HTMLElement;
    let degraded = false;

    if (adapterOwnsTarget) {
      inputElement = adapterInput as HTMLElement;
    } else if (isPlausibleComposerTarget(target)) {
      // The adapter either found nothing or found something this paste is not
      // going into. Both are the same situation from here: a plausible
      // message box in front of us that the adapter does not vouch for.
      // Taking it is what keeps a vendor redesign from leaving pastes
      // unreviewed; saying so is what keeps that invisible from being fine.
      inputElement = editableHostOf(target) ?? (target as HTMLElement);
      degraded = true;
    } else {
      // A stray Ctrl+V, or a paste into a search or settings field. Neither
      // says anything about this page's message box.
      return;
    }

    const text = event.clipboardData?.getData('text/plain');
    if (!text || text.length < MIN_PASTE_LENGTH) return;

    if (degraded) this.callbacks.onComposerLookup?.('generic');

    // Save the current cursor/selection before preventing default —
    // this lets us insert at the right position after async detection.
    this.savedSelection = null;
    if (isTextFormControl(inputElement)) {
      this.savedSelection = {
        kind: 'formControl',
        start: inputElement.selectionStart ?? inputElement.value.length,
        end: inputElement.selectionEnd ?? inputElement.value.length,
        inputElement,
      };
    } else {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        this.savedSelection = {
          kind: 'range',
          range: selection.getRangeAt(0).cloneRange(),
          inputElement,
        };
      }
    }

    // Block the default paste
    event.preventDefault();
    event.stopPropagation();

    void this.processPaste(text);
  };

  private async processPaste(text: string): Promise<void> {
    try {
      await this.waitForReady();
    } catch (error) {
      this.callbacks.onError(getErrorMessage(error));
      this.pasteOriginal(text);
      return;
    }

    // Settings can disable interception while the synchronous guard holds an
    // initial page-load paste. Restore that paste once the preference is known.
    if (!this.enabled) {
      this.pasteOriginal(text);
      return;
    }

    this.callbacks.onAnalyzing();
    await this.analyze(text);
  }

  private async analyze(text: string): Promise<void> {
    const requestId = `pg_${++this.requestCounter}_${Date.now()}`;
    this.activeRequestId = requestId;
    this.activePasteText = text;

    try {
      const settings = await loadSettings();
      if (this.canceledRequestIds.delete(requestId)) {
        return;
      }

      const request: DetectPiiRequest = {
        type: 'DETECT_PII',
        payload: { text, requestId, config: detectionOptionsFromSettings(settings) },
      };

      const response: PiiResultResponse | DetectionCanceledResponse =
        await chrome.runtime.sendMessage(request);

      if (this.canceledRequestIds.delete(requestId)) {
        this.activeRequestId = null;
        return;
      }

      if (response?.type === 'DETECTION_CANCELED') {
        this.activeRequestId = null;
        this.activePasteText = null;
        this.savedSelection = null;
        this.callbacks.onCanceled(false);
        return;
      }

      if (!response || response.type !== 'PII_RESULT') {
        this.callbacks.onError('Invalid response from detection pipeline');
        // Paste the original text on error so user isn't stuck
        this.pasteOriginal(text);
        return;
      }

      const { spans, timings } = response.payload;

      if (spans.length === 0) {
        this.callbacks.onNoPii(text);
      } else {
        this.callbacks.onPiiDetected(text, spans, timings);
      }
    } catch (err) {
      if (this.canceledRequestIds.delete(requestId)) {
        this.activeRequestId = null;
        return;
      }

      const errorMessage = getErrorMessage(err);

      if (isExtensionReloadError(errorMessage)) {
        console.warn('[PG:content] Extension reloaded; refresh this page to reattach Privacy Guardrail.');
        this.savedSelection = null;
        this.callbacks.onError('Extension reloaded. Refresh this page and paste again.');
        return;
      }

      console.error('[PG:content] Detection error:', err);
      this.callbacks.onError(errorMessage);
      this.pasteOriginal(text);
    } finally {
      if (this.activeRequestId === requestId) {
        this.activeRequestId = null;
        this.activePasteText = null;
      }
    }
  }

  private async resolveExplicitCancellation(text: string | null): Promise<void> {
    try {
      if (text && this.callbacks.onExplicitCancelDecision) {
        const decision = await this.callbacks.onExplicitCancelDecision(text);
        if (decision === 'paste-original') {
          this.pasteOriginal(text);
          return;
        }
      }
    } catch (error) {
      console.error('[PG:content] Cancel decision failed:', error);
    } finally {
      this.activePasteText = null;
      this.savedSelection = null;
    }
  }

  /** Restore the saved cursor position so text inserts at the original caret. */
  private restoreSelection(): void {
    const saved = this.savedSelection;
    if (!saved) return;
    this.savedSelection = null;

    saved.inputElement.focus();

    if (saved.kind === 'formControl') {
      try {
        saved.inputElement.setSelectionRange(saved.start, saved.end);
      } catch {
        // Input types such as `email` reject setSelectionRange; the insert
        // still lands, just at the caret the browser chose on focus.
      }
      return;
    }

    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(saved.range);
    }
  }

  /** Insert original text into input (fallback on error). */
  pasteOriginal(text: string): void {
    this.insertIntoComposer(text);
  }

  /**
   * Insert anonymized text into input. False when there was no message box
   * for it to land in (already reported through `onComposerLookup`).
   */
  pasteAnonymized(text: string): boolean {
    return this.insertIntoComposer(text);
  }

  /**
   * Swap the text of the last insert for `newText` — the step behind Undo
   * and Review after an automatic replacement.
   *
   * Resolves false unless the swap demonstrably took. When `oldText` is not
   * found exactly once nothing is touched at all. When it is, the swap runs and
   * afterwards the composer is read back to confirm it now holds `newText`
   * and no longer holds `oldText`. The read-back is what stands between this
   * and an editor that redraws from its own state and quietly drops the
   * change — which would otherwise be reported as done.
   */
  async replaceInserted(oldText: string, newText: string): Promise<boolean> {
    const target = this.lastInsert;
    if (!target || !target.inputElement.isConnected) return false;

    const oldCore = stripIgnorable(oldText);
    const newCore = stripIgnorable(newText);
    if (!oldCore || !newCore) return false;

    if (oldCore === newCore) {
      // Nothing to change; true only if the text is in fact still there.
      return readComposerText(target.inputElement).includes(oldCore);
    }

    if (!replaceTextCompat(target.inputElement, oldText, newText, target.start)) {
      return false;
    }

    await editorSettled();

    const now = readComposerText(target.inputElement);
    if (!now.includes(newCore)) return false;
    // `oldCore` may legitimately survive as part of `newCore` (restoring an
    // original that happens to contain the replaced text). Otherwise its
    // presence means the editor kept the old text alongside or instead.
    if (now.includes(oldCore) && !newCore.includes(oldCore)) return false;

    return true;
  }

  /**
   * Insert into the message box the paste came from.
   *
   * The target comes from the selection saved at paste time, not from a fresh
   * adapter lookup. Review is asynchronous, and asking the adapter again
   * afterwards means the insert can land somewhere else than the text was
   * taken from — or nowhere, if the adapter has stopped matching in between,
   * which is exactly when reviewed text must not be dropped.
   *
   * The adapter is consulted only when there is no saved selection, which is
   * an insert with no paste behind it.
   */
  private insertIntoComposer(text: string): boolean {
    const input = this.savedSelection?.inputElement ?? this.adapter.getInputElement();
    if (!input) {
      // The review ran and its result has nowhere to land. That used to be a
      // bare `if (input)` with no else, which is the same silence this signal
      // exists to end.
      this.callbacks.onComposerLookup?.('none');
      this.lastInsert = null;
      return false;
    }

    const start =
      this.savedSelection?.kind === 'formControl' ? this.savedSelection.start : undefined;

    this.restoreSelection();
    this.adapter.insertText(input, text);
    this.lastInsert = { inputElement: input, start };
    return true;
  }
}

/**
 * The paste's real target.
 *
 * `event.target` is retargeted at the shadow host for a composer inside a
 * shadow root, which reads as "the message box is missing" when it is merely
 * encapsulated. `composedPath()[0]` is the node the user actually typed into.
 */
function composedTarget(event: ClipboardEvent): EventTarget | null {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  return path[0] ?? event.target;
}

/**
 * The editable element `target` belongs to: itself for a form control, the
 * `contenteditable` host for a node inside a rich editor. Insertion has to
 * address the host, not the paragraph the caret happened to be in.
 */
function editableHostOf(target: EventTarget | null): HTMLElement | null {
  const element = target as HTMLElement | null;
  if (!element || typeof element.closest !== 'function') return null;
  if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') return element;
  return element.closest<HTMLElement>(
    '[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]',
  ) ?? (element.isContentEditable ? element : null);
}

/**
 * True when this paste target could plausibly be this page's message box —
 * the precondition for taking a paste the adapter did not vouch for.
 *
 * Two things are excluded. A target that accepts no text at all: a stray
 * Ctrl+V outside any field still reaches this listener, and says nothing
 * about the adapter. And a single-line `<input>`: every composer on every
 * supported site is a textarea or a contenteditable, so a paste into a search
 * or settings field is not evidence that the site's message box moved.
 *
 * Duck-typed rather than `instanceof`-checked so it also holds for elements
 * from another realm, matching `isTextFormControl`.
 */
function isPlausibleComposerTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.closest !== 'function') return false;
  if (element.tagName === 'TEXTAREA') return true;
  // `isContentEditable` is the direct answer — and the only one that holds
  // for `contenteditable="plaintext-only"` or an inner node of an editable
  // host — but it is not implemented everywhere the tests run, so the
  // attribute lookup backs it up.
  if (element.isContentEditable) return true;
  return element.closest(
    '[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]',
  ) !== null;
}
