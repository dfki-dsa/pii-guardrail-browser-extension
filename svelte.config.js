const sveltePreprocess = require('svelte-preprocess');

/** @type {import('svelte').Config} */
module.exports = {
  compilerOptions: {
    runes: true,
  },
  preprocess: sveltePreprocess({ typescript: true }),
};
