<script lang="ts">
	import { PACKAGE_ROWS, TOTAL_DOWNLOAD_MB } from '../../shared/onboarding-facts';

	const largest = PACKAGE_ROWS[0].mb; // rows are ordered largest first; the test pins it
</script>

<p class="lede">
	Privacy Guardrail uses approximately <strong>{TOTAL_DOWNLOAD_MB} MB</strong> of disk space.
</p>

<p class="body">
	What's included
</p>

<ul class="breakdown">
	{#each PACKAGE_ROWS as row (row.label)}
		<li>
			<div class="row-head">
				<span class="row-label">{row.label}</span>
				<span class="row-size">{row.mb} MB</span>
			</div>
			<div
				class="bar"
				role="presentation"
				style="--fill: {Math.max((row.mb / largest) * 100, 1.5)}%"
			></div>
			<p class="row-reason">{row.reason}</p>
		</li>
	{/each}
</ul>

<style>
	.lede {
		margin: 0 0 14px;
		font-size: 17px;
		line-height: 1.5;
		color: var(--color-ink);
	}
	.lede strong {
		font-weight: 600;
	}
	.body {
		margin: 0 0 22px;
		font-size: 14px;
		line-height: 1.6;
		color: var(--color-muted);
	}
	.breakdown {
		display: flex;
		flex-direction: column;
		gap: 18px;
		margin: 0 0 22px;
		padding: 0;
		list-style: none;
	}
	.row-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 6px;
	}
	.row-label {
		font-size: 14px;
		font-weight: 600;
		color: var(--color-ink);
	}
	.row-size {
		font-family: var(--font-mono);
		font-size: 13px;
		font-weight: 600;
		color: var(--color-accent);
	}
	.bar {
		height: 6px;
		border-radius: var(--radius-pill);
		background: var(--color-border-strong);
		overflow: hidden;
	}
	.bar::after {
		content: '';
		display: block;
		width: var(--fill);
		height: 100%;
		border-radius: var(--radius-pill);
		background: var(--color-accent);
	}
	.row-reason {
		margin: 8px 0 0;
		font-size: 13px;
		line-height: 1.55;
		color: var(--color-muted);
	}
</style>
