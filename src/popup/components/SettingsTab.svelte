<script lang="ts">
	import type { Readable, Writable } from 'svelte/store';
	import type { FeedbackCounts } from '../popup-model.svelte';
	import type { NerModelKey, Settings } from '../../shared/message-types';
	import type { ACTIVE_NER_MODELS } from '../../shared/constants';
	import Toggle from './Toggle.svelte';

	let {
		minConfidence,
		debug,
		clipboardInterceptEnabled,
		nerModel,
		availableNerModels,
		sensitivityMode,
		feedbackCounts,
		mappingCount,
		setMinConfidence,
		setDebug,
		setClipboardInterceptEnabled,
		setNerModel,
		openOptions,
		openIssueReport,
		openSecurityReport,
		openPrivacySupport,
		clearFeedback,
		clearMappings,
	}: {
		minConfidence: Writable<number>;
		debug: Writable<boolean>;
		clipboardInterceptEnabled: Writable<boolean>;
		nerModel: Writable<NerModelKey>;
		availableNerModels: typeof ACTIVE_NER_MODELS;
		sensitivityMode: Writable<Settings['sensitivityMode']>;
		feedbackCounts: Writable<FeedbackCounts>;
		mappingCount: Writable<number>;
		setMinConfidence: (value: number) => Promise<void>;
		setDebug: (enabled: boolean) => Promise<void>;
		setClipboardInterceptEnabled: (enabled: boolean) => Promise<void>;
		setNerModel: (model: NerModelKey) => Promise<void>;
		openOptions: () => void;
		openIssueReport: () => void;
		openSecurityReport: () => void;
		openPrivacySupport: () => void;
		clearFeedback: () => Promise<void>;
		clearMappings: () => Promise<void>;
	} = $props();
	let sliderValue = $derived(Math.round($minConfidence * 100));
</script>

<div class="settings-stack">
	<article class="card">
		<div class="head"><span>Detection</span></div>
		{#if $sensitivityMode === 'global'}
			<div class="row-col">
				<div class="row-head"><span class="row-label">Sensitivity</span><span class="mono">{$minConfidence.toFixed(2)}</span></div>
				<input type="range" min="0" max="100" value={sliderValue} oninput={(event) => setMinConfidence(Number(event.currentTarget.value) / 100)} aria-label="Detection sensitivity" />
				<div class="ticks"><span>Fewer detections</span><span>More detections</span></div>
			</div>
		{:else}
			<div class="row">
				<div><div class="row-label">Sensitivity</div><div class="row-meta">Individual mode — configure per-group thresholds in Options.</div></div>
				<button type="button" class="select" onclick={openOptions}>Options ›</button>
			</div>
		{/if}
		<div class="divider"></div>
		<div class="row">
			<div><div class="row-label">NER model</div><div class="row-meta">Local transformer used for detection</div></div>
			<select value={$nerModel} onchange={(event) => setNerModel(event.currentTarget.value as NerModelKey)}>
				{#each availableNerModels as model (model.key)}
					<option value={model.key}>{model.label}</option>
				{/each}
			</select>
		</div>
	</article>

	<article class="card">
		<div class="head"><span>Behavior</span></div>
		<div class="row"><div><div class="row-label">Intercept clipboard</div><div class="row-meta">Offer to restore copied anonymized items</div></div><Toggle size="sm" checked={$clipboardInterceptEnabled} onchange={(checked) => setClipboardInterceptEnabled(checked)} label="Intercept clipboard" /></div>
		<div class="divider"></div>
		<div class="row"><div><div class="row-label">Debug mode</div><div class="row-meta">Verbose logging in console</div></div><Toggle size="sm" checked={$debug} onchange={(checked) => setDebug(checked)} label="Debug mode" /></div>
	</article>

	<article class="card">
		<div class="head"><span>Maintenance</span></div>
		<button type="button" class="link-row" onclick={clearFeedback}><span class="row-label">Clear feedback</span><span class="right"><span class="count">{$feedbackCounts.confirmed} corrections</span>›</span></button>
		<div class="divider"></div>
		<button type="button" class="link-row" onclick={clearMappings}><span class="row-label">Clear mappings</span><span class="right"><span class="count">{$mappingCount} saved</span>›</span></button>
	</article>

	<article class="card">
		<div class="head"><span>Support</span></div>
		<button type="button" class="link-row" onclick={openIssueReport}><span class="row-label">Report issue</span><span class="right">›</span></button>
		<div class="divider"></div>
		<button type="button" class="link-row" onclick={openSecurityReport}><span class="row-label">Report security/privacy issue</span><span class="right">›</span></button>
		<div class="divider"></div>
		<button type="button" class="link-row" onclick={openPrivacySupport}><span class="row-label">Privacy/support</span><span class="right">›</span></button>
	</article>
	<div class="version-note">Privacy Guardrail · {$nerModel}</div>
</div>

<style>
	.settings-stack { display: grid; }
	.card { margin-bottom: 8px; overflow: hidden; border: var(--border-hairline); border-radius: var(--radius-lg); background: white; }
	.head { display: flex; justify-content: space-between; padding: 11px 12px; border-bottom: 1px solid var(--color-border); }
	.head span { font-size: 12px; font-weight: 600; }
	.row, .link-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; }
	.link-row { width: 100%; border: 0; background: transparent; color: var(--color-ink); cursor: pointer; }
	.row-col { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; }
	.row-head, .ticks { display: flex; justify-content: space-between; }
	.row-label { font-size: 13px; font-weight: 500; }
	.row-meta, .ticks { color: var(--color-muted); font-size: 11px; }
	.mono, .count { color: var(--color-accent); font-family: var(--font-mono); font-size: 12px; font-weight: 600; }
	.count { color: var(--color-muted); font-size: 11px; }
	input { width: 100%; accent-color: var(--color-accent); }
	select, .select { display: flex; align-items: center; gap: 6px; max-width: 180px; padding: 5px 10px; border: 0; border-radius: 6px; background: #f1f5f9; color: var(--color-ink); font-size: 12px; font-weight: 500; cursor: pointer; }
	.divider { height: 1px; background: var(--color-border); }
	.right { display: flex; align-items: center; gap: 8px; }
	.version-note { padding: 4px 0 8px; color: var(--color-subtle); font-family: var(--font-mono); font-size: 10px; text-align: center; }
</style>
