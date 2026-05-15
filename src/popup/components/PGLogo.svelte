<script lang="ts">
	let { size = 26, gradId = 'pg-logo' } = $props<{
		size?: number;
		gradId?: string;
	}>();

	let shieldId = $derived(`${gradId}-shield`);
	let raysId = $derived(`${gradId}-rays`);
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 432 549.837"
	class="pg-logo"
	role="img"
	aria-label="Privacy Guardrail"
>
	<defs>
		<linearGradient
			id={shieldId}
			x1="0"
			y1="0"
			x2="1"
			y2="0"
			gradientUnits="userSpaceOnUse"
			gradientTransform="matrix(432,-549.837,699.817,549.837,0,549.837)"
		>
			<stop offset="0" stop-color="#AE66CD" />
			<stop offset="1" stop-color="#4A64CA" />
		</linearGradient>
		<radialGradient
			id={raysId}
			cx="0"
			cy="0"
			r="1"
			gradientUnits="userSpaceOnUse"
			gradientTransform="matrix(216,0,0,300,216,201)"
		>
			<stop offset="0" stop-color="#6064CB" stop-opacity="0.5" />
			<stop offset="1" stop-color="#6164CB" stop-opacity="0.12" />
		</radialGradient>
	</defs>
	<g transform="translate(-411 -169)">
		<path
			fill={`url(#${shieldId})`}
			d="M530.16,677.474C472.709,632.461 411,558.602 411,449L411,257L627,169L843,257L843,449C843,558.602 781.291,632.461 723.84,677.474L718.446,641.277C765.5,600.41 811,537.907 811,449L811,278.517L627,203.554L443,278.517L443,449C443,537.907 488.499,600.41 535.554,641.277L530.16,677.474ZM649.679,597.113L640,480L627,479L614,480L594.261,718.837C578.934,710.793 559.584,699.414 539.241,684.383L577,431L566,418L688,418L677,431L698.771,577.095L649.679,597.113ZM701.198,593.384L714.759,684.383C694.416,699.414 675.066,710.793 659.739,718.837L651.06,613.829L701.198,593.384ZM689,404L565,404L584,392L584,342L567,342C567,342 574.497,327.723 590.909,313.743C608.909,298.41 627,292 627,292C627,292 645.091,298.41 663.091,313.743C679.503,327.723 687,342 687,342L670,342L670,392L689,404ZM651,342.91L603,342.91L603,383.254L651,383.254L651,342.91Z"
		/>
		<path
			fill={`url(#${raysId})`}
			d="M566,376L445,420L445,320L566,364L566,376ZM672,376L672,364L793,320L793,420L672,376Z"
		/>
	</g>
</svg>

<style>
	.pg-logo {
		display: block;
		width: auto;
		height: 100%;
		max-width: 100%;
		max-height: 100%;
	}
</style>
