<script lang="ts">
	import type { CategoriesModel, TestModel } from '../popup-model.svelte';
	import CardHeading from './CardHeading.svelte';

	let { runMockDetection }: Pick<CategoriesModel, 'enabledCount'> & Pick<TestModel, 'runCount' | 'runMockDetection'> = $props();
	let sampleText = $state("Hi, I'm Dana Reyes (dana@acme.io), card 4242 4242 4242 4242.");
</script>

<article class="card">
	<CardHeading title="Test detection" hint="dry-run" />
	<div class="body">
		<textarea bind:value={sampleText} aria-label="Sample text to test for sensitive data" placeholder="Paste sample text…"></textarea>
		<button type="button" onclick={runMockDetection}>Run detection</button>
	</div>
</article>

<style>
	.card { margin-bottom: 8px; overflow: hidden; border: var(--border-hairline); border-radius: var(--radius-lg); background: white; }
	.body { padding: 10px 12px 12px; }
	textarea { box-sizing: border-box; width: 100%; height: 76px; margin-bottom: 8px; padding: 10px; resize: none; border: 1px solid var(--color-border-strong); border-radius: 6px; outline: none; background: #f8fafc; color: var(--color-ink); font: 11px/1.5 var(--font-mono); }
	button { width: 100%; padding: 9px; border: 0; border-radius: 6px; background: var(--color-accent); color: white; font-size: 12px; font-weight: 600; cursor: pointer; }
</style>
