<script lang="ts">
	import type { Readable } from 'svelte/store';
	import Toggle from '../../popup/components/Toggle.svelte';

	let {
		vaultEnabled,
		setVaultEnabled,
	}: {
		vaultEnabled: Readable<boolean>;
		setVaultEnabled: (enabled: boolean) => Promise<void>;
	} = $props();
</script>

<p class="lede">
	The vault keeps replacements <strong>consistent</strong> across conversations.
</p>

<div class="example" aria-label="Example of consistent replacement">
	<div class="example-row">
		<span class="example-label">You paste</span>
		<code>Email <mark>Dana Reyes</mark> about the invoice</code>
	</div>
	<div class="example-arrow" aria-hidden="true">↓</div>
	<div class="example-row">
		<span class="example-label">Assistant sees</span>
		<code>Email <mark class="swap">[PERSON_1]</mark> about the invoice</code>
	</div>
	<p class="example-note">
		In a new chat, Dana Reyes is still mapped to [PERSON_1], so follow-up requests continue to have context. 
		If you prefer, you can replace placeholders with realistic names such as Jordan Park that 
		AI assistants may interpret more naturally.
	</p>
</div>

<div class="disclosure" role="note">
	<p>
		To convert <code class="inline">[PERSON_1]</code> back into Dana Reyes when the assistant generates a response, 
		the vault stores the original values locally on your device.
	</p>
	<p>
		The vault lives in your browser's local storage. It is never uploaded, synced to another device, or 
		linked to your account. However, anyone with access to your browser profile on this device could view its contents.
	</p>
</div>

<div class="controls-section">
  <p class="section-title">Stay in Control</p>

  <ul class="controls">
    <li>Inspect, edit or delete any entry in settings.</li>
    <li>Pin what you want to keep and clear the rest in one go.</li>
    <li>Turn the vault off. Replacement still works, just per conversation.</li>
  </ul>
</div>

<div class="choice">
	<div class="choice-copy">
		<p class="choice-label">Keep the vault on</p>
		<p class="choice-detail">
			{$vaultEnabled
				? 'Replacements stay the same across chats and sessions.'
				: 'Each conversation is handled on its own and nothing is kept.'}
		</p>
	</div>
	<Toggle
		size="sm"
		checked={$vaultEnabled}
		label="Keep the vault on"
		onchange={(checked) => void setVaultEnabled(checked)}
	/>
</div>

<style>
	.lede {
		margin: 0 0 20px;
		font-size: 17px;
		line-height: 1.5;
		color: var(--color-ink);
	}
	.lede strong {
		font-weight: 600;
	}
	.example {
		padding: 16px;
		margin-bottom: 20px;
		border: var(--border-hairline);
		border-radius: var(--radius-md);
		background: var(--color-card);
	}
	.example-row {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.example-label {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.4px;
		text-transform: uppercase;
		color: var(--color-subtle);
	}
	.example code {
		font-family: var(--font-mono);
		font-size: 13px;
		line-height: 1.6;
		color: var(--color-ink);
	}
	mark {
		padding: 1px 4px;
		border-radius: 4px;
		background: var(--color-group-identity-bg);
		color: var(--color-group-identity-fg);
		font-weight: 600;
	}
	mark.swap {
		background: var(--color-accent-soft);
		color: var(--color-accent);
	}
	.example-arrow {
		margin: 8px 0;
		color: var(--color-subtle);
		font-size: 14px;
	}
	.example-note {
		margin: 14px 0 0;
		padding-top: 12px;
		border-top: var(--border-hairline);
		font-size: 13px;
		line-height: 1.6;
		color: var(--color-muted);
	}
	.inline {
		padding: 1px 4px;
		border-radius: 4px;
		background: var(--color-border-strong);
		font-family: var(--font-mono);
		font-size: 12px;
	}
	.disclosure {
		padding: 14px 16px;
		margin-bottom: 20px;
		border: 1px solid rgb(245 158 11 / 40%);
		border-radius: var(--radius-md);
		background: rgb(245 158 11 / 10%);
		color: #92400e;
	}
	.disclosure p {
		margin: 0 0 8px;
		font-size: 13px;
		line-height: 1.55;
	}
	.disclosure p:last-child {
		margin-bottom: 0;
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
	.controls-section {
  		margin: 0 0 20px;
	}

	.section-title {
		margin: 0 0 10px;
		font-size: 15px;
		font-weight: 600;
		color: var(--color-ink);
	}

	.controls {
		margin: 0;
		padding-left: 20px; /* aligns bullets nicely under the heading */
		display: flex;
		flex-direction: column;
		gap: 8px;

		font-size: 13px;
		line-height: 1.55;
		color: var(--color-muted);
	}

	.controls li {
		padding-left: 2px;
	}
</style>
