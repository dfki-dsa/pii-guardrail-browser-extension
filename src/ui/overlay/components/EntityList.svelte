<script lang="ts">
  import type { EntityType } from '../../../shared/message-types';
  import type { OverlayModel } from '../overlay-model';
  import EntityRow from './EntityRow.svelte';
  import ManualSpanRow from './ManualSpanRow.svelte';

  let { model }: { model: OverlayModel } = $props();

  // svelte-ignore state_referenced_locally
  const { spanStates, manualSpans, mainIndices, codeBlockIndices } = model;

  function onToggle(i: number, enabled: boolean) {
    model.toggle(i, enabled);
  }
  function onRetype(i: number, type: EntityType) {
    model.retype(i, type);
  }
  function onDismissClick(i: number, anchor: HTMLElement) {
    const rect = anchor.getBoundingClientRect();
    model.openDismissMenu(i, {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
    });
  }
  function onRemoveManual(i: number) {
    model.removeManual(i);
  }
</script>

<div class="pg-entity-list" id="pg-entities">
  {#each $mainIndices as i (i)}
    <EntityRow
      state={$spanStates[i]}
      index={i}
      belowThreshold={model.isBelowThreshold($spanStates[i])}
      {onToggle}
      {onRetype}
      {onDismissClick}
    />
  {/each}

  {#each $manualSpans as span, i (i)}
    <ManualSpanRow {span} index={i} onRemove={onRemoveManual} />
  {/each}

  {#if $codeBlockIndices.length > 0}
    <details class="pg-code-disclosure">
      <summary class="pg-code-disclosure-summary">In code blocks ({$codeBlockIndices.length})</summary>
      <div class="pg-code-disclosure-body">
        {#each $codeBlockIndices as i (i)}
          <EntityRow
            state={$spanStates[i]}
            index={i}
            belowThreshold={model.isBelowThreshold($spanStates[i])}
            {onToggle}
            {onRetype}
            {onDismissClick}
          />
        {/each}
      </div>
    </details>
  {/if}
</div>
