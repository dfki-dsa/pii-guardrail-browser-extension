<script lang="ts">
	import { onMount } from 'svelte';
	import DFKILogo from '../popup/components/DFKILogo.svelte';
	import PGLogo from '../popup/components/PGLogo.svelte';
	import { createOptionsModel } from './options-model.svelte';
	import AllowlistCard from './components/AllowlistCard.svelte';
	import BlocklistCard from './components/BlocklistCard.svelte';
	import CancelDetectionCard from './components/CancelDetectionCard.svelte';
	import CodeBlocksCard from './components/CodeBlocksCard.svelte';
	import DebugSystemCheckCard from './components/DebugSystemCheckCard.svelte';
	import OnboardingOverlay from './components/OnboardingOverlay.svelte';
	import PublicSupportCard from './components/PublicSupportCard.svelte';
	import SensitivityCard from './components/SensitivityCard.svelte';
	import SystemCompatibilityCard from './components/SystemCompatibilityCard.svelte';
	import VaultCard from './components/VaultCard.svelte';
	import { hasSeenOnboarding, markOnboardingSeen } from '../shared/onboarding-state';

	const model = createOptionsModel();
	let allowlistCard: AllowlistCard | undefined = $state();
	let showOnboarding = $state(false);

	onMount(async () => {
		const params = new URLSearchParams(window.location.search);
		const prefill = params.get('allowlist');
		if (prefill) {
			queueMicrotask(() => {
				allowlistCard?.prefill(prefill);
				document.getElementById('allowlist-section')?.scrollIntoView({ behavior: 'smooth' });
			});
		}
		const hash = window.location.hash.replace(/^#/, '');
		if (hash) {
			requestAnimationFrame(() => {
				document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
			});
		}
		const seen = await hasSeenOnboarding();
		if (!seen) showOnboarding = true;
	});

	async function dismissOnboarding() {
		showOnboarding = false;
		await markOnboardingSeen();
	}

	function reopenOnboarding() {
		showOnboarding = true;
	}
</script>

{#if showOnboarding}
	<OnboardingOverlay onDismiss={dismissOnboarding} />
{/if}

<div class="page">
	<header class="page-header">
		<div class="brand-row">
			<div class="logo-box"><PGLogo size={24} /></div>
			<div class="brand-copy">
				<h1>Privacy Guardrail <span class="beta-badge" title="Public beta — features may change">BETA</span></h1>
				<p>Extension Settings</p>
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
		<SystemCompatibilityCard
			settings={model.settings}
			status={model.systemCompatibility}
			warmupState={model.localAiWarmupState}
			setLocalAiDetection={model.setLocalAiDetection}
			retryLocalAi={model.retryLocalAi}
			rerunSystemCheck={model.rerunSystemCheck}
			setNerModelChoice={model.setNerModelChoice}
			setLocalAiUnloadTimeoutMs={model.setLocalAiUnloadTimeoutMs}
			setKeepLocalAiLoadedWhileActive={model.setKeepLocalAiLoadedWhileActive}
			setAutoWarmLocalAiOnActiveSupportedPage={model.setAutoWarmLocalAiOnActiveSupportedPage}
		/>

		<SensitivityCard
			settings={model.settings}
			groupNames={model.groupNames}
			setSensitivityMode={model.setSensitivityMode}
			setGlobalThreshold={model.setGlobalThreshold}
			setGroupThreshold={model.setGroupThreshold}
		/>

		<AllowlistCard
			bind:this={allowlistCard}
			settings={model.settings}
			error={model.allowlistError}
			addEntry={model.addAllowlistEntry}
			removeEntry={model.removeAllowlistEntry}
			clearError={model.clearAllowlistError}
		/>

		<BlocklistCard
			settings={model.settings}
			error={model.blocklistError}
			addEntry={model.addBlocklistEntry}
			removeEntry={model.removeBlocklistEntry}
			updateCategory={model.updateBlocklistCategory}
			clearError={model.clearBlocklistError}
		/>

		<VaultCard
			settings={model.settings}
			records={model.vaultRecords}
			setVaultEnabled={model.setVaultEnabled}
			setDefaultReplacementMode={model.setDefaultReplacementMode}
			updateRecord={model.updateVaultRecord}
			deleteRecord={model.deleteVaultRecord}
			exportVault={model.exportVault}
			importVault={model.importVault}
			clearUnpinned={model.clearUnpinned}
		/>

		<CancelDetectionCard settings={model.settings} setValue={model.setCancelDetectionBehavior} />

		<CodeBlocksCard settings={model.settings} setValue={model.setSkipCodeBlocks} />

		<PublicSupportCard />

		<DebugSystemCheckCard
			settings={model.settings}
			status={model.systemCompatibility}
			setDebug={model.setDebug}
			applyScenario={model.applyDebugSystemCheckScenario}
			clearOverride={model.clearDebugSystemCheck}
		/>
	</main>

	<footer class="page-footer">
		<button type="button" class="onboarding-link" onclick={reopenOnboarding}>
			Onboarding guide
		</button>
	</footer>
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

	.page-footer {
		padding: 12px 24px;
		text-align: center;
		border-top: var(--border-hairline);
		margin-top: 8px;
	}
	.onboarding-link {
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--color-muted);
		font-size: 12px;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.onboarding-link:hover {
		color: var(--color-accent);
	}
</style>
