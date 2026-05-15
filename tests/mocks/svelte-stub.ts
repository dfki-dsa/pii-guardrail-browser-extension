/**
 * Jest stub for the `svelte` package.
 *
 * The overlay wrapper class only needs `mount` / `unmount` to load — the
 * lifecycle tests don't actually render the component tree. Each call
 * appends a sentinel `<div>` to the supplied target so DOM assertions
 * about the host being present/absent still work.
 */

export function mount(_component: unknown, options: { target: Element }): { _target: Element; _node: Element } {
  const node = document.createElement('div');
  node.dataset.stub = 'svelte-mount';
  options.target.appendChild(node);
  return { _target: options.target, _node: node };
}

export function unmount(app: unknown): void {
  const handle = app as { _node?: Element } | null;
  if (handle?._node?.parentNode) {
    handle._node.parentNode.removeChild(handle._node);
  }
}

// `svelte/store` is imported separately and resolves to the real module
// (no mapping for 'svelte/store' in jest config), so writable/derived
// continue to work for any test that exercises the OverlayModel directly.
