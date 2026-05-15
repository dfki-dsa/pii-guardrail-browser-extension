<script lang="ts">
  import PGLogo from "./PGLogo.svelte";

  let { totalCount, timingMs, onClose }: { totalCount: number; timingMs?: number; onClose: () => void } = $props();
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
  <button type="button" class="pg-close" title="Cancel (nothing pasted)" aria-label="Cancel" onclick={onClose}>×</button
  >
</header>
