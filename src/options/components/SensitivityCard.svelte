<script lang="ts">
	import type { Writable } from 'svelte/store';
	import type { GroupName, Settings } from '../../shared/message-types';
	import CardHeading from '../../popup/components/CardHeading.svelte';
	import Segmented from '../../popup/components/Segmented.svelte';

	let {
		settings,
		groupNames,
		setSensitivityMode,
		setGlobalThreshold,
		setGroupThreshold,
	}: {
		settings: Writable<Settings | null>;
		groupNames: readonly GroupName[];
		setSensitivityMode: (mode: Settings['sensitivityMode']) => Promise<void>;
		setGlobalThreshold: (value: number) => Promise<void>;
		setGroupThreshold: (group: GroupName, value: number) => Promise<void>;
	} = $props();

	let mode = $derived($settings?.sensitivityMode ?? 'global');
	let globalValue = $derived($settings?.minConfidence ?? 0.5);
	let groupThresholds = $derived($settings?.groupThresholds ?? {});
</script>

<article class="card" id="sensitivity-section">
	<CardHeading title="Sensitivity" hint="Detection threshold tuning" />

	<div class="body">
		<div class="mode-row">
			<Segmented
				ariaLabel="Sensitivity mode"
				value={mode}
				options={[{ value: 'global', label: 'Global' }, { value: 'individual', label: 'Individual' }]}
				onchange={(next) => setSensitivityMode(next)}
			/>
		</div>

		{#if mode === 'global'}
			<p class="hint">
				One slider controls all categories proportionally, respecting each category's
				intrinsic sensitivity range.
			</p>
			<div class="slider-row">
				<div class="slider-head">
					<span class="row-label">Sensitivity</span>
					<span class="mono">{globalValue.toFixed(2)}</span>
				</div>
				<input
					type="range"
					min="0"
					max="100"
					value={Math.round(globalValue * 100)}
					oninput={(event) => setGlobalThreshold(Number(event.currentTarget.value) / 100)}
					aria-label="Global sensitivity"
				/>
				<div class="ticks"><span>Fewer detections</span><span>More detections</span></div>
			</div>
		{:else}
			<p class="hint">
				Each category group has its own slider. Switching back to Global will clear
				your individual overrides.
			</p>
			<div class="group-list">
				{#each groupNames as group (group)}
					{@const stored = groupThresholds[group]}
					{@const pos = stored !== undefined ? stored : 0.5}
					<div class="group-row">
						<span class="group-label">{group}</span>
						<input
							type="range"
							min="0"
							max="100"
							value={Math.round(pos * 100)}
							oninput={(event) => setGroupThreshold(group, Number(event.currentTarget.value) / 100)}
							aria-label="{group} sensitivity"
						/>
						<span class="mono">{pos.toFixed(2)}</span>
					</div>
				{/each}
			</div>
			<div class="ticks ticks-indent"><span>Fewer detections</span><span>More detections</span></div>
		{/if}
	</div>
</article>

<style>
	.card { margin-bottom: 12px; overflow: hidden; border: var(--border-hairline); border-radius: var(--radius-lg); background: var(--color-card); }
	.body { display: flex; flex-direction: column; gap: 12px; padding: 14px; }
	.mode-row { display: flex; }
	.hint { margin: 0; color: var(--color-muted); font-size: 12px; }
	.slider-row { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: var(--border-hairline); border-radius: var(--radius-md); background: var(--color-surface); }
	.slider-head, .ticks { display: flex; justify-content: space-between; }
	.row-label { font-size: 13px; font-weight: 500; }
	.mono { color: var(--color-accent); font-family: var(--font-mono); font-size: 12px; font-weight: 600; }
	.ticks { color: var(--color-muted); font-size: 11px; }
	.ticks-indent { padding: 0 14px; }
	.group-list { display: flex; flex-direction: column; gap: 8px; }
	.group-row {
		display: grid;
		grid-template-columns: 120px 1fr 44px;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		border: var(--border-hairline);
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}
	.group-label { font-size: 13px; font-weight: 500; }
	.group-row .mono { text-align: right; color: var(--color-muted); }
	input[type="range"] { width: 100%; accent-color: var(--color-accent); }
</style>
