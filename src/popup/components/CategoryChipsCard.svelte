<script lang="ts">
	import type { CategoriesModel } from '../popup-model.svelte';
	import CardHeading from './CardHeading.svelte';

	let { categories, enabledCount, toggleCategory }: Pick<CategoriesModel, 'categories' | 'enabledCount' | 'toggleCategory'> = $props();
</script>

<article class="card">
	<CardHeading title="Detection categories" badge={`${$enabledCount}/${$categories.length}`} />
	<div class="chip-grid" aria-label="Detection category controls">
		{#each $categories as category (category.id)}
			<button type="button" class={['chip', category.enabled && 'enabled']} aria-pressed={category.enabled} onclick={() => toggleCategory(category.id)}>
				<span class="chip-dot"></span>{category.label}
			</button>
		{/each}
	</div>
</article>

<style>
	.card { margin-bottom: 8px; overflow: hidden; border: var(--border-hairline); border-radius: var(--radius-lg); background: white; }
	.chip-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 10px; }
	.chip {
		display: flex; align-items: center; gap: 7px; padding: 8px 10px; border: 0; border-radius: 6px;
		background: #f1f5f9; color: var(--color-subtle); font-size: 12px; font-weight: 400; cursor: pointer; text-align: left;
	}
	.chip.enabled { background: var(--color-accent-soft); color: var(--color-accent); }
	.chip-dot { width: 6px; height: 6px; border-radius: 3px; background: #cbd5e1; flex-shrink: 0; }
	.chip.enabled .chip-dot { background: var(--color-success); }
</style>
