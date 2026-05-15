<script lang="ts">
	let { title, badge, hint }: { eyebrow?: string; title: string; badge?: string | number; hint?: string; badgeClass?: string; compact?: boolean } = $props();
</script>

<div class="card-head">
	<span class="card-title">{title}</span>
	{#if badge !== undefined}
		<span class="count">{badge}</span>
	{:else if hint}
		<span class="card-hint">{hint}</span>
	{/if}
</div>

<style>
	.card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 11px 12px;
		border-bottom: 1px solid var(--color-border);
	}
	.card-title {
		color: var(--color-ink);
		font-size: 12px;
		font-weight: 600;
	}
	.count {
		color: var(--color-muted);
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 600;
	}
	.card-hint {
		color: var(--color-subtle);
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.5px;
		text-transform: uppercase;
	}
</style>
