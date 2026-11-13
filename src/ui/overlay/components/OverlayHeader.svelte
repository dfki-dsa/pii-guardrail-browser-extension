<script lang="ts">
  import PGLogo from "./PGLogo.svelte";

  let {
    totalCount,
    timingMs,
    replaced = false,
    onClose,
  }: {
    totalCount: number;
    timingMs?: number;
    /**
     * The paste was already replaced automatically. The header reads the same
     * either way; only what the close button promises differs.
     */
    replaced?: boolean;
    onClose: () => void;
  } = $props();
</script>

<header class="pg-header">
  <span class="pg-logo-box"><PGLogo size={32} /></span>
  <div class="pg-header-text">
    <span class="pg-brand">Sensitive data detected</span>
    <span class="pg-header-status">
      <span class="pg-count-num">{totalCount}</span>
      <span class="pg-count-text">
        item{totalCount === 1 ? "" : "s"} found
        {#if timingMs !== undefined}
          · detection took {timingMs} ms{/if}</span
      >
    </span>
  </div>
  <button
    type="button"
    class="pg-close"
    title={replaced ? "Close (the replacement stays)" : "Cancel (nothing pasted)"}
    aria-label={replaced ? "Close" : "Cancel"}
    onclick={onClose}>×</button
  >
</header>
