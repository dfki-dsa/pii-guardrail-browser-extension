/**
 * Privacy Guardrail — Auto-replace Toast (Shadow DOM)
 *
 * Non-blocking notice shown after a paste was replaced automatically, with
 * the two ways back to a decision the user never got to make:
 *
 *  - "Undo" puts the original text back in the message box.
 *  - "Review" opens the review pop-up for that paste.
 *
 * Ignoring it keeps the replacement; it auto-dismisses after ~8 seconds,
 * paused while the pointer hovers or keyboard focus is inside it.
 *
 * Undo can fail — the text was edited or already sent — and the toast then
 * says so rather than disappearing. In that case nothing was changed, which
 * leaves the replaced text in place.
 *
 * Kept separate from `ClipboardToast` on purpose: that one has a single
 * action whose outcome is always "done", and folding the two together would
 * put the clipboard flow at risk for the sake of shared plumbing.
 */

import { SHADOW_DESIGN_SYSTEM_STYLES } from '../shared/shadow-design-system';

const TOAST_AUTO_DISMISS_MS = 8000;
const RESULT_VISIBLE_MS = 1800;
/** A failure has to be read, so it stays up longer than a confirmation. */
const FAILURE_VISIBLE_MS = 5000;

const AUTO_REPLACE_TOAST_STYLES = `
  ${SHADOW_DESIGN_SYSTEM_STYLES}

  .pg-toast {
    position: fixed;
    bottom: 132px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483646;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    width: max-content;
    max-width: min(520px, calc(100vw - 32px));
    padding: 10px 12px;
    border-radius: var(--pg-radius-md);
    font-size: 13px;
    line-height: 1.4;
    pointer-events: auto;
    animation: pg-design-pop-in 160ms ease-out;
  }

  .pg-toast-status {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--pg-color-success);
    box-shadow: 0 0 0 3px rgb(34 197 94 / 16%);
    flex: 0 0 auto;
  }

  .pg-toast[data-state="failed"] .pg-toast-status {
    background: #f59e0b;
    box-shadow: 0 0 0 3px rgb(245 158 11 / 18%);
  }

  .pg-toast-msg {
    flex: 1;
    min-width: 0;
    margin-right: 4px;
  }

  .pg-toast-btn {
    padding: 6px 10px;
    white-space: nowrap;
  }

  .pg-toast-btn[hidden] {
    display: none;
  }

  .pg-toast-btn:disabled {
    cursor: default;
    opacity: 0.6;
  }

  @media (max-width: 520px) {
    .pg-toast {
      flex-wrap: wrap;
      width: calc(100vw - 32px);
    }

    .pg-toast-msg {
      flex-basis: 100%;
    }
  }
`;

export const AUTO_REPLACE_UNDO_FAILED_MESSAGE =
  "Couldn't restore the original — the message was edited or sent. Nothing was changed.";

export interface AutoReplaceToastCallbacks {
  /**
   * Called when the user clicks "Undo". Resolves true when the original text
   * is back in the message box, false when it could not be restored.
   */
  onUndo: () => Promise<boolean> | boolean;
  /** Called when the user clicks "Review"; the toast disposes itself first. */
  onReview: () => void;
  /** Called once when the toast disposes itself, for whatever reason. */
  onDispose?: () => void;
}

export function replacedItemsLabel(count: number): string {
  return count === 1 ? '1 item replaced' : `${count} items replaced`;
}

export class AutoReplaceToast {
  private host: HTMLDivElement;
  private shadow: ShadowRoot;
  private toastEl: HTMLDivElement | null = null;
  private msgEl: HTMLSpanElement | null = null;
  private reviewBtn: HTMLButtonElement | null = null;
  private undoBtn: HTMLButtonElement | null = null;
  private dismissTimer: number | null = null;
  private mounted = false;
  private disposed = false;
  /** Set once a button was used; the toast then only reports and leaves. */
  private settled = false;
  private readonly cbs: AutoReplaceToastCallbacks;

  constructor(theme: 'dark' | 'light', count: number, cbs: AutoReplaceToastCallbacks) {
    this.cbs = cbs;
    this.host = document.createElement('div');
    this.host.id = 'pg-auto-replace-toast-host';
    this.shadow = this.host.attachShadow({ mode: 'closed' });
    this.shadow.innerHTML = `
      <style>${AUTO_REPLACE_TOAST_STYLES}</style>
      <div class="pg-toast pg-design-surface" data-theme="${theme}" data-state="default" role="status" aria-live="polite" aria-atomic="true">
        <span class="pg-toast-status" aria-hidden="true"></span>
        <span class="pg-toast-msg pg-design-muted"></span>
        <button class="pg-toast-btn pg-design-button pg-design-button-subtle" id="pg-auto-review-btn" type="button">Review</button>
        <button class="pg-toast-btn pg-design-button" id="pg-auto-undo-btn" type="button">Undo</button>
      </div>
    `;
    this.toastEl = this.shadow.querySelector('.pg-toast');
    this.msgEl = this.shadow.querySelector('.pg-toast-msg');
    this.reviewBtn = this.shadow.querySelector('#pg-auto-review-btn');
    this.undoBtn = this.shadow.querySelector('#pg-auto-undo-btn');
    if (this.msgEl) this.msgEl.textContent = `\u{1F512} ${replacedItemsLabel(count)}`;

    this.reviewBtn?.addEventListener('click', () => this.handleReview());
    this.undoBtn?.addEventListener('click', () => void this.handleUndo());
    this.toastEl?.addEventListener('mouseenter', () => this.pauseAutoDismiss());
    this.toastEl?.addEventListener('mouseleave', () => this.scheduleAutoDismiss());
    this.toastEl?.addEventListener('focusin', () => this.pauseAutoDismiss());
    this.toastEl?.addEventListener('focusout', () => this.scheduleAutoDismiss());
  }

  show(): void {
    if (this.mounted || this.disposed) return;
    document.body.appendChild(this.host);
    this.mounted = true;
    this.scheduleAutoDismiss();
  }

  /** Disposes the toast immediately. Safe to call multiple times. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pauseAutoDismiss();
    if (this.mounted) {
      this.host.remove();
      this.mounted = false;
    }
    this.cbs.onDispose?.();
  }

  /** True between show() and dispose(). Useful for tests. */
  isMounted(): boolean {
    return this.mounted;
  }

  private handleReview(): void {
    if (this.disposed || this.settled) return;
    this.settled = true;
    this.dispose();
    this.cbs.onReview();
  }

  private async handleUndo(): Promise<void> {
    if (this.disposed || this.settled) return;
    this.settled = true;
    this.pauseAutoDismiss();
    if (this.undoBtn) this.undoBtn.disabled = true;
    if (this.reviewBtn) this.reviewBtn.disabled = true;

    let restored = false;
    try {
      restored = await this.cbs.onUndo();
    } catch (error) {
      console.error('[PG:content] Undo failed:', error);
    }
    if (this.disposed) return;

    if (this.undoBtn) this.undoBtn.hidden = true;
    if (this.reviewBtn) this.reviewBtn.hidden = true;
    if (restored) {
      this.showResult('Original restored — nothing is replaced', 'done', RESULT_VISIBLE_MS);
    } else {
      this.showResult(AUTO_REPLACE_UNDO_FAILED_MESSAGE, 'failed', FAILURE_VISIBLE_MS);
    }
  }

  private showResult(message: string, state: 'done' | 'failed', visibleMs: number): void {
    if (this.msgEl) this.msgEl.textContent = message;
    this.toastEl?.setAttribute('data-state', state);
    window.setTimeout(() => this.dispose(), visibleMs);
  }

  private scheduleAutoDismiss(): void {
    // Once a button was used the result message owns the lifetime.
    if (this.disposed || this.settled) return;
    this.pauseAutoDismiss();
    this.dismissTimer = window.setTimeout(
      () => this.dispose(),
      TOAST_AUTO_DISMISS_MS,
    );
  }

  private pauseAutoDismiss(): void {
    if (this.dismissTimer !== null) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
  }
}
