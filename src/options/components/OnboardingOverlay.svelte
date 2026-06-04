<script lang="ts">
	let { onDismiss }: { onDismiss: () => void } = $props();

	const panels = [
		{
			id: 'download-size',
			heading: 'Why the download is large',
			body: `The extension bundles a named-entity recognition model (~40–80 MB of ONNX weights)
so detection works without any network access after install. The browser caches
these files permanently — you will not re-download them unless you uninstall and
reinstall the extension or clear your browser profile data.`,
		},
		{
			id: 'local-inference',
			heading: 'All analysis runs in your browser',
			body: `Text you paste into a supported page is scanned entirely inside the browser. The
model runs in an isolated offscreen document using WebAssembly, and WebGPU when
available. No content is ever sent to a server, and no account or internet
connection is required for detection to work.`,
		},
		{
			id: 'vault',
			heading: 'The vault and how it stores data',
			body: `When the vault is enabled, each detected identity is saved once in
chrome.storage.local and reused consistently across sessions and pages — so the
same person always becomes the same placeholder. This data lives only on this
device and is never synced to any external service. You can export, import, or
clear vault records at any time from the Identity vault section of these settings.`,
		},
		{
			id: 'performance',
			heading: 'What to expect from performance',
			body: `The first scan after the browser starts triggers model loading, which may take
several seconds. Subsequent scans within the same session reuse the loaded model
and are substantially faster. On devices without WebGPU support, the extension
falls back to CPU inference, which may take 5–15 seconds per scan. A memory guard
automatically disables local inference on low-memory devices to prevent browser
slowdowns; pattern-based detection remains active in that case.`,
		},
	] as const;

	let openId = $state<string | null>('download-size');

	function toggle(id: string) {
		openId = openId === id ? null : id;
	}
</script>

<div class="overlay" role="dialog" aria-modal="true" aria-label="First-run guide">
	<div class="sheet">
		<div class="sheet-header">
			<h2>Getting started</h2>
			<p class="sheet-sub">
				This guide covers the key things to know before you start. You can reopen it any time
				from the link at the bottom of these settings.
			</p>
		</div>

		<div class="panels">
			{#each panels as panel (panel.id)}
				{@const open = openId === panel.id}
				<div class="panel" class:open>
					<button
						type="button"
						class="panel-trigger"
						aria-expanded={open}
						aria-controls="panel-body-{panel.id}"
						onclick={() => toggle(panel.id)}
					>
						<span class="panel-heading">{panel.heading}</span>
						<span class="chevron" aria-hidden="true">{open ? '−' : '+'}</span>
					</button>
					<div class="panel-body" id="panel-body-{panel.id}" hidden={!open}>
						<p>{panel.body}</p>
					</div>
				</div>
			{/each}
		</div>

		<div class="sheet-footer">
			<button type="button" class="btn-primary" onclick={onDismiss}>
				Continue to settings
			</button>
			<button type="button" class="btn-ghost" onclick={onDismiss}>
				Skip
			</button>
		</div>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgb(0 0 0 / 55%);
		padding: 24px;
	}

	.sheet {
		width: 100%;
		max-width: 560px;
		max-height: calc(100vh - 48px);
		overflow-y: auto;
		background: var(--color-card);
		border-radius: var(--radius-lg);
		border: var(--border-hairline);
		box-shadow: 0 20px 60px rgb(0 0 0 / 30%);
		display: flex;
		flex-direction: column;
	}

	.sheet-header {
		padding: 24px 24px 16px;
		border-bottom: var(--border-hairline);
	}

	.sheet-header h2 {
		margin: 0 0 6px;
		font-size: 18px;
		font-weight: 600;
		color: var(--color-ink);
		letter-spacing: -0.2px;
	}

	.sheet-sub {
		margin: 0;
		font-size: 13px;
		color: var(--color-muted);
		line-height: 1.5;
	}

	.panels {
		flex: 1;
		min-height: 0;
	}

	.panel {
		border-bottom: var(--border-hairline);
	}

	.panel:last-child {
		border-bottom: none;
	}

	.panel-trigger {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 14px 24px;
		border: 0;
		background: transparent;
		color: var(--color-ink);
		text-align: left;
		cursor: pointer;
		transition: background 100ms ease;
	}

	.panel-trigger:hover {
		background: var(--color-surface);
	}

	.panel.open .panel-trigger {
		background: var(--color-surface);
	}

	.panel-heading {
		font-size: 13px;
		font-weight: 600;
	}

	.chevron {
		flex-shrink: 0;
		font-size: 18px;
		font-weight: 300;
		line-height: 1;
		color: var(--color-muted);
		user-select: none;
	}

	.panel-body {
		padding: 0 24px 16px;
	}

	.panel-body p {
		margin: 0;
		font-size: 13px;
		color: var(--color-muted);
		line-height: 1.6;
	}

	.sheet-footer {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 16px 24px;
		border-top: var(--border-hairline);
	}

	.btn-primary {
		padding: 8px 18px;
		border: 0;
		border-radius: var(--radius-md);
		background: var(--color-accent);
		color: #fff;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 120ms ease;
	}

	.btn-primary:hover {
		opacity: 0.9;
	}

	.btn-ghost {
		padding: 8px 14px;
		border: var(--border-hairline);
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-muted);
		font-size: 13px;
		cursor: pointer;
		transition: border-color 100ms ease, color 100ms ease;
	}

	.btn-ghost:hover {
		border-color: var(--color-accent);
		color: var(--color-ink);
	}
</style>
