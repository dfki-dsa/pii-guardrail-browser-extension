<script lang="ts">
  import { ENTITY_TYPES, type EntityType } from '../../../shared/message-types';

  let {
    snippet,
    onCancel,
    onAdd,
  }: {
    snippet: string;
    onCancel: () => void;
    onAdd: (text: string, type: EntityType) => void;
  } = $props();

  const COMMON_TYPES: readonly EntityType[] = [
    'PERSON',
    'EMAIL',
    'PHONE',
    'ADDRESS',
    'ORGANIZATION',
    'CREDIT_CARD',
  ];
  const MORE_TYPES = ENTITY_TYPES.filter((t) => !COMMON_TYPES.includes(t));

  let activeType = $state<EntityType>('ADDRESS');
  let expanded = $state(false);

  function label(t: EntityType): string {
    const lower = t.toLowerCase().replace(/_/g, ' ');
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }

  function pillClass(t: EntityType): string {
    return `pg-pill-${t.toLowerCase()}`;
  }
</script>

<div class="pg-mark-overlay" role="dialog" aria-label="Mark new PII">
  <span aria-hidden="true" class="pg-mark-nook"></span>
  <span aria-hidden="true" class="pg-mark-nook-cover"></span>

  <div class="pg-mark-head">
    <div class="pg-mark-head-title">
      <span>Mark new PII</span>
    </div>
    <button type="button" class="pg-mark-close" aria-label="Close" onclick={onCancel}>
      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
        <path d="M2.5 2.5l6 6M8.5 2.5l-6 6" />
      </svg>
    </button>
  </div>

  <div class="pg-mark-body">
    <div class="pg-mark-kicker">Selection</div>
    <div class="pg-mark-snippet" title={snippet}>{snippet}</div>

    <div class="pg-mark-kicker">Assign type</div>
    <div class="pg-mark-type-grid">
      {#each COMMON_TYPES as t (t)}
        <button
          type="button"
          class={['pg-mark-type-btn', activeType === t && 'pg-mark-type-btn-active', activeType === t && pillClass(t)]}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => (activeType = t)}
        >
          <span class={['pg-mark-type-dot', pillClass(t)]}></span>
          {label(t)}
        </button>
      {/each}
    </div>

    {#if expanded}
      <div class="pg-mark-type-grid pg-mark-type-grid-more">
        {#each MORE_TYPES as t (t)}
          <button
            type="button"
            class={['pg-mark-type-btn', activeType === t && 'pg-mark-type-btn-active', activeType === t && pillClass(t)]}
            onmousedown={(e) => e.preventDefault()}
            onclick={() => (activeType = t)}
          >
            <span class={['pg-mark-type-dot', pillClass(t)]}></span>
            {label(t)}
          </button>
        {/each}
      </div>
    {/if}

    {#if MORE_TYPES.length > 0}
      <button
        type="button"
        class="pg-mark-more"
        onmousedown={(e) => e.preventDefault()}
        onclick={() => (expanded = !expanded)}
      >
        <span>{expanded ? 'Fewer types' : `${MORE_TYPES.length} more types…`}</span>
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
          {#if expanded}
            <path d="M2 5.5L4.5 3 7 5.5" />
          {:else}
            <path d="M2 4.5h5M5 2.5l2 2-2 2" />
          {/if}
        </svg>
      </button>
    {/if}
  </div>

  <div class="pg-mark-foot">
    <button type="button" class="pg-mark-cancel" onclick={onCancel}>Cancel</button>
    <button
      type="button"
      class="pg-mark-add"
      onmousedown={(e) => e.preventDefault()}
      onclick={() => onAdd(snippet, activeType)}
    >Add as {label(activeType)}</button>
  </div>
</div>
