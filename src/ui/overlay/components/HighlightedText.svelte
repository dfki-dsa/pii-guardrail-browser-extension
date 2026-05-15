<script lang="ts">
  let {
    html,
    id,
    onToggleSpan,
  }: { html: string; id?: string; onToggleSpan?: (index: number) => void } = $props();

  function handleClick(event: MouseEvent) {
    if (!onToggleSpan) return;
    const target = event.target as HTMLElement | null;
    const hit = target?.closest('[data-pg-span-index]') as HTMLElement | null;
    if (!hit) return;
    const raw = hit.getAttribute('data-pg-span-index');
    if (raw === null) return;
    const idx = Number.parseInt(raw, 10);
    if (Number.isNaN(idx)) return;
    onToggleSpan(idx);
  }
</script>

<div class="pg-original-text" {id} onclick={handleClick} role="presentation">{@html html}</div>
