<script lang="ts">
	import type { Readable } from 'svelte/store';
	import Toggle from '../../popup/components/Toggle.svelte';
	import { RUNTIME_FACTS } from '../../shared/onboarding-facts';

	let {
		localAiEnabled,
		setLocalAiEnabled,
	}: {
		localAiEnabled: Readable<boolean>;
		setLocalAiEnabled: (enabled: boolean) => Promise<void>;
	} = $props();
</script>

<ol class="timeline">
	<li>
		<span class="marker">1</span>
		<div>
			<p class="step-title">First paste: loading</p>
			<p class="step-detail">
				The model loads into memory. That takes a few seconds, and it happens once rather than on
				every paste.
			</p>
		</div>
	</li>
	<li>
		<span class="marker">2</span>
		<div>
			<p class="step-title">While you work: quick</p>
			<p class="step-detail">
				The model stays loaded, so detection happens in about a second. It uses roughly
				{RUNTIME_FACTS.loadedRamGb} GB of memory while it is there.
			</p>
		</div>
	</li>
	<li>
		<span class="marker">3</span>
		<div>
			<p class="step-title">After {RUNTIME_FACTS.defaultUnloadMinutes} minutes of inactivity: released</p>
			<p class="step-detail">
				To free up resources, the model is automatically unloaded after {RUNTIME_FACTS.defaultUnloadMinutes} minutes of inactivity. 
				The next paste will reload it. You can change the timeout or keep the model loaded for your entire session in the Settings.
			</p>
		</div>
	</li>
</ol>

<div class="choice">
	<div class="choice-copy">
		<p class="choice-label">Use the AI model</p>
		<p class="choice-detail">
			{$localAiEnabled
				? 'The AI model is enabled by default. It detects contextual personal information, alongside pattern-based data.'
				: 'Pattern-based detection will continue to work, and you can re-enable the AI model at any time.'}
		</p>
		<p class="choice-detail">You can turn it on/off anytime through settings.</p>
	</div>
	<Toggle
		size="sm"
		checked={$localAiEnabled}
		label="Use the AI model"
		onchange={(checked) => void setLocalAiEnabled(checked)}
	/>
</div>

<style>
	.timeline {
		display: flex;
		flex-direction: column;
		gap: 16px;
		margin: 0 0 22px;
		padding: 0;
		list-style: none;
		counter-reset: step;
	}
	.timeline li {
		display: flex;
		gap: 12px;
		align-items: flex-start;
	}
	.marker {
		flex-shrink: 0;
		width: 22px;
		height: 22px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: var(--color-accent-soft);
		color: var(--color-accent);
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 600;
	}
	.step-title {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
		line-height: 1.4;
		color: var(--color-ink);
	}
	.step-detail {
		margin: 4px 0 0;
		font-size: 13px;
		line-height: 1.55;
		color: var(--color-muted);
	}
	.choice {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 14px 16px;
		border: var(--border-hairline);
		border-radius: var(--radius-md);
		background: var(--color-card);
	}
	.choice-label {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
		color: var(--color-ink);
	}
	.choice-detail {
		margin: 3px 0 0;
		font-size: 13px;
		line-height: 1.5;
		color: var(--color-muted);
	}
</style>
