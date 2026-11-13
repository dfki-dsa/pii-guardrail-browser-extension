<script lang="ts">
	import type { Writable } from 'svelte/store';
	import type { CategoriesModel, ProtectionModel, VaultModel } from '../popup-model.svelte';
	import CategoryChipsCard from './CategoryChipsCard.svelte';
	import IdentityVaultCard from './IdentityVaultCard.svelte';
	import LegalCard from './LegalCard.svelte';
	import MaintenanceCard from './MaintenanceCard.svelte';
	import AutoModeCard from './AutoModeCard.svelte';
	import ProtectionStatusCard from './ProtectionStatusCard.svelte';

	let {
		protection,
		categories,
		vault,
		autoMode,
		setAutoMode,
		openPrivacyPolicy,
		openTermsOfUse,
		openImpressum
	}: {
		protection: ProtectionModel;
		categories: CategoriesModel;
		vault: VaultModel;
		autoMode: Writable<boolean>;
		setAutoMode: (enabled: boolean) => Promise<void>;
		openPrivacyPolicy: () => void;
		openTermsOfUse: () => void;
		openImpressum: () => void;
	} = $props();
</script>

<div class="protect-stack">
	<ProtectionStatusCard
		enabled={protection.enabled}
		wasmStatus={protection.wasmStatus}
		nerStatus={protection.nerStatus}
		cpuFallback={protection.cpuFallback}
		resourceSummary={protection.resourceSummary}
		composerMatch={protection.composerMatch}
	/>
	<AutoModeCard {autoMode} {setAutoMode} />
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
