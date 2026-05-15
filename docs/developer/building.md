# Building Privacy Guardrail

This guide covers local development builds for Privacy Guardrail, the public beta Chrome extension source published at `git@github.com:dfki-dsa/pii-guardrail-browser-extension.git`.

## Prerequisites

Install:

- Node.js with npm.
- Google Chrome desktop stable.
- Rust via `rustup`.
- Rust target `wasm32-unknown-unknown`.
- `wasm-bindgen-cli` version `0.2.118`.
- Python 3.10+ when preparing local NER model assets.

Initial setup:

```bash
rustup update
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.118
npm install
```

If Cargo rejects the lockfile version, update Rust with `rustup update`.

## Model-Free Build

A normal build can run without prepared transformer model assets:

```bash
npm run build
```

This runs:

- `npm run build:wasm`
- `npm run build:ext`

The output is written to `dist/`. Without prepared BardsAI assets, the extension packages deterministic pattern detection and fixture-backed flows only; Local AI transformer detection is unavailable at runtime.

For frontend-only iteration after WASM has already been built:

```bash
npm run build:ext
```

For watch mode:

```bash
npm run build:wasm
npm run dev
```

When Rust code under `crate/src/` changes, rerun `npm run build:wasm`, reload the unpacked extension, and refresh the supported chat tab.

## Full Model Build

The public beta release package is expected to include prepared BardsAI EU multilingual NER assets. Prepare them before a strict release build:

```bash
npm run prepare:model:bardsai -- \
  --source-dir .model-sources/bardsai-eu-pii-anonimization-multilang \
  --force
```

Then build with missing model assets treated as fatal:

```bash
NER_MODEL_ASSETS_REQUIRED=1 npm run build
```

Expected prepared asset location:

```text
generated/models/ner/bardsai-eu-pii-anonimization-multilang/
  config.json
  tokenizer.json
  tokenizer_config.json
  onnx/model_quantized.onnx
  onnx/model_fp16.onnx
```

Webpack copies those files into `dist/models/ner/bardsai-eu-pii-anonimization-multilang/` and copies the required ONNX Runtime Web files into `dist/vendor/onnxruntime-web/`.

See `docs/developer/model-assets.md` for source download, conversion, and licensing notes.

## Checks And Tests

Run the model-free checks before opening a pull request:

```bash
npm run validate:ci
```

This command does not download, prepare, or require large model assets. It runs the same model-free validation used by GitHub Actions: Jest, Svelte checks, version alignment, Chrome permission checks, the privacy-boundary scan, Rust tests, and a model-free extension build.

Optional checks:

```bash
npm run lint
npm run benchmark:openpii -- --regex-only
```

Opt-in local model regression tests require local-only AI4Privacy assets and fixtures:

```bash
npm run test:ner:model
```

Those local model fixtures are not part of the public initial commit.

## Load In Chrome

1. Build the extension.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Choose Load unpacked.
5. Select this repository's `dist/` directory.
6. Open or refresh a supported beta site:
   - `chatgpt.com`
   - `chat.openai.com`
   - `claude.ai`
   - `gemini.google.com`

The Chrome Web Store is the primary install path for beta users. Loading unpacked builds is for development and manual release validation.

## Common Build Problems

- Missing `wasm-bindgen`: install `wasm-bindgen-cli` version `0.2.118`.
- Missing ONNX Runtime Web files: run `npm install`.
- Missing BardsAI assets in strict mode: prepare the model assets, then rerun `NER_MODEL_ASSETS_REQUIRED=1 npm run build`.
- Release-strict validation fails on missing BardsAI assets by design; use `npm run validate:ci` for model-free pull request checks.
- Python conversion import errors: activate `.venv` and install `onnx`, `onnxruntime`, and `sympy`.
