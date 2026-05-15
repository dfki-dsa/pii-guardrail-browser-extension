<script lang="ts">
	import { PUBLIC_PROJECT_LINKS, SECURITY_SUPPORT_EMAIL } from '../../shared/project-links';
	import CardHeading from '../../popup/components/CardHeading.svelte';
</script>

<article class="card" id="support-section">
	<CardHeading title="Privacy and support" hint="Public beta links" />
	<div class="links">
		<a href={PUBLIC_PROJECT_LINKS.newIssue} target="_blank" rel="noopener noreferrer">Report issue</a>
		<a href={PUBLIC_PROJECT_LINKS.security} target="_blank" rel="noopener noreferrer">Report security/privacy issue</a>
		<a href={PUBLIC_PROJECT_LINKS.support} target="_blank" rel="noopener noreferrer">Privacy/support</a>
	</div>
	<p class="hint">
		For sensitive reports, use the private instructions in SECURITY.md. The contact is
		<code>{SECURITY_SUPPORT_EMAIL}</code>.
	</p>
</article>

<style>
	.card { margin-bottom: 12px; overflow: hidden; border: var(--border-hairline); border-radius: var(--radius-lg); background: var(--color-card); }
	.links { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding: 14px 14px 10px; }
	a {
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
