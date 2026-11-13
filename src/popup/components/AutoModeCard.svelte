<script lang="ts">
	import type { Writable } from 'svelte/store';
	import AutoModeInfo from '../../ui/shared/AutoModeInfo.svelte';
	import Toggle from './Toggle.svelte';

	// One toggle for auto-mode — the same setting as the "Auto-mode" switch in
	// the review pop-up. What it does sits behind the info tag rather than on
	// the card, so the Protect tab stays a list of switches.
	let {
		autoMode,
		setAutoMode
	}: {
		autoMode: Writable<boolean>;
		setAutoMode: (enabled: boolean) => Promise<void>;
	} = $props();
</script>

<article class="card">
	<div class="row">
		<div class="label">
			<span class="row-label">Auto-mode</span>
			<AutoModeInfo tipId="auto-mode-tip" placement="below" />
		</div>
		<Toggle size="sm" checked={$autoMode} label="Auto-mode" onchange={(checked) => setAutoMode(checked)} />
	</div>
</article>

<style>
	/* Not `overflow: hidden` like the other cards: the info tag opens outside it. */
	.card { border: var(--border-hairline); border-radius: var(--radius-lg); background: white; }
	.row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; }
	.label { display: flex; align-items: center; gap: 7px; min-width: 0; }
	.row-label { font-size: 13px; font-weight: 500; }
</style>
