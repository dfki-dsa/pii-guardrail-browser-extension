<script lang="ts">
	import type { Readable, Writable } from 'svelte/store';
	import type { FeedbackCounts } from '../popup-model.svelte';
	import FeedbackCard from './FeedbackCard.svelte';
	import CardHeading from './CardHeading.svelte';

	let {
		testInput,
		isRunning,
		resultText,
		enabledCount,
		feedbackCounts,
		runDetection,
		clearFeedback,
	}: {
		testInput: Writable<string>;
		isRunning: Writable<boolean>;
		resultText: Writable<string>;
		enabledCount: Readable<number>;
		feedbackCounts: Writable<FeedbackCounts>;
		runDetection: () => Promise<void>;
		clearFeedback: () => Promise<void>;
	} = $props();
</script>

<div class="test-stack">
	<article class="card">
		<CardHeading title="Test detection" hint={`${$enabledCount} categories`} />
		<div class="body">
			<textarea bind:value={$testInput} aria-label="Sample text to test for sensitive data" placeholder="Paste sample text…"></textarea>
			<button type="button" disabled={$isRunning || !$testInput.trim()} onclick={runDetection}>{$isRunning ? 'Detecting…' : 'Run detection'}</button>
		</div>
	</article>

	{#if $resultText}
		<article class="card">
			<CardHeading title="Detected" />
			<pre class="results">{$resultText}</pre>
		</article>
	{/if}

	<FeedbackCard {feedbackCounts} {clearFeedback} />
</div>

<style>
	.test-stack { display: flex; flex-direction: column; gap: 8px; }
	.card { overflow: hidden; border: var(--border-hairline); border-radius: var(--radius-lg); background: white; }
	.body { padding: 10px 12px 12px; }
	textarea { box-sizing: border-box; width: 100%; height: 96px; margin-bottom: 8px; padding: 10px; resize: vertical; border: 1px solid var(--color-border-strong); border-radius: 6px; outline: none; background: #f8fafc; color: var(--color-ink); font: 11px/1.5 var(--font-mono); }
	button { width: 100%; padding: 9px; border: 0; border-radius: 6px; background: var(--color-accent); color: white; font-size: 12px; font-weight: 600; cursor: pointer; }
	button:disabled { cursor: not-allowed; opacity: 0.55; }
	.results { margin: 0; padding: 10px 12px 12px; overflow-x: auto; white-space: pre-wrap; color: var(--color-ink); font: 11px/1.5 var(--font-mono); }
</style>
