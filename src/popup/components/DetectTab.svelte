<script lang="ts">
	import type { CategoriesModel } from '../popup-model.svelte';
	import DetectionRulesCard from './DetectionRulesCard.svelte';
	import SharedConfigCard from './SharedConfigCard.svelte';

	let { categories }: { categories: CategoriesModel } = $props();
</script>

<div class="detect-stack">
	<DetectionRulesCard
		categories={categories.categories}
		enabledCount={categories.enabledCount}
		setCategoryEnabled={categories.setCategoryEnabled}
	/>
	<SharedConfigCard />
</div>

<style>
	.detect-stack {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
</style>
