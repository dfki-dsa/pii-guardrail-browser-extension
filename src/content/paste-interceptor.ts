import type { SiteAdapter } from './site-adapters/adapter-interface';
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
  onNoPii: (text: string, pasteId: string) => void;
  onPiiDetected: (
    text: string,
    spans: PiiSpan[],
    pasteId: string,
    timings?: { totalMs: number },
  ) => void;
  onError: (error: string) => void;
  onCanceled: (explicitUserCancel?: boolean) => void;
  onExplicitCancelDecision?: (text: string) => Promise<CanceledPasteDecision> | CanceledPasteDecision;
}

export interface PasteInterceptorOptions {
  /** Delays detection until the content script has restored its local state. */
  waitForReady?: () => Promise<void>;
}

/** Saved cursor/selection state so we can restore it after async detection. */
interface SavedSelection {
  range: Range;
  inputElement: HTMLElement;
}

interface PendingPaste {
  targetElement: HTMLElement | null;
  savedSelection: SavedSelection | null;
}

interface ActiveRequest {
  requestId: string;
  pasteId: string;
  text: string;
}

/**
 * Manages paste event interception on a monitored LLM chat page.
 */
export class PasteInterceptor {
  private adapter: SiteAdapter;
  private callbacks: PasteInterceptorCallbacks;
  private enabled = true;
  private pasteCounter = 0;
  private requestCounter = 0;
  private activeRequest: ActiveRequest | null = null;
  private canceledRequestIds = new Set<string>();
  private activePastes = new Map<string, PendingPaste>();
  private analysisQueue: Promise<void> = Promise.resolve();
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
    if (!this.activeRequest) return;

    const { requestId, pasteId, text } = this.activeRequest;
    this.canceledRequestIds.add(requestId);
    this.activeRequest = null;

    const request: CancelDetectionRequest = {
      type: 'CANCEL_DETECTION',
      payload: { requestId },
    };
    sendRuntimeMessageBestEffort(request);

    this.callbacks.onCanceled(true);
    void this.resolveExplicitCancellation(text, pasteId);
  }

  private handlePaste = (event: ClipboardEvent): void => {
    if (!this.enabled) return;

    const path = event.composedPath();

    // Dynamically locate the editable element target directly from the paste event's composed path
    let inputElement: HTMLElement | null = null;
    for (const target of path) {
      if (target instanceof HTMLElement) {
        const tag = target.tagName.toUpperCase();
        const isEditable =
          tag === 'TEXTAREA' ||
          tag === 'INPUT' ||
          target.getAttribute('contenteditable') === 'true' ||
          target.isContentEditable;
        if (isEditable) {
          inputElement = target;
          break;
        }
      }
    }

    if (!inputElement) {
      inputElement = this.adapter.getInputElement();
    }

    if (!inputElement) return;

    console.log(
      '[PG:content] PASTE EVENT DETECTED! Target:',
      (event.target as any)?.tagName,
      'Resolved inputElement:',
      inputElement.tagName,
    );

    const text = event.clipboardData?.getData('text/plain');
    if (!text || text.length < MIN_PASTE_LENGTH) return;

    let savedSelection: SavedSelection | null = null;
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      savedSelection = {
        range: selection.getRangeAt(0).cloneRange(),
        inputElement,
      };
    }

    const pasteId = `paste_${++this.pasteCounter}_${Date.now()}`;
    this.activePastes.set(pasteId, { targetElement: inputElement, savedSelection });

    // Block the default paste
    event.preventDefault();
    event.stopPropagation();

    void this.processPaste(text, pasteId);
  };

  private async processPaste(text: string, pasteId: string): Promise<void> {
    try {
      await this.waitForReady();
    } catch (error) {
      this.callbacks.onError(getErrorMessage(error));
      this.pasteOriginal(text, pasteId);
      return;
    }

    // Settings can disable interception while the synchronous guard holds an
    // initial page-load paste. Restore that paste once the preference is known.
    if (!this.enabled) {
      this.pasteOriginal(text, pasteId);
      return;
    }

    // The content script exposes one scanning indicator and one cancel action.
    // Serialize detection while keeping each pending paste's destination
    // separate, so a later paste cannot replace the active request's
    // cancellation state or dismiss its progress UI.
    const queuedAnalysis = this.analysisQueue.then(async () => {
      if (!this.activePastes.has(pasteId)) return;
      this.callbacks.onAnalyzing();
      await this.analyze(text, pasteId);
    });
    this.analysisQueue = queuedAnalysis.catch(() => undefined);
    await queuedAnalysis;
  }

  private async analyze(
    text: string,
    pasteId = `paste_${++this.pasteCounter}_${Date.now()}`,
  ): Promise<void> {
    const requestId = `pg_${++this.requestCounter}_${Date.now()}`;
    this.activeRequest = { requestId, pasteId, text };

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

      const explicitlyCanceled = this.canceledRequestIds.delete(requestId);

      if (response?.type === 'DETECTION_CANCELED') {
        // The explicit cancellation flow still needs the saved destination if
        // the user chooses "paste original". Its decision handler owns cleanup.
        if (explicitlyCanceled) return;
        this.activePastes.delete(pasteId);
        this.callbacks.onCanceled(false);
        return;
      }

      if (explicitlyCanceled) return;

      if (!response || response.type !== 'PII_RESULT') {
        this.callbacks.onError('Invalid response from detection pipeline');
        // Paste the original text on error so user isn't stuck
        this.pasteOriginal(text, pasteId);
        return;
      }

      const { spans, timings } = response.payload;

      if (spans.length === 0) {
        this.callbacks.onNoPii(text, pasteId);
      } else {
        this.callbacks.onPiiDetected(text, spans, pasteId, timings);
      }
    } catch (err) {
      if (this.canceledRequestIds.delete(requestId)) {
        return;
      }

      const errorMessage = getErrorMessage(err);

      if (isExtensionReloadError(errorMessage)) {
        console.warn('[PG:content] Extension reloaded; refresh this page to reattach Privacy Guardrail.');
        this.activePastes.delete(pasteId);
        this.callbacks.onError('Extension reloaded. Refresh this page and paste again.');
        return;
      }

      console.error('[PG:content] Detection error:', err);
      this.callbacks.onError(errorMessage);
      this.pasteOriginal(text, pasteId);
    } finally {
      if (this.activeRequest?.requestId === requestId) {
        this.activeRequest = null;
      }
    }
  }

  private async resolveExplicitCancellation(text: string, pasteId: string): Promise<void> {
    try {
      if (this.callbacks.onExplicitCancelDecision) {
        const decision = await this.callbacks.onExplicitCancelDecision(text);
        if (decision === 'paste-original') {
          this.pasteOriginal(text, pasteId);
          return;
        }
      }
    } catch (error) {
      console.error('[PG:content] Cancel decision failed:', error);
    } finally {
      this.activePastes.delete(pasteId);
    }
  }

  /** Insert original text into input (fallback on error). */
  pasteOriginal(text: string, pasteId?: string): void {
    const state = pasteId ? this.activePastes.get(pasteId) : undefined;
    const input = state?.savedSelection?.inputElement || state?.targetElement || this.adapter.getInputElement();
    if (input) {
      if (state?.savedSelection) {
        input.focus();
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(state.savedSelection.range);
        }
      }
      this.adapter.insertText(input, text);
    }
    if (pasteId) this.activePastes.delete(pasteId);
  }

  /** Insert anonymized text into input. */
  pasteAnonymized(text: string, pasteId: string): void {
    const state = this.activePastes.get(pasteId);
    const input = state?.savedSelection?.inputElement || state?.targetElement || this.adapter.getInputElement();
    if (input) {
      if (state?.savedSelection) {
        input.focus();
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(state.savedSelection.range);
        }
      }
      this.adapter.insertText(input, text);
    }
    this.activePastes.delete(pasteId);
  }
}
