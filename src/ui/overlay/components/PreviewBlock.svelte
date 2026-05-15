<script lang="ts">
  let { text, id }: { text: string; id?: string } = $props();
</script>

<div class="pg-preview" {id}>{@html text}</div>
