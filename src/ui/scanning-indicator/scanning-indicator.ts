/**
 * Privacy Guardrail — Scanning Indicator (Shadow DOM)
 *
 * Persistent status toast shown while PII detection is actively running.
 */

import { SHADOW_DESIGN_SYSTEM_STYLES } from '../shared/shadow-design-system';

const SCANNING_INDICATOR_STYLES = `
  ${SHADOW_DESIGN_SYSTEM_STYLES}

  .pg-indicator {
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483646;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px 8px 12px;
    border-radius: var(--pg-radius-md);
    font-size: 13px;
    line-height: 1.4;
    pointer-events: auto;
    white-space: nowrap;
    animation: pg-design-pop-in 160ms ease-out;
  }

  .pg-status-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--pg-color-accent);
    box-shadow: 0 0 0 3px rgb(29 78 216 / 18%);
    flex: 0 0 auto;
  }

  .pg-indicator[data-state="warning"] .pg-status-dot {
    background: var(--pg-color-warning);
    box-shadow: 0 0 0 3px rgb(245 158 11 / 20%);
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
    margin-left: 4px;
    padding: 5px 9px;
  }

  .pg-counter {
    color: inherit;
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

  @media (max-width: 420px) {
    .pg-indicator {
      max-width: calc(100vw - 32px);
      white-space: normal;
    }
  }
`;

export class ScanningIndicator {
  private host: HTMLDivElement;
  private shadow: ShadowRoot;
  private indicatorEl: HTMLDivElement | null = null;
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

    this.indicatorEl?.setAttribute('data-state', 'active');
    this.setLabel('Scanning for personal data');
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
      <div class="pg-indicator pg-design-surface" data-theme="${this.theme}" data-state="active" role="status" aria-live="polite" aria-atomic="true">
        <span class="pg-status-dot" aria-hidden="true"></span>
        <span class="pg-label pg-design-muted">Scanning for personal data</span>
        <span class="pg-counter"></span>
        <span class="pg-ellipsis" aria-hidden="true"></span>
        <button class="pg-cancel pg-design-button pg-design-button-subtle" type="button">Cancel</button>
      </div>
    `;

    this.indicatorEl = this.shadow.querySelector('.pg-indicator');
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
      this.setLabel('Still scanning');
      this.tierTwoTimer = null;
    }, 2000);
  }

  private scheduleTierThreeCounter(): void {
    this.tierThreeTimer = window.setTimeout(() => {
      this.setLabel('Still scanning');
      this.updateCounterText();
      this.counterInterval = window.setInterval(() => {
        this.updateCounterText();
      }, 1000);
      this.tierThreeTimer = null;
    }, 15000);
  }

  private scheduleTierFourWarning(): void {
    this.tierFourTimer = window.setTimeout(() => {
      this.indicatorEl?.setAttribute('data-state', 'warning');
      this.setLabel('This is taking unusually long');
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
