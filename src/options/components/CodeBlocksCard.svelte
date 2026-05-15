<script lang="ts">
	import type { Writable } from 'svelte/store';
	import type { Settings } from '../../shared/message-types';
	import CardHeading from '../../popup/components/CardHeading.svelte';
	import Toggle from '../../popup/components/Toggle.svelte';

	let {
		settings,
		setValue,
	}: {
		settings: Writable<Settings | null>;
		setValue: (value: boolean) => Promise<void>;
	} = $props();

	let value = $derived($settings?.skipCodeBlocks ?? false);
</script>

<article class="card" id="code-blocks-section">
	<CardHeading title="Code blocks" hint="Suppress detections inside code regions" />
	<div class="row">
		<div class="info">
			<span class="row-label">Skip code blocks</span>
			<p class="hint">
				When on, detections inside fenced markdown blocks and
				<code>&lt;code&gt;</code>/<code>&lt;pre&gt;</code> regions move to a
				collapsed disclosure in the overlay instead of appearing at the top level.
				Inline backticks are always scanned.
			</p>
		</div>
		<Toggle size="sm" checked={value} label="Skip code blocks" onchange={(checked) => setValue(checked)} />
	</div>
</article>

<style>
	.card { margin-bottom: 12px; overflow: hidden; border: var(--border-hairline); border-radius: var(--radius-lg); background: var(--color-card); }
	.row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 14px; }
	.info { flex: 1; }
	.row-label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 4px; }
	.hint { margin: 0; color: var(--color-muted); font-size: 12px; line-height: 1.5; }
	.hint code {
		padding: 1px 5px;
		border-radius: 3px;
		background: var(--color-surface);
		color: var(--color-ink);
		font-family: var(--font-mono);
		font-size: 11px;
	}
</style>
