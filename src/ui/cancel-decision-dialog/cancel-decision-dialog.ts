import type { ThemeSetting } from '../../shared/message-types';

export type CancelDecision = 'paste-original' | 'drop';

export interface CancelDecisionDialogResult {
  decision: CancelDecision;
  remember: boolean;
  dismissed: boolean;
}

const STYLES = `
  :host { all: initial; }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    background: rgba(6, 8, 18, 0.52);
    font-family: system-ui, -apple-system, Segoe UI, sans-serif;
  }
  .dialog {
    width: min(420px, 100%);
    box-sizing: border-box;
    border-radius: 16px;
    padding: 20px;
    background: #18192b;
    color: #e9eaf6;
    border: 1px solid rgba(92, 96, 130, 0.72);
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.38);
  }
  .dialog[data-theme="light"] {
    background: #ffffff;
    color: #1f2933;
    border-color: #e4e6eb;
    box-shadow: 0 18px 50px rgba(15, 23, 42, 0.18);
  }
  .header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
  h2 { margin: 0 0 10px; font-size: 18px; line-height: 1.2; font-weight: 650; }
  p { margin: 0 0 16px; font-size: 13px; line-height: 1.5; color: #b8bbd0; }
  .dialog[data-theme="light"] p { color: #52606d; }
  .close {
    appearance: none; border: 0; background: transparent; color: inherit; cursor: pointer;
    font-size: 20px; line-height: 1; padding: 0 2px; opacity: 0.74;
  }
  label { display: flex; align-items: center; gap: 8px; margin-bottom: 18px; font-size: 13px; color: inherit; }
  input { accent-color: #3b82f6; }
  .actions { display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
  button { font: inherit; }
  .secondary, .primary { border-radius: 9px; padding: 8px 13px; cursor: pointer; font-size: 13px; }
  .secondary { background: transparent; color: inherit; border: 1px solid rgba(136, 140, 170, 0.55); }
  .primary { background: #2563eb; color: #fff; border: 1px solid #2563eb; font-weight: 600; }
  .close:focus-visible, .secondary:focus-visible, .primary:focus-visible, input:focus-visible {
    outline: 2px solid #60a5fa; outline-offset: 2px;
  }
`;

export class CancelDecisionDialog {
  private host: HTMLDivElement | null = null;
  private previousActive: Element | null = null;

  constructor(private readonly theme: ThemeSetting = 'dark') {}

  show(): Promise<CancelDecisionDialogResult> {
    this.dispose();
    this.previousActive = document.activeElement;
    this.host = document.createElement('div');
    this.host.id = 'pg-cancel-decision-dialog-host';
    const shadow = this.host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${STYLES}</style>
      <div class="backdrop" part="backdrop">
        <section class="dialog" data-theme="${this.theme}" role="dialog" aria-modal="true" aria-labelledby="pg-cancel-title" aria-describedby="pg-cancel-body">
          <div class="header">
            <h2 id="pg-cancel-title">Scan canceled</h2>
            <button class="close" type="button" aria-label="Close">×</button>
          </div>
          <p id="pg-cancel-body">Do you want to paste this text without checking for personal data?</p>
          <label><input class="remember" type="checkbox"> <span>Remember this choice</span></label>
          <div class="actions">
            <button class="secondary" type="button">Don’t paste</button>
            <button class="primary" type="button">Paste without checking</button>
          </div>
        </section>
      </div>
    `;
    document.body.appendChild(this.host);

    const backdrop = shadow.querySelector('.backdrop') as HTMLElement;
    const dialog = shadow.querySelector('.dialog') as HTMLElement;
    const remember = shadow.querySelector('.remember') as HTMLInputElement;
    const primary = shadow.querySelector('.primary') as HTMLButtonElement;
    const secondary = shadow.querySelector('.secondary') as HTMLButtonElement;
    const close = shadow.querySelector('.close') as HTMLButtonElement;
    const focusables = [close, remember, secondary, primary];

    return new Promise((resolve) => {
      const finish = (result: CancelDecisionDialogResult): void => {
        document.removeEventListener('keydown', onKeyDown, true);
        this.dispose();
        resolve(result);
      };
      const action = (decision: CancelDecision): void => {
        finish({ decision, remember: remember.checked, dismissed: false });
      };
      const dismiss = (): void => finish({ decision: 'drop', remember: false, dismissed: true });
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
          event.preventDefault();
          dismiss();
          return;
        }
        if (event.key === 'Tab') {
          const index = focusables.indexOf((shadow.activeElement || document.activeElement) as HTMLButtonElement | HTMLInputElement);
          const next = event.shiftKey
            ? (index <= 0 ? focusables.length - 1 : index - 1)
            : (index === focusables.length - 1 ? 0 : index + 1);
          event.preventDefault();
          focusables[next].focus();
        }
      };

      primary.addEventListener('click', () => action('paste-original'));
      secondary.addEventListener('click', () => action('drop'));
      close.addEventListener('click', dismiss);
      backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop) dismiss();
      });
      dialog.addEventListener('click', (event) => event.stopPropagation());
      document.addEventListener('keydown', onKeyDown, true);
      primary.focus();
    });
  }

  dispose(): void {
    this.host?.remove();
    this.host = null;
    if (this.previousActive instanceof HTMLElement) {
      this.previousActive.focus();
    }
  }
}
