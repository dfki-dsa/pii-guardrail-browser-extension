<script lang="ts">
	import { packagedTermsUrl, PUBLIC_PROJECT_LINKS, SECURITY_SUPPORT_EMAIL, TERMS_PUBLISHED } from '../../shared/project-links';
	import CardHeading from '../../popup/components/CardHeading.svelte';

	const termsUrl = packagedTermsUrl();
</script>

<article class="card" id="support-section">
	<CardHeading title="Privacy and support" hint="Public beta links" />
	<div class="links">
		<a href={PUBLIC_PROJECT_LINKS.newIssue} target="_blank" rel="noopener noreferrer">Report issue</a>
		<a href={PUBLIC_PROJECT_LINKS.security} target="_blank" rel="noopener noreferrer">Report security/privacy issue</a>
		<a href={PUBLIC_PROJECT_LINKS.support} target="_blank" rel="noopener noreferrer">Support</a>
	</div>
	<p class="group-label">Legal</p>
	<div class="links">
		<a href={PUBLIC_PROJECT_LINKS.privacy} target="_blank" rel="noopener noreferrer">Privacy Policy</a>
		<a href={PUBLIC_PROJECT_LINKS.impressum} target="_blank" rel="noopener noreferrer">Impressum</a>
		{#if TERMS_PUBLISHED}
			<a href={termsUrl} target="_blank" rel="noopener noreferrer">Terms of Use</a>
		{:else}
			<span class="link-pending" aria-disabled="true" title="Terms of Use will be published soon.">Terms of Use (soon)</span>
		{/if}
	</div>
	<p class="hint">
		For sensitive reports, use the private instructions in SECURITY.md. The contact is
		<code>{SECURITY_SUPPORT_EMAIL}</code>.
	</p>
</article>

<style>
	.card { margin-bottom: 12px; overflow: hidden; border: var(--border-hairline); border-radius: var(--radius-lg); background: var(--color-card); }
	.links { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding: 14px 14px 10px; }
	.group-label { margin: 0; padding: 4px 14px 0; color: var(--color-muted); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; }
	a, .link-pending {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 34px;
		padding: 6px 8px;
		border: var(--border-hairline);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-accent);
		font-size: 12px;
		font-weight: 600;
		text-align: center;
		text-decoration: none;
	}
	a:hover, a:focus-visible {
		border-color: var(--color-accent);
		outline: none;
	}
	.link-pending {
		color: var(--color-muted);
		background: var(--color-card);
		border-style: dashed;
		cursor: default;
	}
	.hint { margin: 0; padding: 0 14px 14px; color: var(--color-muted); font-size: 12px; line-height: 1.5; }
	code {
		padding: 1px 5px;
		border-radius: 3px;
		background: var(--color-surface);
		color: var(--color-ink);
		font-family: var(--font-mono);
		font-size: 11px;
	}
	@media (max-width: 640px) {
		.links { grid-template-columns: 1fr; }
	}
</style>
