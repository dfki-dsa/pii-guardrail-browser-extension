<script lang="ts">
	import type { Readable, Writable } from 'svelte/store';
	import type { StatusPill } from '../popup-model.svelte';
	import type { ResourceSummary } from '../../shared/popup-resource-summary';
	import { AI_TRANSPARENCY_NOTICE } from '../../shared/project-links';

	let { enabled, wasmStatus, nerStatus, cpuFallback, resourceSummary }: {
		enabled: Writable<boolean>;
		wasmStatus: Writable<StatusPill>;
		nerStatus: Writable<StatusPill>;
		cpuFallback: Writable<boolean>;
		resourceSummary: Readable<ResourceSummary | null>;
	} = $props();
</script>

<div class="pill-row" aria-label="System status">
	<span class="pill">
		<span class={['dot', !$enabled && 'off']}></span>
		<span class="key">protection</span>
		<span class="value">{$enabled ? 'on' : 'off'}</span>
	</span>
	<span class="pill" title={$nerStatus.title}>
		<span class={['dot', $nerStatus.tone]}></span>
		<span class="key">local ai</span>
		<span class="value">{$nerStatus.label}</span>
	</span>
	<span class="pill" title={$wasmStatus.title}>
		<span class={['dot', $wasmStatus.tone]}></span>
		<span class="key">wasm</span>
		<span class="value">{$wasmStatus.label}</span>
	</span>
</div>

<p class="ai-notice" role="note">{AI_TRANSPARENCY_NOTICE}</p>

{#if $resourceSummary}
	<div class="resource-summary" data-tone={$resourceSummary.tone} role="status" aria-label="Local AI resource status">
		<strong>{$resourceSummary.title}</strong>
		<span>{$resourceSummary.detail}</span>
	</div>
{:else if $cpuFallback}
	<div class="resource-summary" data-tone="warning" role="status">
		<strong>Running on CPU fallback.</strong>
		<span>WebGPU is unavailable, so local detection will be slower. Expect paste detection to take at least a couple of seconds.</span>
	</div>
{/if}

<style>
	.pill-row { display: flex; flex-wrap: wrap; gap: 6px; }
	.ai-notice { margin: 8px 0 0; color: var(--color-muted); font-size: 11px; line-height: 1.4; }
	.pill { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; padding: 5px 9px; border: 1px solid var(--color-border); border-radius: var(--radius-pill); background: white; color: var(--color-ink); font-size: 11px; }
	.dot { width: 5px; height: 5px; border-radius: 3px; background: var(--color-success); flex-shrink: 0; }
	.dot.off, .dot.muted { background: #cbd5e1; }
	.dot.danger { background: var(--color-danger); }
	.dot.ok { background: var(--color-success); }
	.key { color: var(--color-muted); }
	.value { overflow: hidden; font-family: var(--font-mono); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
	.resource-summary { display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; border: 1px solid rgb(245 158 11 / 42%); border-radius: 10px; background: rgb(245 158 11 / 12%); color: #92400e; font-size: 12px; line-height: 1.35; }
	.resource-summary strong { color: #b45309; font-size: 12px; }
	.resource-summary[data-tone='critical'] { border-color: rgb(239 68 68 / 55%); background: rgb(239 68 68 / 12%); color: #991b1b; }
	.resource-summary[data-tone='critical'] strong { color: #b91c1c; }
	.resource-summary[data-tone='info'] { border-color: rgb(59 130 246 / 42%); background: rgb(59 130 246 / 10%); color: #1e3a8a; }
	.resource-summary[data-tone='info'] strong { color: #1d4ed8; }
	.resource-summary[data-tone='ok'] { border-color: rgb(34 197 94 / 45%); background: rgb(34 197 94 / 10%); color: #065f46; }
	.resource-summary[data-tone='ok'] strong { color: #047857; }
	.resource-summary[data-tone='muted'] { border-color: rgb(148 163 184 / 45%); background: rgb(148 163 184 / 10%); color: #334155; }
	.resource-summary[data-tone='muted'] strong { color: #1e293b; }
</style>
