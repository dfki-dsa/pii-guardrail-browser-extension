import type { SiteAdapter } from './site-adapters/adapter-interface';
import { isTextFormControl } from './site-adapters/adapter-interface';
import type {
  CancelDetectionRequest,
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

export type CanceledPasteDecision = 'paste-original' | 'drop';

export interface PasteInterceptorCallbacks {
  onAnalyzing: () => void;
  onNoPii: (text: string) => void;
  onPiiDetected: (text: string, spans: PiiSpan[], timings?: { totalMs: number }) => void;
  onError: (error: string) => void;
  onCanceled: (explicitUserCancel?: boolean) => void;
  onExplicitCancelDecision?: (text: string) => Promise<CanceledPasteDecision> | CanceledPasteDecision;
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

    const inputElement = this.adapter.getInputElement();
    if (!inputElement) return;

    // Only intercept pastes into the chat input
    const target = event.target as HTMLElement;
    if (!inputElement.contains(target) && target !== inputElement) return;

    const text = event.clipboardData?.getData('text/plain');
    if (!text || text.length < MIN_PASTE_LENGTH) return;

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
    const input = this.adapter.getInputElement();
    if (input) {
      this.restoreSelection();
      this.adapter.insertText(input, text);
    }
  }

  /** Insert anonymized text into input. */
  pasteAnonymized(text: string): void {
    const input = this.adapter.getInputElement();
    if (input) {
      this.restoreSelection();
      this.adapter.insertText(input, text);
    }
  }
}
