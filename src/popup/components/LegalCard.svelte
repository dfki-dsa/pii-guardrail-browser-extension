<script lang="ts">
	import { LIMITS_DISCLAIMER } from '../../shared/project-links';

	let {
		openPrivacyPolicy,
		openTermsOfUse,
		openImpressum,
	}: {
		openPrivacyPolicy: () => void;
		openTermsOfUse: () => void;
		openImpressum: () => void;
	} = $props();
</script>

<article class="card">
	<div class="head"><span>Legal</span></div>
	<button type="button" class="link-row" onclick={openPrivacyPolicy}><span class="row-label">Privacy Policy</span><span class="right">›</span></button>
	<div class="divider"></div>
	<button type="button" class="link-row" onclick={openTermsOfUse}><span class="row-label">Terms of Use</span><span class="right">›</span></button>
	<div class="divider"></div>
	<button type="button" class="link-row" onclick={openImpressum}><span class="row-label">Impressum</span><span class="right">›</span></button>
	<p class="note">{LIMITS_DISCLAIMER}</p>
</article>

<style>
	.card { overflow: hidden; border: var(--border-hairline); border-radius: var(--radius-lg); background: white; }
	.head { display: flex; justify-content: space-between; padding: 11px 12px; border-bottom: 1px solid var(--color-border); }
	.head span { font-size: 12px; font-weight: 600; }
	.link-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; padding: 10px 12px; border: 0; background: transparent; color: var(--color-ink); cursor: pointer; }
	.row-label { font-size: 13px; font-weight: 500; }
	.right { display: flex; align-items: center; gap: 8px; color: var(--color-muted); }
	.divider { height: 1px; background: var(--color-border); }
	.note { margin: 0; padding: 10px 12px; border-top: 1px solid var(--color-border); color: var(--color-subtle); font-size: 11px; line-height: 1.4; }
</style>
