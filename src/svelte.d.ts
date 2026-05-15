declare module '*.svelte' {
  import type { Component } from 'svelte';
  const component: Component<Record<string, never>>;
  export default component;
}

declare module '*.css' {
  const css: string;
  export default css;
}
