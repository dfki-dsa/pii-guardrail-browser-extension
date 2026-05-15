/**
 * Jest stub for compiled .svelte component imports.
 *
 * Returns an opaque marker object so the wrapper's `mount(Component, …)`
 * call has something to pass through; the svelte-stub's `mount` ignores
 * the component anyway.
 */

const Component = { __stub: 'svelte-component' };
export default Component;
