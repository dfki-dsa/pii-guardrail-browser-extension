<script lang="ts">
	import type { CategoriesModel, ProtectionModel, VaultModel } from '../popup-model.svelte';
	import CategoryChipsCard from './CategoryChipsCard.svelte';
	import IdentityVaultCard from './IdentityVaultCard.svelte';
	import MaintenanceCard from './MaintenanceCard.svelte';
	import ProtectionStatusCard from './ProtectionStatusCard.svelte';

	let {
		protection,
		categories,
		vault
	}: { protection: ProtectionModel; categories: CategoriesModel; vault: VaultModel } = $props();
</script>

<div class="protect-stack">
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
</div>

<style>
	.protect-stack {
		display: grid;
		gap: 0;
	}
</style>
