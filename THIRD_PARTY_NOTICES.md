# Third-Party Notices

Privacy Guardrail project code is licensed under the Apache License, Version 2.0. Third-party dependencies, runtime assets, model assets, fonts, and browser platform components remain under their own licenses.

This notice is a public beta baseline and should be reviewed before each release package is published.

## JavaScript Dependencies

The extension build uses npm dependencies declared in `package.json` and `package-lock.json`.

Notable runtime dependency:

- `@huggingface/transformers`

Notable development and build dependencies include Svelte, webpack, Jest, TypeScript, ESLint, and related loaders or type packages.

Review dependency license metadata from the lockfile before release packaging.

## Rust And WebAssembly Dependencies

The Rust recognizer crate and WebAssembly build use dependencies declared in `crate/Cargo.toml` and `crate/Cargo.lock`.

Review Cargo dependency license metadata before release packaging.

## ONNX Runtime Web

The extension build copies required ONNX Runtime Web files from `node_modules/onnxruntime-web/dist/` into the extension package when Local AI support is built. ONNX Runtime Web is a third-party runtime dependency and is licensed separately from Privacy Guardrail project code.

## Model Assets

Prepared model assets are not committed to Git. Official release packages may include prepared BardsAI runtime assets under:

```text
dist/models/ner/bardsai-eu-pii-anonimization-multilang/
```

The source model currently referenced for the beta release path is:

- BardsAI EU multilingual PII anonymization model (`bardsai/eu-pii-anonimization-multilang`)

The README notes that BardsAI is Apache-2.0. Confirm model license metadata and included artifact notices before publishing each release package.

Deprecated or comparison-only model paths may reference HikmaAI and AI4Privacy assets for local benchmarking or research. Those assets are not the default public beta runtime path and must not be included in an official package unless their licenses and release purpose have been reviewed. The README notes that AI4Privacy is CC-BY-NC-4.0 and should be treated as a research/prototype asset unless the use case is compatible with that license.

## Fonts And Browser Assets

If a release package includes bundled fonts, icons, screenshots, or other visual assets, list their source and license here before publication.

Chrome, Chrome Web Store, ChatGPT, Claude, Gemini, and other named services are trademarks or product names of their respective owners. They are referenced only to describe the public beta support scope.

## Separation Of Licenses

The Apache-2.0 license in `LICENSE` applies to Privacy Guardrail project code unless a file states otherwise. It does not replace or relicense third-party dependencies, model files, runtime binaries, fonts, browser platform components, or service trademarks.
