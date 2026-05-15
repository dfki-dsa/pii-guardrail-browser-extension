<script lang="ts">
	import type { CategoriesModel, DetectionCategoryId } from '../popup-model.svelte';
	import CardHeading from './CardHeading.svelte';

	type MockResult = { id: string; label: string; value: string; categoryId: DetectionCategoryId; confidence: string };
	let { categories }: Pick<CategoriesModel, 'categories'> = $props();
	const mockResults: MockResult[] = [
		{ id: 'person-name', label: 'Identity', value: 'Dana Reyes', categoryId: 'Identity', confidence: '0.98' },
		{ id: 'email-address', label: 'Contact', value: 'dana@acme.io', categoryId: 'Contact', confidence: '0.99' },
		{ id: 'card', label: 'Financial', value: '4242 4242 4242 …', categoryId: 'Financial', confidence: '0.95' }
	];
	function categoryEnabled(categoryId: DetectionCategoryId) { return $categories.find((category) => category.id === categoryId)?.enabled ?? false; }
</script>

<article class="card">
	<CardHeading title="Detected" badge="3 spans" />
	<div class="list" aria-label="Mock detection results">
		{#each mockResults as result, index (result.id)}
			<div class={['row', !categoryEnabled(result.categoryId) && 'muted']}>
				<span class="tag">{result.label}</span><span class="val">{result.value}</span><span class="conf">{result.confidence}</span>
			</div>
			{#if index < mockResults.length - 1}<div class="divider"></div>{/if}
		{/each}
	</div>
</article>

<style>
	.card { margin-bottom: 8px; overflow: hidden; border: var(--border-hairline); border-radius: var(--radius-lg); background: white; }
	.row { display: flex; align-items: center; gap: 10px; padding: 9px 12px; }
	.row.muted { opacity: .55; }
	.tag { padding: 2px 7px; border-radius: 4px; background: var(--color-accent-soft); color: var(--color-accent); font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: .2px; }
	.val { flex: 1; overflow: hidden; color: var(--color-ink); font-family: var(--font-mono); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
	.conf { color: var(--color-success); font-family: var(--font-mono); font-size: 11px; font-weight: 600; }
	.divider { height: 1px; background: var(--color-border); }
</style>
