<script lang="ts">
	import type { Writable } from 'svelte/store';

	let {
		visible,
		openOnboarding,
		dismiss,
	}: {
		visible: Writable<boolean>;
		openOnboarding: () => void;
		dismiss: () => void;
	} = $props();
</script>

{#if $visible}
	<article class="first-run" role="note">
		<div class="copy">
			<p class="title">New here?</p>
			<p class="detail">
				Why the download is so big, where your text goes, what gets saved, and how fast it will
				run here.
			</p>
		</div>
		<div class="row">
			<button type="button" class="primary" onclick={openOnboarding}>Take the tour</button>
			<button type="button" class="ghost" onclick={dismiss}>No thanks</button>
		</div>
	</article>
{/if}

<style>
	.first-run {
		padding: 12px 14px;
		border: 1px solid rgb(127 102 204 / 32%);
		border-radius: var(--radius-lg);
		background: rgb(127 102 204 / 9%);
	}
	.title {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
		color: var(--color-ink);
	}
	.detail {
		margin: 4px 0 0;
		font-size: 12px;
		line-height: 1.5;
		color: var(--color-muted);
	}
	.row {
		display: flex;
		gap: 8px;
		margin-top: 10px;
	}
	.row button {
		padding: 6px 12px;
		border-radius: var(--radius-sm);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
	}
	.primary {
		border: 0;
		background: var(--color-glow);
		color: white;
		font-weight: 600;
	}
	.ghost {
		border: 0;
		background: transparent;
		color: var(--color-muted);
	}
	.ghost:hover {
		color: var(--color-ink);
	}
	.row button:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}
</style>
