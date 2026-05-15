<script lang="ts">
  import type { EntityType } from '../../shared/message-types';
  import type { OverlayModel } from './overlay-model';
  import OverlayHeader from './components/OverlayHeader.svelte';
  import TextTabs from './components/TextTabs.svelte';
  import EntityList from './components/EntityList.svelte';
  import ConfidenceSlider from './components/ConfidenceSlider.svelte';
  import MarkOverlay from './components/MarkOverlay.svelte';
  import DismissMenu from './components/DismissMenu.svelte';

  let {
    model,
    shadowRoot,
  }: { model: OverlayModel; shadowRoot: ShadowRoot } = $props();

  // Model is created once and passed in as a stable reference for the
  // overlay's lifetime, so destructuring its store fields is safe.
  // svelte-ignore state_referenced_locally
  const { totalCount, enabledCount, highlightedHtml, previewText, confidenceThreshold, selectedSnippet, dismissMenu, spanStates } = model;

  function toggleSpanByIndex(index: number) {
    const current = $spanStates[index];
    if (!current) return;
    model.toggle(index, !current.enabled);
  }

  function readSelectionFromOriginal(): string | null {
    const sel =
      (shadowRoot as unknown as { getSelection?: () => Selection | null }).getSelection?.() ??
      window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    const container = (range.commonAncestorContainer as Element | Text).nodeType === 1
      ? (range.commonAncestorContainer as Element)
      : range.commonAncestorContainer.parentElement;
    if (!container || !container.closest('.pg-original-text')) return null;
    const text = sel.toString().trim();
    return text || null;
  }

  $effect(() => {
    function onSelectionChange() {
      const text = readSelectionFromOriginal();
      if (text) {
        model.setSelectedSnippet(text);
      } else {
        model.setSelectedSnippet(null);
      }
    }
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  });

  function onMarkAdd(text: string, type: EntityType) {
    model.addManual(text, type);
  }
</script>

<div class="pg-overlay-backdrop">
  <div class="pg-overlay">
    <OverlayHeader
      totalCount={$totalCount}
      timingMs={model.timings?.totalMs}
      onClose={() => model.cancel()}
    />

    <div class="pg-overlay-body">
      <TextTabs
        highlightedHtml={$highlightedHtml}
        previewText={$previewText}
        replacedCount={$enabledCount}
        onToggleSpan={toggleSpanByIndex}
      />

      <article class="pg-card">
        <div class="pg-card-head">
          <span class="pg-card-title">Entities</span>
          <span class="pg-card-badge">{$enabledCount} of {$totalCount}</span>
        </div>
        <div class="pg-card-body">
          <EntityList {model} />
        </div>
        <div class="pg-card-foot">
          <ConfidenceSlider value={$confidenceThreshold} onChange={(v) => model.setThreshold(v)} />
        </div>
      </article>

      {#if $selectedSnippet}
        <MarkOverlay
          snippet={$selectedSnippet}
          onCancel={() => model.setSelectedSnippet(null)}
          onAdd={onMarkAdd}
        />
      {/if}
    </div>

    <footer class="pg-footer">
      <div class="pg-footer-left">
        <button
          type="button"
          class="pg-btn-link"
          title="Esc"
          onclick={() => model.pasteOriginal()}
        >Paste original</button>
      </div>
      <div class="pg-footer-right">
        <span class="pg-footer-summary">Replacing {$enabledCount} of {$totalCount} items</span>
        <button
          type="button"
          class="pg-btn pg-btn-primary"
          id="pg-confirm-btn"
          title="Enter"
          onclick={() => model.confirm()}
        >Anonymize &amp; paste</button>
      </div>
    </footer>

  </div>

  {#if $dismissMenu}
    <DismissMenu
      menu={$dismissMenu}
      {shadowRoot}
      onChoose={(persist) => model.confirmDismiss(persist)}
      onClose={() => model.closeDismissMenu()}
    />
  {/if}
</div>
