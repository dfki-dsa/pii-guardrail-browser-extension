<script lang="ts">
	import type { Writable } from 'svelte/store';
	import type { BlocklistEntry, EntityType, Settings } from '../../shared/message-types';
	import { ENTITY_TYPES } from '../../shared/message-types';
	import CardHeading from '../../popup/components/CardHeading.svelte';

	let {
		settings,
		error,
		addEntry,
		removeEntry,
		updateCategory,
		clearError,
	}: {
		settings: Writable<Settings | null>;
		error: Writable<string | null>;
		addEntry: (pattern: string, scope: EntityType) => Promise<boolean>;
		removeEntry: (index: number) => Promise<void>;
		updateCategory: (index: number, scope: EntityType) => Promise<void>;
		clearError: () => void;
	} = $props();

	let inputValue = $state('');
	let category = $state<EntityType>('MISC');
	let entries = $derived($settings?.blocklist ?? []);

	async function handleSubmit(event: Event) {
		event.preventDefault();
		const ok = await addEntry(inputValue, category);
		if (ok) {
			inputValue = '';
			category = 'MISC';
		}
	}

	function formatDate(ts: number): string {
		return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	}

	function entryScopeAsCategory(entry: BlocklistEntry): EntityType {
		return entry.scope === 'any' ? 'MISC' : entry.scope;
	}
</script>

<article class="card" id="blocklist-section">
	<CardHeading title="Blocklist" hint="Always flag these strings" />

	<div class="body">
		<form class="add-form" autocomplete="off" onsubmit={handleSubmit}>
			<input
				type="text"
				class="input"
				placeholder="Pattern (e.g. Project Bluebird)"
				aria-label="Blocklist pattern"
				aria-invalid={$error !== null}
				bind:value={inputValue}
				oninput={() => clearError()}
			/>
			<select class="select" aria-label="Category" bind:value={category}>
				{#each ENTITY_TYPES as et (et)}
					<option value={et}>{et === 'MISC' ? 'MISC (default)' : et}</option>
				{/each}
			</select>
			<button type="submit" class="add-btn">Add</button>
		</form>

		{#if $error}
			<p class="error" role="alert">{$error}</p>
		{/if}

		{#if entries.length === 0}
			<p class="empty">No entries yet.</p>
		{:else}
			<table class="list-table" aria-label="Blocklist entries">
				<thead>
					<tr>
						<th>Pattern</th>
						<th>Category</th>
						<th>Added</th>
						<th>Source</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each entries as entry, i (i + ':' + entry.pattern)}
						<tr>
							<td class="cell-pattern">{entry.pattern}</td>
							<td class="cell-category">
								<select
									aria-label={`Category for ${entry.pattern}`}
									value={entryScopeAsCategory(entry)}
									onchange={(event) => updateCategory(i, event.currentTarget.value as EntityType)}
								>
									{#each ENTITY_TYPES as et (et)}
										<option value={et}>{et}</option>
									{/each}
								</select>
							</td>
							<td class="cell-meta">{formatDate(entry.addedAt)}</td>
							<td class="cell-meta">{entry.source}</td>
							<td class="cell-action">
								<button
									type="button"
									class="delete-btn"
									aria-label={`Remove ${entry.pattern}`}
									onclick={() => removeEntry(i)}
								>×</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</article>

<style>
	.card { margin-bottom: 12px; overflow: hidden; border: var(--border-hairline); border-radius: var(--radius-lg); background: var(--color-card); }
	.body { display: flex; flex-direction: column; gap: 10px; padding: 14px; }
	.add-form { display: flex; gap: 8px; }
	.input {
		flex: 1;
		padding: 8px 12px;
		border: var(--border-hairline);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-ink);
		font-size: 13px;
		outline: none;
	}
	.input:focus { border-color: var(--color-accent); }
	.input[aria-invalid="true"] { border-color: var(--color-danger); }
	.input::placeholder { color: var(--color-subtle); }
	.select {
		padding: 8px 10px;
		border: var(--border-hairline);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-ink);
		font-size: 13px;
		cursor: pointer;
		white-space: nowrap;
	}
	.add-btn {
		padding: 8px 16px;
		border: 0;
		border-radius: var(--radius-md);
		background: var(--color-accent);
		color: white;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
	}
	.add-btn:hover { background: #1e40af; }
	.error { margin: 0; color: var(--color-danger); font-size: 12px; }
	.empty { margin: 0; color: var(--color-subtle); font-size: 13px; font-style: italic; }

	.list-table { width: 100%; border-collapse: collapse; font-size: 13px; }
	.list-table thead th {
		padding: 0 8px 8px;
		text-align: left;
		border-bottom: 1px solid var(--color-border);
		color: var(--color-muted);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.list-table thead th:last-child { width: 36px; }
	.list-table tbody tr { border-bottom: 1px solid var(--color-border); }
	.list-table tbody tr:last-child { border-bottom: none; }
	.cell-pattern { padding: 9px 8px; color: var(--color-ink); font-family: var(--font-mono); font-size: 12px; }
	.cell-category select {
		padding: 4px 8px;
		border: var(--border-hairline);
		border-radius: 6px;
		background: var(--color-surface);
		color: var(--color-ink);
		font-size: 12px;
		cursor: pointer;
	}
	.cell-meta { padding: 9px 8px; color: var(--color-muted); font-size: 12px; white-space: nowrap; }
	.cell-action { padding: 4px 4px 4px 8px; text-align: right; }
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
</style>
