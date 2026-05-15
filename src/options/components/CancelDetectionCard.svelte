<script lang="ts">
	import type { Writable } from 'svelte/store';
	import type { CancelDetectionBehavior, Settings } from '../../shared/message-types';
	import CardHeading from '../../popup/components/CardHeading.svelte';

	let {
		settings,
		setValue,
	}: {
		settings: Writable<Settings | null>;
		setValue: (value: CancelDetectionBehavior) => Promise<void>;
	} = $props();

	let value = $derived<CancelDetectionBehavior>($settings?.cancelDetectionBehavior ?? 'ask');
</script>

<article class="card" id="cancel-detection-section">
	<CardHeading title="Paste scan cancellation" hint="Canceled paste behavior" />
	<div class="row">
		<div class="info">
			<span class="row-label">When canceling a scan</span>
			<p class="hint">
				Choose what Privacy Guardrail does with the pending paste after you explicitly cancel a running scan.
				“Paste without checking” bypasses personal-data detection for that paste.
			</p>
		</div>
		<select
			aria-label="When canceling a scan"
			value={value}
			onchange={(event) => setValue(event.currentTarget.value as CancelDetectionBehavior)}
		>
			<option value="ask">Ask every time</option>
			<option value="paste-original">Paste without checking</option>
			<option value="drop">Don’t paste</option>
		</select>
	</div>
</article>

<style>
	.card { margin-bottom: 12px; overflow: hidden; border: var(--border-hairline); border-radius: var(--radius-lg); background: var(--color-card); }
	.row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 14px; }
	.info { flex: 1; }
	.row-label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 4px; }
	.hint { margin: 0; color: var(--color-muted); font-size: 12px; line-height: 1.5; }
	select {
		padding: 8px 10px;
		border: var(--border-hairline);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-ink);
		font-size: 13px;
		cursor: pointer;
	}
</style>
