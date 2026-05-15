/**
 * Privacy Guardrail — Page Status Chip (Shadow DOM)
 *
 * Persistent page-level chip surfacing degraded-protection states on
 * supported chat pages. Renders one reason at a time and supports
 * per-session minimization without permanent dismissal.
 */

import type { ThemeSetting } from '../../shared/message-types';
import { chipReasonMessage, type ChipReason } from '../../shared/page-status-chip-reason';

const CHIP_STYLES = `
  :host { all: initial; }

  .pg-chip {
    position: fixed;
    bottom: 16px;
    left: 16px;
    z-index: 2147483645;
    max-width: min(320px, calc(100vw - 32px));
    background: #1a1a2e;
    color: #e0e0e0;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35);
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 12px;
    line-height: 1.4;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    pointer-events: auto;
  }

  .pg-chip[data-theme="light"] {
    background: #ffffff;
    color: #1f2933;
    border-color: #e4e6eb;
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.10);
  }

  .pg-chip-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .pg-chip-title {
    font-weight: 600;
    flex: 1;
  }

  .pg-chip-toggle {
    appearance: none;
    background: transparent;
    border: 0;
    color: inherit;
    cursor: pointer;
    font: inherit;
    font-size: 14px;
    line-height: 1;
    padding: 2px 6px;
    border-radius: 4px;
    opacity: 0.75;
  }

  .pg-chip-toggle:hover { opacity: 1; }

  .pg-chip-toggle:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }

  .pg-chip-detail {
    font-size: 12px;
    opacity: 0.85;
  }

  .pg-chip[data-minimized="true"] {
    padding: 6px 10px;
    cursor: pointer;
  }

  .pg-chip[data-minimized="true"] .pg-chip-detail {
    display: none;
  }
`;

const SESSION_STORAGE_KEY = 'pg_page_status_chip_minimized';

export interface PageStatusChipCallbacks {
  onMinimizeChange?: (minimized: boolean) => void;
}

export class PageStatusChip {
  private host: HTMLDivElement;
  private shadow: ShadowRoot;
  private mounted = false;
  private currentReason: ChipReason | null = null;
  private minimized: boolean;
  private theme: ThemeSetting;
  private readonly callbacks: PageStatusChipCallbacks;

  constructor(theme: ThemeSetting = 'dark', callbacks: PageStatusChipCallbacks = {}) {
    this.theme = theme;
    this.callbacks = callbacks;
    this.minimized = readSessionMinimized();
    this.host = document.createElement('div');
    this.host.id = 'pg-page-status-chip-host';
    this.shadow = this.host.attachShadow({ mode: 'open' });
  }

  setTheme(theme: ThemeSetting): void {
    this.theme = theme;
    if (this.mounted) this.render();
  }

  /** Update the displayed reason; pass null to remove the chip. */
  update(reason: ChipReason | null): void {
    if (reason === this.currentReason && (reason === null) === !this.mounted) return;
    this.currentReason = reason;

    if (reason === null) {
      this.dispose();
      return;
    }

    if (!this.mounted) {
      document.body.appendChild(this.host);
      this.mounted = true;
    }
    this.render();
  }

  setMinimized(minimized: boolean): void {
    if (this.minimized === minimized) return;
    this.minimized = minimized;
    writeSessionMinimized(minimized);
    if (this.mounted) this.render();
    this.callbacks.onMinimizeChange?.(minimized);
  }

  isMinimized(): boolean {
    return this.minimized;
  }

  isMounted(): boolean {
    return this.mounted;
  }

  getReason(): ChipReason | null {
    return this.currentReason;
  }

  dispose(): void {
    if (!this.mounted) return;
    this.host.remove();
    this.mounted = false;
  }

  private render(): void {
    if (!this.currentReason) return;
    const { title, detail } = chipReasonMessage(this.currentReason);
    const minimizedAttr = this.minimized ? 'true' : 'false';
    const toggleLabel = this.minimized ? 'Expand status' : 'Minimize status';
    const toggleGlyph = this.minimized ? '+' : '−';
    this.shadow.innerHTML = `
      <style>${CHIP_STYLES}</style>
      <div class="pg-chip" data-theme="${this.theme}" data-minimized="${minimizedAttr}" data-reason="${this.currentReason}" role="status" aria-live="polite">
        <div class="pg-chip-header">
          <span class="pg-chip-title">${escapeHtml(title)}</span>
          <button class="pg-chip-toggle" type="button" aria-label="${toggleLabel}" data-action="toggle">${toggleGlyph}</button>
        </div>
        <div class="pg-chip-detail">${escapeHtml(detail)}</div>
      </div>
    `;
    const toggleButton = this.shadow.querySelector('[data-action="toggle"]');
    toggleButton?.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setMinimized(!this.minimized);
    });
    if (this.minimized) {
      const root = this.shadow.querySelector('.pg-chip');
      root?.addEventListener('click', () => this.setMinimized(false));
    }
  }
}

function readSessionMinimized(): boolean {
  try {
    return window.sessionStorage?.getItem(SESSION_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSessionMinimized(minimized: boolean): void {
  try {
    if (minimized) {
      window.sessionStorage?.setItem(SESSION_STORAGE_KEY, '1');
    } else {
      window.sessionStorage?.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // sessionStorage may be blocked (e.g. third-party context). The chip
    // simply forgets the preference on the next page load — acceptable per
    // the per-session minimize semantics.
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return ch;
    }
  });
}
