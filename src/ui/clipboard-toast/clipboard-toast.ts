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

const TOAST_AUTO_DISMISS_MS = 6000;
const CONFIRMATION_VISIBLE_MS = 1500;

const CLIPBOARD_TOAST_STYLES = `
  :host { all: initial; }

  .pg-toast {
    position: fixed;
    bottom: 132px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483646;
    display: inline-flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-radius: 8px;
    background: #1a1a2e;
    color: #e0e0e0;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
    line-height: 1.4;
    max-width: 480px;
  }

  .pg-toast[data-theme="light"] {
    background: #ffffff;
    color: #1f2933;
    border: 1px solid #e4e6eb;
    box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
  }

  .pg-toast-msg { flex: 1; }

  .pg-toast-btn {
    background: #2a2a3e;
    border: 1px solid #3a3a4e;
    color: #e0e0e0;
    padding: 5px 12px;
    border-radius: 5px;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.15s;
  }
  .pg-toast-btn:hover { background: #3a3a4e; }

  .pg-toast[data-theme="light"] .pg-toast-btn {
    background: #f7f7f8;
    border-color: #d4d4d8;
    color: #1f2933;
  }
  .pg-toast[data-theme="light"] .pg-toast-btn:hover {
    background: #f3f4f6;
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
      <div class="pg-toast" data-theme="${this.theme}" role="status" aria-live="polite">
        <span class="pg-toast-msg">Copied — contains anonymized items. Replace with originals?</span>
        <button class="pg-toast-btn" type="button">Replace with originals</button>
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
    if (this.btnEl) this.btnEl.style.display = 'none';
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
