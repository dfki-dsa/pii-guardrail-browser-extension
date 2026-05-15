/**
 * Privacy Guardrail — Scanning Indicator (Shadow DOM)
 *
 * Persistent status toast shown while PII detection is actively running.
 */

const SCANNING_INDICATOR_STYLES = `
  :host {
    all: initial;
  }

  .pg-indicator {
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483646;
    display: inline-flex;
    align-items: center;
    gap: 0;
    padding: 8px 16px;
    border-radius: 8px;
    background: #1a1a2e;
    color: #e0e0e0;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
    font-family: system-ui, sans-serif;
    font-size: 13px;
    line-height: 1.4;
    pointer-events: auto;
    white-space: nowrap;
  }

  .pg-label {
    display: inline;
  }

  .pg-ellipsis {
    display: inline-block;
    min-width: 1.6em;
  }

  .pg-ellipsis::after {
    content: '.';
    display: inline-block;
    text-align: left;
    animation: pg-ellipsis-cycle 1.2s steps(1, end) infinite;
  }

  .pg-cancel {
    appearance: none;
    border: 0;
    border-left: 1px solid rgba(224, 224, 224, 0.24);
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    margin: 0 0 0 10px;
    padding: 0 0 0 10px;
    line-height: 1.4;
  }

  .pg-cancel:hover {
    text-decoration: underline;
  }

  .pg-cancel:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 2px;
    border-radius: 4px;
  }

  @keyframes pg-ellipsis-cycle {
    0%, 33.333% {
      content: '.';
    }

    33.334%, 66.666% {
      content: '..';
    }

    66.667%, 100% {
      content: '...';
    }
  }

  /* Minimal light theme — flat white pill with subtle border. */
  .pg-indicator[data-theme="light"] {
    background: #ffffff;
    color: #1f2933;
    border: 1px solid #e4e6eb;
    box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
  }

  .pg-indicator[data-theme="light"] .pg-cancel {
    border-left-color: #d5d9e0;
  }
`;

export class ScanningIndicator {
  private host: HTMLDivElement;
  private shadow: ShadowRoot;
  private labelEl: HTMLSpanElement | null = null;
  private counterEl: HTMLSpanElement | null = null;
  private mounted = false;
  private tierTwoTimer: number | null = null;
  private tierThreeTimer: number | null = null;
  private tierFourTimer: number | null = null;
  private counterInterval: number | null = null;
  private startTimeMs: number | null = null;
  private cancelInvoked = false;
  private readonly theme: 'dark' | 'light';
  private readonly onCancel?: () => void;
  private readonly keydownHandler = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.mounted) return;
    event.preventDefault();
    this.invokeCancel();
  };

  constructor(theme: 'dark' | 'light' = 'dark', onCancel?: () => void) {
    this.theme = theme;
    this.onCancel = onCancel;
    this.host = document.createElement('div');
    this.host.id = 'pg-scanning-indicator-host';
    this.shadow = this.host.attachShadow({ mode: 'closed' });
    this.render();
  }

  start(): void {
    if (this.mounted) {
      return;
    }

    this.setLabel('🔏 Scanning for personal data');
    this.hideCounter();
    document.body.appendChild(this.host);
    this.mounted = true;
    this.cancelInvoked = false;
    this.startTimeMs = Date.now();
    document.addEventListener('keydown', this.keydownHandler, true);
    this.scheduleTierTwoEscalation();
    this.scheduleTierThreeCounter();
    this.scheduleTierFourWarning();
  }

  stop(): void {
    this.clearTimers();

    if (!this.mounted) {
      return;
    }

    this.host.remove();
    this.mounted = false;
    document.removeEventListener('keydown', this.keydownHandler, true);
  }

  private render(): void {
    this.shadow.innerHTML = `
      <style>${SCANNING_INDICATOR_STYLES}</style>
      <div class="pg-indicator" data-theme="${this.theme}" role="status" aria-live="polite">
        <span class="pg-label">🔏 Scanning for personal data</span>
        <span class="pg-counter"></span>
        <span class="pg-ellipsis" aria-hidden="true"></span>
        <button class="pg-cancel" type="button">Cancel</button>
      </div>
    `;

    this.labelEl = this.shadow.querySelector('.pg-label');
    this.counterEl = this.shadow.querySelector('.pg-counter');
    this.shadow.querySelector('.pg-cancel')?.addEventListener('click', () => {
      this.invokeCancel();
    });
  }

  private invokeCancel(): void {
    if (this.cancelInvoked) return;
    this.cancelInvoked = true;
    this.onCancel?.();
  }

  private scheduleTierTwoEscalation(): void {
    this.tierTwoTimer = window.setTimeout(() => {
      this.setLabel('🔏 Still scanning');
      this.tierTwoTimer = null;
    }, 2000);
  }

  private scheduleTierThreeCounter(): void {
    this.tierThreeTimer = window.setTimeout(() => {
      this.setLabel('🔏 Still scanning');
      this.updateCounterText();
      this.counterInterval = window.setInterval(() => {
        this.updateCounterText();
      }, 1000);
      this.tierThreeTimer = null;
    }, 15000);
  }

  private scheduleTierFourWarning(): void {
    this.tierFourTimer = window.setTimeout(() => {
      this.setLabel('⚠ This is taking unusually long');
      this.tierFourTimer = null;
    }, 120000);
  }

  private clearTimers(): void {
    if (this.tierTwoTimer !== null) {
      clearTimeout(this.tierTwoTimer);
      this.tierTwoTimer = null;
    }

    if (this.tierThreeTimer !== null) {
      clearTimeout(this.tierThreeTimer);
      this.tierThreeTimer = null;
    }

    if (this.tierFourTimer !== null) {
      clearTimeout(this.tierFourTimer);
      this.tierFourTimer = null;
    }

    if (this.counterInterval !== null) {
      clearInterval(this.counterInterval);
      this.counterInterval = null;
    }

    this.startTimeMs = null;
  }

  private setLabel(text: string): void {
    if (this.labelEl) {
      this.labelEl.textContent = text;
    }
  }

  private hideCounter(): void {
    if (this.counterEl) {
      this.counterEl.textContent = '';
    }
  }

  private updateCounterText(): void {
    if (!this.counterEl || this.startTimeMs === null) {
      return;
    }

    const elapsedSeconds = Math.floor((Date.now() - this.startTimeMs) / 1000);
    this.counterEl.textContent = ` · ${elapsedSeconds}s`;
  }
}
