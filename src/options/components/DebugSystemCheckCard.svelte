<script lang="ts">
	import type { Writable } from 'svelte/store';
	import type { Settings, SystemCompatibilityStatus } from '../../shared/message-types';
	import type { DebugSystemCheckScenario } from '../options-model.svelte';
	import CardHeading from '../../popup/components/CardHeading.svelte';

	let {
		settings,
		status,
		setDebug,
		applyScenario,
		clearOverride,
	}: {
		settings: Writable<Settings | null>;
		status: Writable<SystemCompatibilityStatus | null>;
		setDebug: (value: boolean) => Promise<void>;
		applyScenario: (scenario: DebugSystemCheckScenario) => Promise<void>;
		clearOverride: () => Promise<void>;
	} = $props();

	const scenarios: { id: DebugSystemCheckScenario; label: string; hint: string }[] = [
		{ id: 'ok-enabled', label: 'OK · Local AI on', hint: '32 GB · WebGPU available · auto-warm allowed' },
		{ id: 'warning-enabled', label: 'Warning · Local AI on', hint: '12 GB · resource warning banner' },
		{ id: 'unknown-enabled', label: 'Unknown memory · Local AI on', hint: 'memory unavailable · warning banner' },
		{ id: 'critical-auto-disabled', label: 'Critical · auto-disabled', hint: '8 GB · Local AI off · modal pending' },
		{ id: 'critical-override', label: 'Critical · re-enabled override', hint: '8 GB · explicit override' },
		{ id: 'cpu-fallback', label: 'OK · WebGPU unavailable', hint: 'CPU/WASM fallback signal' },
		{ id: 'load-failure', label: 'Load failure', hint: 'Local AI off · failure banner' },
		{ id: 'user-off', label: 'User turned Local AI off', hint: 'pattern-only mode' },
	];

	let debugEnabled = $derived($settings?.debug === true);
</script>

<article class="card" id="debug-system-check-section" aria-labelledby="debug-system-check-heading">
	<CardHeading title="Debug: system compatibility" hint="For local testing only" />

	<div class="body">
		<label class="toggle-row" for="debug-mode-toggle">
			<div>
				<span>Debug mode</span>
				<p>Reveals testing controls that simulate compatibility states without restarting the browser.</p>
			</div>
			<input
				id="debug-mode-toggle"
				type="checkbox"
				checked={debugEnabled}
				onchange={(event) => setDebug(event.currentTarget.checked)}
			/>
		</label>

		{#if debugEnabled}
			<p class="warning" role="note">
				These buttons write directly to <code>pg_system_check</code> and the Local AI
				setting. Use only when testing — to return to the real passive check, click
				<strong>Clear &amp; re-run passive check</strong>.
			</p>

			<div class="current" data-tier={$status?.tier ?? 'unknown'}>
				<div>
					<span class="label">Tier</span>
					<strong>{$status?.tier ?? '—'}</strong>
				</div>
				<div>
					<span class="label">Local AI</span>
					<strong>{$status?.localAiState ?? '—'}</strong>
				</div>
				<div>
					<span class="label">Memory</span>
					<strong>{typeof $status?.browserMemoryGb === 'number' ? `${$status.browserMemoryGb} GB` : 'unavailable'}</strong>
				</div>
				<div>
					<span class="label">WebGPU</span>
					<strong>{$status?.webGpu ?? '—'}</strong>
				</div>
				<div>
					<span class="label">Modal</span>
					<strong>{$status?.criticalModal ?? '—'}</strong>
				</div>
				<div>
					<span class="label">Runtime</span>
					<strong>{$status?.runtimeState ?? '—'}</strong>
				</div>
			</div>

			<div class="grid">
				{#each scenarios as scenario (scenario.id)}
					<button type="button" class="scenario" onclick={() => applyScenario(scenario.id)}>
						<strong>{scenario.label}</strong>
						<span>{scenario.hint}</span>
					</button>
				{/each}
			</div>

			<button type="button" class="reset" onclick={clearOverride}>
				Clear &amp; re-run passive check
			</button>
		{/if}
	</div>
</article>

<style>
	.card { margin-bottom: 12px; overflow: hidden; border: var(--border-hairline); border-radius: var(--radius-lg); background: var(--color-card); }
	.body { padding: 14px; }
	.toggle-row { display: flex; align-items: start; justify-content: space-between; gap: 16px; }
	.toggle-row span { font-size: 13px; font-weight: 600; }
	.toggle-row p { margin: 4px 0 0; color: var(--color-muted); font-size: 12px; line-height: 1.5; }
	input[type='checkbox'] { width: 18px; height: 18px; flex: 0 0 auto; accent-color: var(--color-accent); }
	.warning { margin: 12px 0; padding: 10px 12px; border: 1px solid rgb(245 158 11 / 42%); background: rgb(245 158 11 / 10%); color: #92400e; border-radius: var(--radius-md); font-size: 12px; line-height: 1.45; }
	.warning code { background: rgb(0 0 0 / 6%); padding: 1px 4px; border-radius: 3px; font-family: var(--font-mono); font-size: 11px; }
	.current { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; padding: 12px; border: var(--border-hairline); border-radius: var(--radius-md); background: var(--color-surface); }
	.current[data-tier='critical'] { border-color: rgb(239 68 68 / 55%); }
	.current[data-tier='warning'], .current[data-tier='unknown'] { border-color: rgb(245 158 11 / 55%); }
	.current[data-tier='ok'] { border-color: rgb(34 197 94 / 45%); }
	.current .label { display: block; color: var(--color-muted); font-size: 11px; }
	.current strong { display: block; font-size: 12px; font-weight: 600; word-break: break-word; }
	.grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 12px; }
	.scenario { display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; border: var(--border-hairline); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-ink); text-align: left; cursor: pointer; font: inherit; }
	.scenario:hover, .scenario:focus-visible { border-color: var(--color-accent); outline: none; }
	.scenario strong { font-size: 12px; font-weight: 600; }
	.scenario span { color: var(--color-muted); font-size: 11px; line-height: 1.4; }
	.reset { width: 100%; padding: 9px 12px; border: var(--border-hairline); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-ink); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
	.reset:hover, .reset:focus-visible { border-color: var(--color-accent); outline: none; }
	@media (max-width: 640px) {
		.current { grid-template-columns: 1fr; }
		.grid { grid-template-columns: 1fr; }
	}
</style>
