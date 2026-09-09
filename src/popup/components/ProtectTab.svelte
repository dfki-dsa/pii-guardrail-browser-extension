<script lang="ts">
	import type {
		CategoriesModel,
		OnboardingPromptModel,
		ProtectionModel,
		VaultModel
	} from '../popup-model.svelte';
	import CategoryChipsCard from './CategoryChipsCard.svelte';
	import FirstRunCard from './FirstRunCard.svelte';
	import IdentityVaultCard from './IdentityVaultCard.svelte';
	import LegalCard from './LegalCard.svelte';
	import MaintenanceCard from './MaintenanceCard.svelte';
	import ProtectionStatusCard from './ProtectionStatusCard.svelte';

	let {
		protection,
		categories,
		vault,
		onboarding,
		openPrivacyPolicy,
		openTermsOfUse,
		openImpressum
	}: {
		protection: ProtectionModel;
		categories: CategoriesModel;
		vault: VaultModel;
		onboarding: OnboardingPromptModel;
		openPrivacyPolicy: () => void;
		openTermsOfUse: () => void;
		openImpressum: () => void;
	} = $props();
</script>

<div class="protect-stack">
	<FirstRunCard
		visible={onboarding.visible}
		openOnboarding={onboarding.open}
		dismiss={onboarding.dismiss}
	/>
	<ProtectionStatusCard
		enabled={protection.enabled}
		wasmStatus={protection.wasmStatus}
		nerStatus={protection.nerStatus}
		cpuFallback={protection.cpuFallback}
		resourceSummary={protection.resourceSummary}
	/>
	<CategoryChipsCard
		categories={categories.categories}
		enabledCount={categories.enabledCount}
		toggleCategory={categories.toggleCategory}
	/>
	<IdentityVaultCard
		memoryEnabled={vault.memoryEnabled}
		consistentReplacementMode={vault.consistentReplacementMode}
		mappingCount={vault.mappingCount}
		setMemoryEnabled={vault.setMemoryEnabled}
		setReplacementMode={vault.setReplacementMode}
		openVaultOptions={vault.openVaultOptions}
	/>
	<MaintenanceCard restoreDefaults={categories.restoreDefaults} clearMappings={vault.clearMappings} />
	<LegalCard {openPrivacyPolicy} {openTermsOfUse} {openImpressum} />
</div>

<style>
	.protect-stack {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
</style>
