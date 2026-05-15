<script lang="ts" generics="T extends string">
	type Option = { value: T; label: string };
	let {
		options,
		value,
		onchange,
		ariaLabel,
	}: {
		options: Option[];
		value: T;
		onchange: (next: T) => void;
		ariaLabel?: string;
	} = $props();
</script>

<div class="segmented" role="radiogroup" aria-label={ariaLabel}>
	{#each options as option (option.value)}
		<button
			type="button"
			role="radio"
			aria-checked={value === option.value}
			class:active={value === option.value}
			onclick={() => onchange(option.value)}
		>
			{option.label}
		</button>
	{/each}
</div>

<style>
	.segmented {
		display: inline-flex;
		padding: 2px;
		border-radius: 6px;
		background: #f1f5f9;
	}
	.segmented button {
		padding: 4px 10px;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: var(--color-muted);
		font-size: 11px;
		font-weight: 500;
		cursor: pointer;
	}
	.segmented button.active {
		background: white;
		color: var(--color-ink);
		box-shadow: 0 1px 2px rgb(0 0 0 / 8%);
	}
</style>
