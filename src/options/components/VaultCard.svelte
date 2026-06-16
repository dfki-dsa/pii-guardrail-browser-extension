<script lang="ts">
	import type { Writable } from 'svelte/store';
	import type { ReplacementModeSetting, Settings } from '../../shared/message-types';
	import type { IdentityRecord } from '../../shared/identity-vault';
	import { supportsSynthetic } from '../../shared/synthetic-pool';
	import CardHeading from '../../popup/components/CardHeading.svelte';
	import Segmented from '../../popup/components/Segmented.svelte';
	import Toggle from '../../popup/components/Toggle.svelte';

	let {
		settings,
		records,
		setVaultEnabled,
		setDefaultReplacementMode,
		updateRecord,
		deleteRecord,
		exportVault,
		importVault,
		clearUnpinned,
	}: {
		settings: Writable<Settings | null>;
		records: Writable<IdentityRecord[]>;
		setVaultEnabled: (enabled: boolean) => Promise<void>;
		setDefaultReplacementMode: (mode: ReplacementModeSetting) => Promise<void>;
		updateRecord: (
			id: string,
			patch: Partial<Pick<IdentityRecord, 'replacementMode' | 'syntheticValue' | 'pinned' | 'notes' | 'entityType'>>,
		) => Promise<void>;
		deleteRecord: (id: string) => Promise<void>;
		exportVault: () => void;
		importVault: (file: File) => Promise<{ imported: number } | { error: string }>;
		clearUnpinned: () => Promise<number>;
	} = $props();

	let vaultEnabled = $derived($settings?.identityVaultEnabled ?? true);
	let defaultMode = $derived<ReplacementModeSetting>($settings?.defaultReplacementMode ?? 'placeholder');
	let fileInput: HTMLInputElement | null = $state(null);

	function formatRelative(ts: number): string {
		const diff = Date.now() - ts;
		if (diff < 60_000) return 'just now';
		if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
		if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
		const days = Math.floor(diff / 86_400_000);
		if (days < 30) return `${days}d ago`;
		return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	}

	async function onSyntheticChange(record: IdentityRecord, value: string) {
		const trimmed = value.trim();
		if (!trimmed) {
			await updateRecord(record.id, { replacementMode: 'placeholder', syntheticValue: '' });
		} else {
			await updateRecord(record.id, { syntheticValue: trimmed });
		}
	}

	async function onModeChange(record: IdentityRecord, mode: ReplacementModeSetting) {
		await updateRecord(record.id, { replacementMode: mode });
	}

	async function onImportChange(event: Event) {
		const target = event.currentTarget as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;
		const result = await importVault(file);
		target.value = '';
		if ('error' in result) alert(result.error);
		else alert(`Imported ${result.imported} record(s).`);
	}

	async function onClearUnpinned() {
		const count = await new Promise<number>((resolve) => {
			const unpinned = $records.filter((r) => !r.pinned).length;
			if (unpinned === 0) {
				alert('No unpinned records to clear.');
				resolve(0);
				return;
			}
			if (!confirm(`Remove ${unpinned} unpinned record(s)? This cannot be undone.`)) {
				resolve(0);
				return;
			}
			resolve(-1);
		});
		if (count === -1) await clearUnpinned();
	}
</script>

<article class="card" id="vault-section">
	<CardHeading title="Identity vault" hint="Cross-session, cross-provider mappings" />

	<div class="body">
		<p class="intro">
			Each detected identity is stored once in <code>chrome.storage.local</code> and
			reused consistently across sessions and pages — so the same person always maps to
			the same placeholder or synthetic value. This data lives only on this device and is
			never sent to any external service. When the vault is off, replacements reset each
			session and the same name may get a different placeholder each time.
		</p>
		<p class="intro">
			Toggle <em>Synthetic</em> mode to replace placeholders like <code>[PERSON_1]</code>
			with realistic but clearly-invented values such as <code>Jordan Park</code>, which
			often improves LLM response quality. Pin a record to lock its replacement against
			automatic changes.
		</p>

		<div class="controls">
			<div class="row">
				<span class="row-label">Enable cross-session vault</span>
				<Toggle size="sm" checked={vaultEnabled} label="Enable cross-session vault" onchange={(checked) => setVaultEnabled(checked)} />
			</div>
			<div class="row">
				<span class="row-label">Default mode</span>
				<Segmented
					ariaLabel="Default replacement mode"
					value={defaultMode}
					options={[{ value: 'placeholder', label: 'Placeholder' }, { value: 'synthetic', label: 'Synthetic' }]}
					onchange={(mode) => setDefaultReplacementMode(mode)}
				/>
			</div>
		</div>

		{#if $records.length === 0}
			<p class="empty">The vault is empty. Records will appear here as you confirm replacements.</p>
		{:else}
			<div class="table-wrap">
				<table class="vault-table" aria-label="Identity vault entries">
					<thead>
						<tr>
							<th>Original</th>
							<th>Type</th>
							<th>Replacement</th>
							<th>Mode</th>
							<th>Used</th>
							<th>Pin</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each $records as record (record.id)}
							{@const modeDisabled = !supportsSynthetic(record.entityType) || !record.syntheticValue}
							<tr>
								<td class="cell-original" title={record.originalText}>{record.originalText}</td>
								<td class="cell-meta">{record.entityType}</td>
								<td class="cell-replacement">
									{#if record.replacementMode === 'synthetic' && record.syntheticValue}
										<input
											type="text"
											class="synthetic-edit"
											value={record.syntheticValue}
											aria-label={`Synthetic replacement for ${record.originalText}`}
											onchange={(event) => onSyntheticChange(record, event.currentTarget.value)}
										/>
									{:else}
										{record.placeholder}
									{/if}
								</td>
								<td class="cell-mode">
									<select
										aria-label={`Replacement mode for ${record.originalText}`}
										value={modeDisabled ? 'placeholder' : record.replacementMode}
										disabled={modeDisabled}
										title={modeDisabled ? 'Synthetic mode is unavailable for this entity type' : undefined}
										onchange={(event) => onModeChange(record, event.currentTarget.value as ReplacementModeSetting)}
									>
										<option value="placeholder">Placeholder</option>
										<option value="synthetic">Synthetic</option>
									</select>
								</td>
								<td class="cell-meta">{record.usageCount}× · {formatRelative(record.lastSeenAt)}</td>
								<td class="cell-pin">
									<button
										type="button"
										class="pin-btn"
										class:pinned={record.pinned}
										title={record.pinned ? 'Pinned (click to unpin)' : 'Pin record'}
										aria-label={record.pinned ? 'Unpin record' : 'Pin record'}
										onclick={() => updateRecord(record.id, { pinned: !record.pinned })}
									>{record.pinned ? '📌' : '📍'}</button>
								</td>
								<td class="cell-action">
									<button
										type="button"
										class="delete-btn"
										aria-label={`Remove ${record.originalText}`}
										onclick={() => deleteRecord(record.id)}
									>×</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<div class="bulk">
			<button type="button" class="action-btn" onclick={exportVault}>Export JSON</button>
			<button type="button" class="action-btn" onclick={() => fileInput?.click()}>Import JSON</button>
			<input type="file" accept="application/json" hidden bind:this={fileInput} onchange={onImportChange} />
			<button type="button" class="action-btn danger" onclick={onClearUnpinned}>Clear unpinned</button>
		</div>
	</div>
</article>

<style>
	.card { margin-bottom: 12px; overflow: hidden; border: var(--border-hairline); border-radius: var(--radius-lg); background: var(--color-card); }
	.body { display: flex; flex-direction: column; gap: 12px; padding: 14px; }
	.intro { margin: 0; color: var(--color-muted); font-size: 13px; line-height: 1.5; }
	.intro code {
		padding: 1px 5px;
		border-radius: 3px;
		background: var(--color-surface);
		color: var(--color-ink);
		font-family: var(--font-mono);
		font-size: 12px;
	}
	.controls { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: var(--border-hairline); border-radius: var(--radius-md); background: var(--color-surface); }
	.row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
	.row-label { font-size: 13px; font-weight: 500; }
	.empty { margin: 0; color: var(--color-subtle); font-size: 13px; font-style: italic; }

	.table-wrap { max-width: 100%; overflow-x: auto; }
	.vault-table { width: 100%; min-width: 760px; border-collapse: collapse; table-layout: fixed; font-size: 12px; }
	.vault-table thead th {
		padding: 0 8px 8px;
		text-align: left;
		border-bottom: 1px solid var(--color-border);
		color: var(--color-muted);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.vault-table tbody tr { border-bottom: 1px solid var(--color-border); }
	.vault-table tbody tr:last-child { border-bottom: none; }
	.vault-table th:nth-child(1), .vault-table td:nth-child(1) { width: 22%; }
	.vault-table th:nth-child(2), .vault-table td:nth-child(2) { width: 11%; }
	.vault-table th:nth-child(3), .vault-table td:nth-child(3) { width: 22%; }
	.vault-table th:nth-child(4), .vault-table td:nth-child(4) { width: 16%; }
	.vault-table th:nth-child(5), .vault-table td:nth-child(5) { width: 15%; }
	.vault-table th:nth-child(6), .vault-table td:nth-child(6) { width: 60px; text-align: center; }
	.vault-table th:nth-child(7), .vault-table td:nth-child(7) { width: 40px; }

	.cell-original {
		padding: 9px 8px;
		color: var(--color-ink);
		font-family: var(--font-mono);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cell-replacement {
		padding: 9px 8px;
		color: var(--color-muted);
		font-family: var(--font-mono);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cell-meta { padding: 9px 8px; color: var(--color-muted); white-space: nowrap; }
	.cell-mode select {
		padding: 4px 6px;
		border: var(--border-hairline);
		border-radius: 4px;
		background: var(--color-surface);
		color: var(--color-ink);
		font-size: 12px;
		cursor: pointer;
	}
	.cell-mode select:disabled { opacity: 0.5; cursor: not-allowed; }
	.cell-pin { text-align: center; }
	.cell-action { padding: 4px 4px 4px 8px; text-align: right; }

	.synthetic-edit {
		width: 100%;
		padding: 4px 6px;
		border: var(--border-hairline);
		border-radius: 4px;
		background: var(--color-surface);
		color: var(--color-ink);
		font-family: inherit;
		font-size: 12px;
	}
	.synthetic-edit:focus { outline: none; border-color: var(--color-accent); background: white; }

	.pin-btn {
		padding: 2px 6px;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: var(--color-subtle);
		font-size: 14px;
		cursor: pointer;
	}
	.pin-btn:hover { color: var(--color-ink); background: var(--color-surface); }
	.pin-btn.pinned { color: #d97706; }

	.delete-btn {
		padding: 2px 6px;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: var(--color-subtle);
		font-size: 18px;
		line-height: 1;
		cursor: pointer;
	}
	.delete-btn:hover { color: var(--color-danger); background: rgb(239 68 68 / 8%); }

	.bulk { display: flex; gap: 8px; flex-wrap: wrap; }
	.action-btn {
		padding: 6px 14px;
		border: var(--border-hairline);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-ink);
		font-size: 12px;
		cursor: pointer;
	}
	.action-btn:hover { background: var(--color-accent-soft); border-color: var(--color-accent); }
	.action-btn.danger { color: #b91c1c; border-color: rgb(239 68 68 / 35%); }
	.action-btn.danger:hover { background: #fef2f2; border-color: var(--color-danger); }
</style>
