<script lang="ts">
  import type { PiiSpan } from '../../../shared/message-types';
  import { truncate } from '../overlay-model';

  let {
    span,
    index,
    onRemove,
  }: { span: PiiSpan; index: number; onRemove: (i: number) => void } = $props();
</script>

<div class="pg-entity-row pg-entity-manual">
  <label class="pg-entity-checkbox">
    <input type="checkbox" checked disabled />
  </label>
  <span class="pg-entity-text" title={span.text}>{truncate(span.text, 24)}</span>
  <span class="pg-entity-type-label">{span.entity_type}</span>
  <span class="pg-entity-score">manual</span>
  <button
    type="button"
    class="pg-entity-dismiss"
    title="Remove"
    aria-label="Remove manual span"
    onclick={() => onRemove(index)}
  >×</button>
</div>
