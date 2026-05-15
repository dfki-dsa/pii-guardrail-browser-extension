import type { ThemeSetting } from '../../shared/message-types';

const MODAL_STYLES = `
  :host { all: initial; }

  .pg-critical-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(10, 13, 28, 0.48);
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .pg-critical-modal {
    width: min(520px, calc(100vw - 48px));
    border-radius: 16px;
    background: #151527;
    color: #f6f7fb;
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 24px 70px rgba(0, 0, 0, 0.38);
    padding: 22px;
    line-height: 1.45;
  }

  .pg-critical-modal[data-theme="light"] {
    background: #ffffff;
    color: #172033;
    border-color: #d7dce8;
    box-shadow: 0 24px 70px rgba(15, 23, 42, 0.18);
  }

  .pg-critical-modal-title {
    margin: 0 0 10px;
    font-size: 18px;
    font-weight: 700;
  }

  .pg-critical-modal-body {
    margin: 0 0 12px;
    font-size: 14px;
  }

  .pg-critical-modal-list {
    margin: 0 0 18px;
    padding-left: 20px;
    font-size: 14px;
  }

  .pg-critical-modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    flex-wrap: wrap;
  }

  .pg-critical-modal-button {
    appearance: none;
    border: 1px solid #3b82f6;
    border-radius: 9px;
    padding: 9px 13px;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .pg-critical-modal-button-primary {
    background: #3b82f6;
    color: #ffffff;
  }

  .pg-critical-modal-button-secondary {
    background: transparent;
    color: inherit;
    border-color: rgba(255, 255, 255, 0.26);
  }

  .pg-critical-modal[data-theme="light"] .pg-critical-modal-button-secondary {
    border-color: #cbd5e1;
  }
`;

export interface CriticalLocalAiModalCallbacks {
  onDismiss: () => Promise<void> | void;
  onOpenSettings: () => Promise<void> | void;
}

export class CriticalLocalAiModal {
  private host: HTMLDivElement;
  private shadow: ShadowRoot;
  private mounted = false;
  private dismissed = false;

  constructor(
    private readonly theme: ThemeSetting,
    private readonly callbacks: CriticalLocalAiModalCallbacks,
  ) {
    this.host = document.createElement('div');
    this.host.id = 'pg-critical-local-ai-modal-host';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `
      <style>${MODAL_STYLES}</style>
      <div class="pg-critical-modal-backdrop" role="presentation">
        <section class="pg-critical-modal" data-theme="${this.theme}" role="dialog" aria-modal="true" aria-labelledby="pg-critical-modal-title">
          <h2 class="pg-critical-modal-title" id="pg-critical-modal-title">Local AI detection is off to protect this browser</h2>
          <p class="pg-critical-modal-body">
            Privacy Guardrail detected critical browser-reported memory and turned off Local AI detection once to reduce the risk of browser slowdowns or freezes.
          </p>
          <ul class="pg-critical-modal-list">
            <li>Pattern detection remains active for structured personal data.</li>
            <li>Names, organizations, locations, and context-only PII may be missed while Local AI detection is off.</li>
            <li>You can review this setting and re-enable Local AI detection if you accept the performance risk.</li>
          </ul>
          <div class="pg-critical-modal-actions">
            <button class="pg-critical-modal-button pg-critical-modal-button-secondary" type="button" data-action="dismiss">Keep pattern detection only</button>
            <button class="pg-critical-modal-button pg-critical-modal-button-primary" type="button" data-action="settings">Open settings</button>
          </div>
        </section>
      </div>
    `;
    this.shadow.querySelector('[data-action="dismiss"]')?.addEventListener('click', () => {
      void this.dismiss();
    });
    this.shadow.querySelector('[data-action="settings"]')?.addEventListener('click', () => {
      void this.openSettings();
    });
  }

  show(): void {
    if (this.mounted || this.dismissed) return;
    document.body.appendChild(this.host);
    this.mounted = true;
  }

  isMounted(): boolean {
    return this.mounted;
  }

  async dismiss(): Promise<void> {
    if (this.dismissed) return;
    this.dismissed = true;
    await this.callbacks.onDismiss();
    this.dispose();
  }

  async openSettings(): Promise<void> {
    if (this.dismissed) return;
    await this.callbacks.onOpenSettings();
    await this.dismiss();
  }

  dispose(): void {
    if (!this.mounted) return;
    this.host.remove();
    this.mounted = false;
  }
}
