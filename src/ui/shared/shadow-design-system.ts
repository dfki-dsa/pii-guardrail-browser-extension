/**
 * Shared design-system primitives for Shadow DOM UI mounted from content
 * scripts. Shadow roots do not get the popup/options stylesheet, so these
 * tokens intentionally mirror the public design tokens in a portable form.
 */
export const SHADOW_DESIGN_SYSTEM_STYLES = `
  :host {
    all: initial;
    --pg-font-sans: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    --pg-color-focus: #93c5fd;
    --pg-color-text-light: #f8fafc;
    --pg-color-muted-dark: #cbd5e1;
    --pg-color-header: #0f172a;
    --pg-color-surface: #f7f8fa;
    --pg-color-card: #ffffff;
    --pg-color-border: rgb(14 23 38 / 8%);
    --pg-color-ink: #0e1726;
    --pg-color-muted: #64748b;
    --pg-color-subtle: #94a3b8;
    --pg-color-accent: #1d4ed8;
    --pg-color-accent-hover: #1e40af;
    --pg-color-accent-soft: #eff6ff;
    --pg-color-success: #22c55e;
    --pg-color-warning: #f59e0b;
    --pg-radius-sm: 6px;
    --pg-radius-md: 8px;
    --pg-shadow-floating: 0 16px 40px rgb(15 23 42 / 24%);
    --pg-shadow-floating-light: 0 10px 28px rgb(15 23 42 / 12%);
  }

  .pg-design-surface {
    box-sizing: border-box;
    border: 1px solid rgb(148 163 184 / 22%);
    background: var(--pg-color-header);
    color: var(--pg-color-text-light);
    box-shadow: var(--pg-shadow-floating);
    font-family: var(--pg-font-sans);
    letter-spacing: 0;
  }

  .pg-design-surface[data-theme="light"] {
    border-color: var(--pg-color-border);
    background: var(--pg-color-card);
    color: var(--pg-color-ink);
    box-shadow: var(--pg-shadow-floating-light);
    --pg-color-focus: #1e40af;
  }

  .pg-design-muted {
    color: var(--pg-color-muted-dark);
  }

  .pg-design-surface[data-theme="light"] .pg-design-muted {
    color: var(--pg-color-muted);
  }

  .pg-design-button {
    appearance: none;
    box-sizing: border-box;
    border: 1px solid var(--pg-color-accent);
    border-radius: var(--pg-radius-sm);
    background: var(--pg-color-accent);
    color: #ffffff;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.2;
    transition:
      background 140ms ease,
      border-color 140ms ease,
      color 140ms ease;
  }

  .pg-design-button:hover {
    border-color: var(--pg-color-accent-hover);
    background: var(--pg-color-accent-hover);
  }

  .pg-design-button-subtle {
    border-color: rgb(148 163 184 / 28%);
    background: rgb(148 163 184 / 14%);
    color: #f8fafc;
  }

  .pg-design-button-subtle:hover {
    border-color: rgb(148 163 184 / 42%);
    background: rgb(148 163 184 / 22%);
  }

  .pg-design-surface[data-theme="light"] .pg-design-button-subtle {
    border-color: var(--pg-color-border);
    background: var(--pg-color-surface);
    color: var(--pg-color-ink);
  }

  .pg-design-surface[data-theme="light"] .pg-design-button-subtle:hover {
    border-color: var(--pg-color-accent);
    background: var(--pg-color-accent-soft);
    color: var(--pg-color-accent);
  }

  .pg-design-button:focus-visible {
    outline: 2px solid var(--pg-color-focus);
    outline-offset: 2px;
  }

  /* Used by horizontally centered fixed surfaces that set left: 50%. */
  @keyframes pg-design-pop-in {
    from {
      opacity: 0;
      transform: translate(-50%, 8px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0) scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 1ms !important;
      animation-iteration-count: 1 !important;
      scroll-behavior: auto !important;
      transition-duration: 1ms !important;
    }
  }
`;
