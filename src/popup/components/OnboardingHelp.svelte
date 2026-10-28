<script lang="ts">
  let {
    emphasized = false,
    showInvitation = false,
    onStart,
    onDismissInvitation,
    bindButton,
  }: {
    emphasized?: boolean;
    showInvitation?: boolean;
    onStart: () => void;
    onDismissInvitation: () => void;
    bindButton?: (element: HTMLButtonElement) => void;
  } = $props();
  let button: HTMLButtonElement;
  $effect(() => { if (button) bindButton?.(button); });
</script>

<div class="help-wrap" data-onboarding-anchor="onboarding-help">
  {#if showInvitation}
    <aside class="invitation" aria-label="Get to know Privacy Guardrail">
      <strong>Get to know Privacy Guardrail</strong>
      <span>Take a quick tour of the controls in Protect.</span>
      <div class="invitation-actions">
        <button type="button" class="start" onclick={onStart}>Start tour</button>
        <button type="button" class="quiet" onclick={onDismissInvitation}>Not now</button>
      </div>
    </aside>
  {/if}
  <button
    type="button"
    class:emphasized
    class="help-button"
    aria-label="Help: start Protect tour"
    onclick={onStart}
    bind:this={button}
  >
    <span aria-hidden="true">Help</span> ?
  </button>
</div>

<style>
  .help-wrap { position: relative; display: inline-flex; align-items: center; }
  .help-button { min-height: 32px; padding: 6px 8px; border: 0; border-radius: 6px; background: transparent; color: #bfdbfe; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
  .help-button:hover, .help-button:focus-visible { background: rgb(255 255 255 / 10%); color: #fff; outline: 2px solid #93c5fd; outline-offset: 1px; }
  .help-button.emphasized { animation: help-pulse 900ms ease-in-out 3; color: #fff; background: rgb(59 130 246 / 35%); }
  .invitation { position: absolute; z-index: 2; left: 0; bottom: calc(100% + 8px); width: 226px; padding: 10px; border: 1px solid #dbeafe; border-radius: 9px; background: #fff; box-shadow: 0 8px 18px rgb(15 23 42 / 22%); color: var(--color-ink); font-size: 11px; line-height: 1.35; }
  .invitation strong, .invitation span { display: block; }
  .invitation span { margin-top: 3px; color: var(--color-muted); }
  .invitation-actions { display: flex; gap: 6px; margin-top: 9px; }
  .invitation button { min-height: 30px; border-radius: 5px; padding: 4px 8px; font: inherit; font-size: 11px; font-weight: 600; cursor: pointer; }
  .start { border: 1px solid #2563eb; background: #2563eb; color: #fff; }
  .quiet { border: 1px solid #cbd5e1; background: #fff; color: #334155; }
  @keyframes help-pulse { 50% { box-shadow: 0 0 0 5px rgb(59 130 246 / 25%); } }
  @media (prefers-reduced-motion: reduce) { .help-button.emphasized { animation: none; } }
</style>
