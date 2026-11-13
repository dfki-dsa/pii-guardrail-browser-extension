/**
 * Privacy Guardrail — Auto-mode Toast (Shadow DOM)
 *
 * Non-blocking notice shown after a paste was replaced automatically, with
 * the two ways back to a decision the user never got to make:
 *
 *  - "Undo" puts the original text back in the message box.
 *  - "Review" opens the review pop-up for that paste.
 *
 * Ignoring it keeps the replacement; it auto-dismisses after ~8 seconds,
 * paused while the pointer hovers or keyboard focus is inside it, and can be
 * closed by hand.
 *
 * Undo can fail — the text was edited or already sent — and the toast then
 * says so rather than disappearing. In that case nothing was changed, which
 * leaves the replaced text in place.
 *
 * Shares its lifetime — mounting, the countdown, the pause while engaged,
 * disposing once — with `ClipboardToast` through `ToastLifetime`. The two
 * stay separate classes: their markup, actions and outcomes differ.
 */

import { SHADOW_DESIGN_SYSTEM_STYLES } from '../shared/shadow-design-system';
import { centerOverAnchor } from '../shared/anchored-position';
import { closeIcon, shieldCheckIcon, undoIcon } from '../shared/icons';
import { ToastLifetime } from '../shared/toast-lifetime';
import {
  RESTORED_DETAIL,
  RESTORED_TITLE,
  RESTORE_FAILED_TITLE,
  SWAP_FAILED_DETAIL,
} from '../../shared/auto-mode-copy';
import type { ThemeSetting } from '../../shared/message-types';

const TOAST_AUTO_DISMISS_MS = 8000;
const RESULT_VISIBLE_MS = 1800;
/** A failure has to be read, so it stays up longer than a confirmation. */
export const FAILURE_VISIBLE_MS = 5000;

const AUTO_MODE_TOAST_STYLES = `
  ${SHADOW_DESIGN_SYSTEM_STYLES}

  .pg-toast {
    display: flex;
    max-width: min(640px, calc(100vw - 32px));
    padding: 10px 10px 10px 16px;
    border-radius: 12px;
    line-height: 1.35;
  }

  .pg-toast-icon {
    flex: 0 0 auto;
    color: #93c5fd;
  }

  .pg-toast[data-theme="light"] .pg-toast-icon {
    color: var(--pg-color-accent);
  }

  .pg-toast[data-state="failed"] .pg-toast-icon,
  .pg-toast[data-state="partial"] .pg-toast-icon {
    color: var(--pg-color-warning);
  }

  .pg-toast-text {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-width: 0;
    margin-right: 8px;
  }

  .pg-toast-title {
    font-weight: 600;
  }

  .pg-toast-sub {
    font-size: 12px;
  }

  .pg-toast-sub:empty {
    display: none;
  }

  .pg-toast-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
    white-space: nowrap;
    font-size: 13px;
  }

  /* Undo and the close button are ghost buttons; Review is the outlined one. */
  .pg-toast-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    flex: 0 0 auto;
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

    .pg-toast-text {
      flex-basis: calc(100% - 40px);
    }
  }
`;

export interface AutoModeToastCallbacks {
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

/**
 * What the paste came to: how many detected items were replaced, and how
 * many were detected but left as they were — below their threshold, or in a
 * code block the user asked to skip. The second number is shown because in
 * the review pop-up those items would have been listed, and auto-mode must
 * not make them invisible.
 */
export interface AutoModeOutcome {
  replaced: number;
  skipped: number;
}

export function replacedItemsLabel(count: number): string {
  if (count === 0) return 'Nothing replaced';
  return count === 1 ? '1 item replaced' : `${count} items replaced`;
}

export function skippedItemsLabel(count: number): string {
  return count === 1
    ? '1 detected item not replaced'
    : `${count} detected items not replaced`;
}

export class AutoModeToast {
  private host: HTMLDivElement;
  private shadow: ShadowRoot;
  private toastEl: HTMLDivElement | null = null;
  private titleEl: HTMLSpanElement | null = null;
  private subEl: HTMLSpanElement | null = null;
  private reviewBtn: HTMLButtonElement | null = null;
  private undoBtn: HTMLButtonElement | null = null;
  private readonly life: ToastLifetime;
  /** Set once a button was used; the toast then only reports and leaves. */
  private settled = false;
  private readonly cbs: AutoModeToastCallbacks;
  private readonly anchor: HTMLElement | null;

  constructor(
    theme: ThemeSetting,
    outcome: AutoModeOutcome,
    cbs: AutoModeToastCallbacks,
    /**
     * The message box the paste went into. The toast centres itself over it
     * rather than over the window, which a sidebar puts somewhere else.
     */
    anchor: HTMLElement | null = null,
  ) {
    this.cbs = cbs;
    this.anchor = anchor;
    this.host = document.createElement('div');
    this.host.id = 'pg-auto-mode-toast-host';
    this.shadow = this.host.attachShadow({ mode: 'closed' });
    this.shadow.innerHTML = `
      <style>${AUTO_MODE_TOAST_STYLES}</style>
      <div class="pg-toast pg-design-surface pg-design-toast" data-theme="${theme}" data-state="default" role="status" aria-live="polite" aria-atomic="true">
        ${shieldCheckIcon('pg-toast-icon')}
        <div class="pg-toast-text">
          <span class="pg-toast-title"></span>
          <span class="pg-toast-sub pg-design-muted"></span>
        </div>
        <button class="pg-toast-btn pg-design-button pg-design-button-ghost" id="pg-auto-undo-btn" type="button">${undoIcon()}<span>Undo</span></button>
        <button class="pg-toast-btn pg-design-button pg-design-button-subtle" id="pg-auto-review-btn" type="button">Review</button>
        <button class="pg-toast-close pg-design-button pg-design-button-ghost" id="pg-auto-close-btn" type="button" aria-label="Dismiss">${closeIcon()}</button>
      </div>
    `;
    this.toastEl = this.shadow.querySelector('.pg-toast');
    this.titleEl = this.shadow.querySelector('.pg-toast-title');
    this.subEl = this.shadow.querySelector('.pg-toast-sub');
    this.reviewBtn = this.shadow.querySelector('#pg-auto-review-btn');
    this.undoBtn = this.shadow.querySelector('#pg-auto-undo-btn');
    const closeBtn = this.shadow.querySelector<HTMLButtonElement>('#pg-auto-close-btn');
    if (this.titleEl) this.titleEl.textContent = replacedItemsLabel(outcome.replaced);
    if (this.subEl) {
      this.subEl.textContent =
        outcome.skipped > 0 ? skippedItemsLabel(outcome.skipped) : 'Auto-mode is on';
    }
    // Something detected was left in: say so in the icon as well as the text.
    if (outcome.skipped > 0) this.toastEl?.setAttribute('data-state', 'partial');
    // With nothing replaced there is nothing to undo.
    if (outcome.replaced === 0 && this.undoBtn) this.undoBtn.hidden = true;

    this.life = new ToastLifetime(this.host, TOAST_AUTO_DISMISS_MS, () => this.cbs.onDispose?.());
    this.life.pauseWhileEngaged(this.toastEl, { focus: true });
    this.reviewBtn?.addEventListener('click', () => this.handleReview());
    this.undoBtn?.addEventListener('click', () => void this.handleUndo());
    closeBtn?.addEventListener('click', () => this.dispose());
  }

  show(): void {
    if (!this.life.mount()) return;
    centerOverAnchor(this.toastEl, this.anchor);
  }

  /** Disposes the toast immediately. Safe to call multiple times. */
  dispose(): void {
    this.life.dispose();
  }

  /** True between show() and dispose(). Useful for tests. */
  isMounted(): boolean {
    return this.life.isMounted;
  }

  private handleReview(): void {
    if (this.life.isDisposed || this.settled) return;
    this.settled = true;
    this.dispose();
    this.cbs.onReview();
  }

  private async handleUndo(): Promise<void> {
    if (this.life.isDisposed || this.settled) return;
    this.settled = true;
    // From here the result message decides how long the toast stays.
    this.life.hold();
    if (this.undoBtn) this.undoBtn.disabled = true;
    if (this.reviewBtn) this.reviewBtn.disabled = true;

    let restored = false;
    try {
      restored = await this.cbs.onUndo();
    } catch (error) {
      console.error('[PG:content] Undo failed:', error);
    }
    if (this.life.isDisposed) return;

    if (this.undoBtn) this.undoBtn.hidden = true;
    if (this.reviewBtn) this.reviewBtn.hidden = true;
    if (restored) {
      this.showResult(RESTORED_TITLE, RESTORED_DETAIL, 'done', RESULT_VISIBLE_MS);
    } else {
      this.showResult(RESTORE_FAILED_TITLE, SWAP_FAILED_DETAIL, 'failed', FAILURE_VISIBLE_MS);
    }
  }

  private showResult(
    title: string,
    detail: string,
    state: 'done' | 'failed',
    visibleMs: number,
  ): void {
    if (this.titleEl) this.titleEl.textContent = title;
    if (this.subEl) this.subEl.textContent = detail;
    this.toastEl?.setAttribute('data-state', state);
    // The result text is a different length, so the toast is a different width.
    centerOverAnchor(this.toastEl, this.anchor);
    this.life.disposeAfter(visibleMs);
  }
}
