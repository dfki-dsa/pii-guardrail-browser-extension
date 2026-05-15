<script lang="ts">
	let {
		checked = $bindable(false),
		label,
		onchange,
		size = 'md'
	}: { checked?: boolean; label: string; onchange?: (checked: boolean) => void; size?: 'md' | 'sm' } = $props();

	function toggle() {
		checked = !checked;
		onchange?.(checked);
	}
</script>

<button
	class={['toggle', size, checked && 'checked']}
	type="button"
	role="switch"
	aria-checked={checked}
	aria-label={label}
	onclick={toggle}
>
	<span></span>
</button>

<style>
	.toggle {
		box-sizing: border-box;
		flex: 0 0 var(--toggle-width);
		width: var(--toggle-width);
		height: var(--toggle-height);
		padding: 2px;
		border: 0;
		border-radius: var(--radius-pill);
		background: #334155;
		cursor: pointer;
		transition: background 140ms ease;
	}

	.toggle.sm {
		--toggle-width: 34px;
		--toggle-height: 20px;
		--toggle-knob: 16px;
	}

	.toggle span {
		display: block;
		width: var(--toggle-knob);
		height: var(--toggle-knob);
		border-radius: 50%;
		background: white;
		box-shadow: 0 1px 3px rgb(0 0 0 / 28%);
		transition: transform 140ms ease;
	}

	.toggle.checked {
		background: #2563eb;
	}

	.toggle.checked span {
		transform: translateX(calc(var(--toggle-width) - var(--toggle-knob) - 4px));
	}
</style>
