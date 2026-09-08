<script lang="ts">
	import CardHeading from '../popup/components/CardHeading.svelte';
	import DFKILogo from '../popup/components/DFKILogo.svelte';
	import PGLogo from '../popup/components/PGLogo.svelte';
	import { createOnboardingModel, STEPS } from './onboarding-model.svelte';
	import StepPerformance from './components/StepPerformance.svelte';
	import StepPrivacy from './components/StepPrivacy.svelte';
	import StepSize from './components/StepSize.svelte';
	import StepVault from './components/StepVault.svelte';

	const model = createOnboardingModel();
</script>

<div class="page">
	<header class="page-header">
		<div class="brand-row">
			<div class="logo-box"><PGLogo size={24} /></div>
			<div class="brand-copy">
				<h1>Privacy Guardrail <span class="beta-badge" title="Public beta — features may change">BETA</span></h1>
				<p>Getting Started</p>
			</div>
			<a
				class="dfki-mark"
				href="https://www.dfki.de"
				target="_blank"
				rel="noopener noreferrer"
				aria-label="by DFKI"
				title="by DFKI"
			>
				<span class="dfki-by">by</span>
				<DFKILogo height={32} />
			</a>
		</div>
	</header>

	<main class="content">
		<article class="card" id="download-section">
			<CardHeading title={STEPS[0].question} hint={STEPS[0].label} />
			<div class="card-body"><StepSize /></div>
		</article>

		<article class="card" id="privacy-section">
			<CardHeading title={STEPS[1].question} hint={STEPS[1].label} />
			<div class="card-body"><StepPrivacy localAiEnabled={model.localAiEnabled} /></div>
		</article>

		<article class="card" id="vault-section">
			<CardHeading title={STEPS[2].question} hint={STEPS[2].label} />
			<div class="card-body">
				<StepVault
					vaultEnabled={model.vaultEnabled}
					setVaultEnabled={model.setVaultEnabled}
				/>
			</div>
		</article>

		<article class="card" id="performance-section">
			<CardHeading title={STEPS[3].question} hint={STEPS[3].label} />
			<div class="card-body">
				<StepPerformance
					localAiEnabled={model.localAiEnabled}
					setLocalAiEnabled={model.setLocalAiEnabled}
				/>
			</div>
		</article>

		<div class="actions">
			<button type="button" class="primary" onclick={() => void model.finish()}>Got it</button>
		</div>
	</main>
</div>

<style>
	:global(html), :global(body) {
		margin: 0;
		min-height: 100vh;
		background: var(--color-surface);
		color: var(--color-ink);
		font-family: var(--font-sans);
	}

	.page {
		max-width: 760px;
		margin: 0 auto;
		padding: 0 0 64px;
	}

	.page-header {
		margin: 0 -24px 24px;
		padding: 16px 24px;
		background: var(--color-header);
		color: white;
	}
	@media (min-width: 808px) {
		.page-header {
			margin-left: 0;
			margin-right: 0;
			padding-left: 20px;
			padding-right: 20px;
			border-radius: 0 0 var(--radius-lg) var(--radius-lg);
		}
	}

	.brand-row {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.logo-box {
		width: 36px;
		height: 36px;
		display: grid;
		place-items: center;
		border-radius: 8px;
		flex-shrink: 0;
	}
	.brand-copy { flex: 1; min-width: 0; }
	.brand-copy h1 {
		margin: 0;
		font-size: 20px;
		font-weight: 300;
		letter-spacing: -0.1px;
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.beta-badge {
		display: inline-block;
		padding: 2px 7px;
		border-radius: 999px;
		background: var(--color-glow, #f59e0b);
		color: #fff;
		text-shadow: 0 0 1px #000;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.6px;
		line-height: 1.4;
		text-transform: uppercase;
		vertical-align: middle;
	}
	.brand-copy p {
		margin: 2px 0 0;
		color: rgb(255 255 255 / 65%);
		font-size: 12px;
	}
	.dfki-mark {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: rgb(255 255 255 / 80%);
		text-decoration: none;
		flex-shrink: 0;
	}
	.dfki-mark:hover, .dfki-mark:focus-visible { color: white; outline: none; }
	.dfki-by {
		font-size: 10px;
		font-weight: 400;
		letter-spacing: 0.3px;
		color: rgb(255 255 255 / 60%);
		text-transform: lowercase;
	}

	.content { padding: 0 24px; }

	.card {
		margin-bottom: 12px;
		overflow: hidden;
		border: var(--border-hairline);
		border-radius: var(--radius-lg);
		background: var(--color-card);
	}
	.card-body { padding: 14px; }

	.actions {
		display: flex;
		gap: 8px;
		margin-top: 20px;
	}
	.actions button {
		padding: 9px 18px;
		border-radius: var(--radius-md);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
	}
	.primary {
		border: 0;
		background: var(--color-accent);
		color: white;
		font-weight: 600;
	}
	.primary:hover { background: #1e40af; }
	.actions button:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}
</style>
