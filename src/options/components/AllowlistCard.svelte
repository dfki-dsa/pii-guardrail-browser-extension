<script lang="ts">
	import type { Writable } from 'svelte/store';
	import type { AllowlistEntry, Settings } from '../../shared/message-types';
	import CardHeading from '../../popup/components/CardHeading.svelte';

	let {
		settings,
		error,
		addEntry,
		removeEntry,
		clearError,
	}: {
		settings: Writable<Settings | null>;
		error: Writable<string | null>;
		addEntry: (pattern: string) => Promise<boolean>;
		removeEntry: (index: number) => Promise<void>;
		clearError: () => void;
	} = $props();

	let inputValue = $state('');
	let inputEl: HTMLInputElement | null = $state(null);
	let entries = $derived($settings?.allowlist ?? []);

	export function prefill(value: string): void {
		inputValue = value;
		inputEl?.focus();
	}

	async function handleSubmit(event: Event) {
		event.preventDefault();
		const ok = await addEntry(inputValue);
		if (ok) inputValue = '';
	}

	function handleInput() {
		clearError();
	}

	function formatDate(ts: number): string {
		return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	}
</script>

<article class="card" id="allowlist-section">
	<CardHeading title="Allowlist" hint="Never flag these strings" />

	<div class="body">
		<form class="add-form" autocomplete="off" onsubmit={handleSubmit}>
			<input
				type="text"
				class="input"
				placeholder="Pattern (e.g. Smith, acme-*)"
				aria-label="Allowlist pattern"
				aria-invalid={$error !== null}
				bind:value={inputValue}
				bind:this={inputEl}
				oninput={handleInput}
			/>
			<button type="submit" class="add-btn">Add</button>
		</form>

		{#if $error}
			<p class="error" role="alert">{$error}</p>
		{/if}

		{#if entries.length === 0}
			<p class="empty">No entries yet.</p>
		{:else}
			<table class="list-table" aria-label="Allowlist entries">
				<thead>
					<tr>
						<th>Pattern</th>
						<th>Added</th>
						<th>Source</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each entries as entry, i (i + ':' + entry.pattern)}
						<tr>
							<td class="cell-pattern">{entry.pattern}</td>
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
		transition: border-color 120ms ease;
	}
	.input:focus { border-color: var(--color-accent); }
	.input[aria-invalid="true"] { border-color: var(--color-danger); }
	.input::placeholder { color: var(--color-subtle); }
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
		transition: color 120ms ease, background 120ms ease;
	}
	.delete-btn:hover { color: var(--color-danger); background: rgb(239 68 68 / 8%); }
</style>
