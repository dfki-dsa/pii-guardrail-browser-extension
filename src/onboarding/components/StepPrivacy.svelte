<script lang="ts">
	import type { Readable } from 'svelte/store';
	import { AI_TRANSPARENCY_NOTICE } from '../../shared/project-links';

	let { localAiEnabled }: { localAiEnabled: Readable<boolean> } = $props();

	const guarantees = [
		{
			claim: 'Your data stays in the browser',
			detail:
				'Detection runs locally. The extension makes no network requests.',
		},
		{
			claim: 'No analytics, no accounts',
			detail: 'Uour usage is not tracked or reported. You do not require an account to use the extension.',
		},
		{
			claim: 'Only runs on chat pages',
			detail: 'It works only on supported chat assistants. Everywhere else, Privacy Guardrail stays inactive.',
		},
		{
			claim: 'You approve every replacement',
			detail:
				'You see what was found and pick what to replace before you paste the text.',
		},
	];
</script>

<ul class="guarantees">
	{#each guarantees as item (item.claim)}
		<li>
			<span class="tick" aria-hidden="true">
				<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M2.5 7.5 5.5 10.5 11.5 3.5" />
				</svg>
			</span>
			<div>
				<p class="claim">{item.claim}</p>
				<p class="detail">{item.detail}</p>
			</div>
		</li>
	{/each}
</ul>

<div class="limits" role="note">
	<p>{AI_TRANSPARENCY_NOTICE}</p>
</div>

{#if !$localAiEnabled}
	<p class="notice" role="status">
		Local AI is off, so only structured values like card numbers and email addresses get found.
		Names and addresses will be missed.
	</p>
{/if}

<style>
	.guarantees {
		display: flex;
		flex-direction: column;
		gap: 16px;
		margin: 0 0 22px;
		padding: 0;
		list-style: none;
	}
	.guarantees li {
		display: flex;
		gap: 12px;
		align-items: flex-start;
	}
	.tick {
		flex-shrink: 0;
		width: 20px;
		height: 20px;
		margin-top: 1px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: rgb(34 197 94 / 14%);
		color: #15803d;
	}
	.tick svg {
		width: 12px;
		height: 12px;
	}
	.claim {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
		line-height: 1.45;
		color: var(--color-ink);
	}
	.detail {
		margin: 4px 0 0;
		font-size: 13px;
		line-height: 1.55;
		color: var(--color-muted);
	}
	.limits {
		padding: 14px 16px;
		border: 1px solid rgb(245 158 11 / 40%);
		border-radius: var(--radius-md);
		background: rgb(245 158 11 / 10%);
		color: #92400e;
	}
	.limits p {
		margin: 0 0 8px;
		font-size: 13px;
		line-height: 1.55;
	}
	.limits p:last-child {
		margin-bottom: 0;
	}
	.notice {
		margin: 16px 0 0;
		padding: 12px 14px;
		border-radius: var(--radius-md);
		background: var(--color-accent-soft);
		color: #1e3a8a;
		font-size: 13px;
		line-height: 1.55;
	}
</style>
