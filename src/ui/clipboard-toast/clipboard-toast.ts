/**
 * Privacy Guardrail — Clipboard Toast (Shadow DOM)
 *
 * Non-blocking notification surfaced after the user copies text that
 * contains resolvable placeholders or synthetic-mode echoes. Offers a
 * single "Replace with originals" action; ignoring auto-dismisses after
 * ~6 seconds (paused while the pointer hovers the toast).
 *
 * After a successful replacement the toast briefly shows a "Clipboard
 * replaced" confirmation and then disposes itself.
 */

import { SHADOW_DESIGN_SYSTEM_STYLES } from '../shared/shadow-design-system';
import { centerOverAnchor } from '../shared/anchored-position';
import { ToastLifetime } from '../shared/toast-lifetime';

const TOAST_AUTO_DISMISS_MS = 6000;
const CONFIRMATION_VISIBLE_MS = 1500;

const CLIPBOARD_TOAST_STYLES = `
  ${SHADOW_DESIGN_SYSTEM_STYLES}

  .pg-toast {
    display: inline-flex;
    max-width: min(480px, calc(100vw - 32px));
    padding: 10px 12px;
    border-radius: var(--pg-radius-md);
    line-height: 1.4;
  }

  .pg-toast-status {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--pg-color-success);
    box-shadow: 0 0 0 3px rgb(34 197 94 / 16%);
    flex: 0 0 auto;
  }

  .pg-toast-msg {
    flex: 1;
    min-width: 0;
  }

  .pg-toast-btn {
    padding: 6px 10px;
    white-space: nowrap;
  }

  @media (max-width: 520px) {
    .pg-toast {
      align-items: flex-start;
      width: calc(100vw - 32px);
    }

    .pg-toast-btn {
      white-space: normal;
      text-align: left;
    }
  }
`;

export interface ClipboardToastCallbacks {
  /** Called when the user clicks "Replace with originals". */
  onReplace: () => void;
  /** Called when the toast disposes itself (auto-dismiss, replace, or
   *  preempted by another toast). Lets the coordinator clear its
   *  singleton reference. */
  onDispose?: () => void;
}

export class ClipboardToast {
  private host: HTMLDivElement;
  private shadow: ShadowRoot;
  private toastEl: HTMLDivElement | null = null;
  private msgEl: HTMLSpanElement | null = null;
  private btnEl: HTMLButtonElement | null = null;
  private readonly life: ToastLifetime;
  private readonly theme: 'dark' | 'light';
  private readonly cbs: ClipboardToastCallbacks;
  /** The message box; the toast lines up with it rather than with the window. */
  private readonly anchor: HTMLElement | null;

  constructor(
    theme: 'dark' | 'light',
    cbs: ClipboardToastCallbacks,
    anchor: HTMLElement | null = null,
  ) {
    this.theme = theme;
    this.cbs = cbs;
    this.anchor = anchor;
    this.host = document.createElement('div');
    this.host.id = 'pg-clipboard-toast-host';
    this.shadow = this.host.attachShadow({ mode: 'closed' });
    this.shadow.innerHTML = `
      <style>${CLIPBOARD_TOAST_STYLES}</style>
      <div class="pg-toast pg-design-surface pg-design-toast" data-theme="${this.theme}" role="status" aria-live="polite" aria-atomic="true">
        <span class="pg-toast-status" aria-hidden="true"></span>
        <span class="pg-toast-msg pg-design-muted">Copied — contains replaced items. Restore originals?</span>
        <button class="pg-toast-btn pg-design-button" id="pg-clipboard-replace-btn" type="button">Replace with originals</button>
      </div>
    `;
    this.toastEl = this.shadow.querySelector('.pg-toast');
    this.msgEl = this.shadow.querySelector('.pg-toast-msg');
    this.btnEl = this.shadow.querySelector('.pg-toast-btn');

    this.life = new ToastLifetime(this.host, TOAST_AUTO_DISMISS_MS, () => this.cbs.onDispose?.());
    this.life.pauseWhileEngaged(this.toastEl);
    this.btnEl?.addEventListener('click', () => this.handleReplace());
  }

  show(): void {
    if (!this.life.mount()) return;
    centerOverAnchor(this.toastEl, this.anchor);
  }

  /**
   * Disposes the toast immediately. Safe to call multiple times.
   * Used by the coordinator to enforce the singleton constraint when a
   * newer copy supersedes an older one.
   */
  dispose(): void {
    this.life.dispose();
  }

  /** True between show() and dispose(). Useful for tests. */
  isMounted(): boolean {
    return this.life.isMounted;
  }

  private handleReplace(): void {
    if (this.life.isDisposed) return;
    this.cbs.onReplace();
    this.showConfirmation();
  }

  private showConfirmation(): void {
    if (this.life.isDisposed) return;
    this.life.pause();
    if (this.msgEl) this.msgEl.textContent = 'Clipboard replaced';
    if (this.btnEl) this.btnEl.hidden = true;
    centerOverAnchor(this.toastEl, this.anchor);
    this.life.disposeAfter(CONFIRMATION_VISIBLE_MS);
  }
}
