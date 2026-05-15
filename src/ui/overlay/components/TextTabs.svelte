<script lang="ts">
  import HighlightedText from './HighlightedText.svelte';
  import PreviewBlock from './PreviewBlock.svelte';

  let {
    highlightedHtml,
    previewText,
    replacedCount,
    onToggleSpan,
  }: {
    highlightedHtml: string;
    previewText: string;
    replacedCount: number;
    onToggleSpan?: (index: number) => void;
  } = $props();

  let active = $state<'original' | 'anonymized'>('original');
</script>

<article class="pg-card pg-text-card">
  <div class="pg-tab-bar">
    <button
      type="button"
      class="pg-tab"
      class:pg-tab-active={active === 'original'}
      onclick={() => (active = 'original')}
    >Original</button>
    <button
      type="button"
      class="pg-tab"
      class:pg-tab-active={active === 'anonymized'}
      onclick={() => (active = 'anonymized')}
    >Anonymized <span class="pg-tab-badge">{replacedCount}</span></button>
  </div>
  <div class="pg-card-body">
    {#if active === 'original'}
      <HighlightedText html={highlightedHtml} id="pg-original" {onToggleSpan} />
    {:else}
      <PreviewBlock text={previewText} id="pg-preview" />
    {/if}
  </div>
</article>
