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

const TOAST_AUTO_DISMISS_MS = 6000;
const CONFIRMATION_VISIBLE_MS = 1500;

const CLIPBOARD_TOAST_STYLES = `
  ${SHADOW_DESIGN_SYSTEM_STYLES}

  .pg-toast {
    position: fixed;
    bottom: 132px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483646;
    display: inline-flex;
    align-items: center;
    gap: 12px;
    width: max-content;
    max-width: min(480px, calc(100vw - 32px));
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

  .pg-toast-msg {
    flex: 1;
    min-width: 0;
  }

  .pg-toast-btn {
    padding: 6px 10px;
    white-space: nowrap;
  }

  .pg-toast-btn[hidden] {
    display: none;
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
  private dismissTimer: number | null = null;
  private mounted = false;
  private disposed = false;
  private readonly theme: 'dark' | 'light';
  private readonly cbs: ClipboardToastCallbacks;

  constructor(theme: 'dark' | 'light', cbs: ClipboardToastCallbacks) {
    this.theme = theme;
    this.cbs = cbs;
    this.host = document.createElement('div');
    this.host.id = 'pg-clipboard-toast-host';
    this.shadow = this.host.attachShadow({ mode: 'closed' });
    this.shadow.innerHTML = `
      <style>${CLIPBOARD_TOAST_STYLES}</style>
      <div class="pg-toast pg-design-surface" data-theme="${this.theme}" role="status" aria-live="polite" aria-atomic="true">
        <span class="pg-toast-status" aria-hidden="true"></span>
        <span class="pg-toast-msg pg-design-muted">Copied — contains anonymized items. Replace with originals?</span>
        <button class="pg-toast-btn pg-design-button" type="button">Replace with originals</button>
      </div>
    `;
    this.toastEl = this.shadow.querySelector('.pg-toast');
    this.msgEl = this.shadow.querySelector('.pg-toast-msg');
    this.btnEl = this.shadow.querySelector('.pg-toast-btn');

    this.btnEl?.addEventListener('click', () => this.handleReplace());
    this.toastEl?.addEventListener('mouseenter', () => this.pauseAutoDismiss());
    this.toastEl?.addEventListener('mouseleave', () => this.scheduleAutoDismiss());
  }

  show(): void {
    if (this.mounted || this.disposed) return;
    document.body.appendChild(this.host);
    this.mounted = true;
    this.scheduleAutoDismiss();
  }

  /**
   * Disposes the toast immediately. Safe to call multiple times.
   * Used by the coordinator to enforce the singleton constraint when a
   * newer copy supersedes an older one.
   */
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

  /** True between construction and dispose. Useful for tests. */
  isMounted(): boolean {
    return this.mounted;
  }

  private handleReplace(): void {
    if (this.disposed) return;
    this.cbs.onReplace();
    this.showConfirmation();
  }

  private showConfirmation(): void {
    if (this.disposed) return;
    this.pauseAutoDismiss();
    if (this.msgEl) this.msgEl.textContent = 'Clipboard replaced';
    if (this.btnEl) this.btnEl.hidden = true;
    window.setTimeout(() => this.dispose(), CONFIRMATION_VISIBLE_MS);
  }

  private scheduleAutoDismiss(): void {
    if (this.disposed) return;
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
