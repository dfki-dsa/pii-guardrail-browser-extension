<table width="100%"><tr>
<td align="left" width="66%">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-privacy-guardrail-white.png">
    <img alt="Privacy Guardrail" src="docs/assets/logo-privacy-guardrail-black.png" height="120">
  </picture>
</td>
<td align="right" width="34%">
  <a href="https://www.dfki.de/" title="Deutsches Forschungszentrum für Künstliche Intelligenz">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/assets/DFKI-Logo_ohne_RGB_weiss.png">
      <img alt="DFKI" src="docs/assets/dfki_Logo_digital_black.png" height="72">
    </picture>
  </a>
</td>
</tr></table>

---

# Privacy Guardrail

Privacy Guardrail is a Manifest V3 Chrome extension that detects personally identifiable information (PII) before text is pasted into supported LLM chat apps. Detection runs locally: deterministic recognizers are compiled from Rust to WebAssembly, and optional transformer NER runs in the browser through ONNX Runtime Web.

Developed at the German Research Center for Artificial Intelligence (DFKI), Forschungsbereich Data Science und ihre Anwendungen.

**Status: public beta (`0.2.0`):** Detection is assistive. It helps you catch personal data before it leaves your machine, but it will not catch everything and is not a compliance or data-loss-prevention product. See [Known limitations](#known-limitations) below.

## Supported targets

- ChatGPT (`chat.openai.com`, `chatgpt.com`)
- Claude (`claude.ai`)
- Gemini (`gemini.google.com`)

Generic or custom sites are not supported in the first public beta.

## System requirements

- Chrome desktop stable (latest).
- **Recommended:** ≥ 16 GB RAM and a WebGPU-capable GPU for smooth Local AI detection.
- **Minimum for Local AI:** more than 8 GB browser-reported memory. On 8 GB or less, the extension automatically disables Local AI and runs pattern-only detection to avoid browser slowdowns. Between 8 GB and 14 GB, Local AI stays on but you may see a slowdown warning — the 14 GB threshold gives some leeway below the 16 GB recommendation.
- Without WebGPU, Local AI falls back to CPU/WASM execution (slower but functional).
- Pattern-only detection runs on any supported Chrome system regardless of memory or WebGPU.

These requirements are high because Local AI runs a transformer NER model entirely in the browser, which is memory- and compute-hungry. Lowering them is an active roadmap item — see [Roadmap](#roadmap) for work on smaller models and more efficient inference paths.

## Install

End users should install from the Chrome Web Store once the listing is live. The GitHub Release attaches the exact packaged ZIP and SHA-256 checksum for transparency and advanced/manual loading; see [Install in Chrome](#install-in-chrome) below for unpacked development installs.

## Documentation

- User guide: [`docs/user/`](docs/user/) — install, day-to-day use, Local AI explained, managing local data, troubleshooting, reporting issues safely, detected categories and limitations.
- Privacy posture: [`PRIVACY.md`](PRIVACY.md).
- Security reporting: [`SECURITY.md`](SECURITY.md).
- Support: [`SUPPORT.md`](SUPPORT.md).
- Changelog: [`CHANGELOG.md`](CHANGELOG.md).
- Contributing: [`CONTRIBUTING.md`](CONTRIBUTING.md).

## What the extension does

- Intercepts text paste events in supported chat inputs.
- Detects regex/checksum-backed PII such as email addresses, phone numbers, SSNs, credit cards, IBANs, IP addresses, and dates.
- Adds local transformer NER for names, addresses, identifiers, credentials, and other free-text PII when model assets are prepared.
- Shows a review UI before anonymizing detected spans.
- Replaces selected spans with stable placeholders such as `[EMAIL_1]` and `[PERSON_1]`.
- Stores the placeholder map locally in Chrome storage so model responses can be de-anonymized later, with restored values visually highlighted in the chat response.

No pasted text is sent to a remote inference service by this project. There is no telemetry, analytics, or automatic remote feedback collection. See [`PRIVACY.md`](PRIVACY.md) for the full privacy posture.

## Known limitations

- Detection can miss sensitive content and can flag harmless text.
- Short names, ambiguous words, code blocks, tables, and unusual formatting reduce detection quality.
- Local AI can be slow or unavailable depending on browser, device memory, and WebGPU support; pattern-only mode covers a narrower set of categories.
- Restoration of placeholders into model responses depends on local records and may not handle every response rewrite.

## Roadmap

Directional themes for future work. None of these are commitments and order may change based on evidence and community feedback:

- Improved reliable local PII detection — evaluating smaller models, distillation, fine-tuning, and hybrid rule/model pipelines.
- More browser-efficient inference paths for lower-resource devices.
- Support for additional Chromium-based browsers beyond Chrome desktop stable.
- Mobile support for AI workflows on smartphones.
- Support for additional AI chat platforms.

## Repository-generated artifacts

The following directories are build or local-model artifacts and are intentionally not committed:

- `dist/` — unpacked Chrome extension output.
- `crate/pkg/` and `crate/target/` — Rust/WASM build output.
- `generated/models/ner/` — prepared runtime model assets copied into `dist/`.
- `.model-sources/` — local Hugging Face downloads or exported source models.
- `.venv/` — optional local Python environment for ONNX conversion.
- `.private-docs/` — local-only launch plans, PRDs, research drafts, and issue planning.
- `tests-local/` — local-only model regression fixtures.
- `benchmarks/cache/`, `benchmarks/corpora/`, and benchmark result reports — downloaded or generated benchmark artifacts.

See `docs/release/public-source-boundary.md` for the public initial-commit include/exclude boundary and release-prep verification commands.

A plain build can run without prepared model assets, but then the default BardsAI transformer provider is unavailable at runtime and detection falls back to regex/fixture-backed flows. For a full local NER build, prepare the BardsAI model first. HikmaAI and AI4Privacy are optional/deprecated comparison assets.

## Prerequisites

Install:

- Node.js with npm.
- Google Chrome.
- Rust via `rustup`.
- Rust target `wasm32-unknown-unknown`.
- `wasm-bindgen-cli` version `0.2.118`.
- Python 3.10+ for model download/conversion.

Initial toolchain setup:

```bash
rustup update
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.118
npm install
```

If Cargo reports that it does not understand lock file version `4`, the Rust toolchain is too old; run `rustup update`.

## Full first-time setup with the default NER model

The standard packaged NER model is BardsAI EU multilingual. The build expects prepared files under:

```text
generated/models/ner/bardsai-eu-pii-anonimization-multilang/
  config.json
  tokenizer.json
  tokenizer_config.json
  onnx/model_quantized.onnx   # CPU/WASM fallback
  onnx/model_fp16.onnx        # WebGPU path
```

### 1. Create a Python environment for model tooling

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
python -m pip install -U "huggingface_hub[cli]" onnx onnxruntime sympy
```

`onnxruntime` is used by the prep scripts to dynamically quantize float ONNX models and to convert fp32 ONNX to fp16 for WebGPU.

### 2. Download the BardsAI source files

Download only the files needed by the extension prep script:

```bash
mkdir -p .model-sources
hf download bardsai/eu-pii-anonimization-multilang \
  --include "config.json" \
  --include "tokenizer.json" \
  --include "tokenizer_config.json" \
  --include "vocab.txt" \
  --include "special_tokens_map.json" \
  --include "onnx/model.onnx" \
  --include "onnx/model_quantized.onnx" \
  --include "onnx/model_fp16.onnx" \
  --local-dir .model-sources/bardsai-eu-pii-anonimization-multilang
```

Notes:

- Add `--dry-run` before downloading if you want to preview large files.
- BardsAI is Apache-2.0 and multilingual, but its ONNX artifacts are large.
- `onnx/model_fp16.onnx` may not exist in every model revision. That is fine if `onnx/model.onnx` is present; the prep script will generate fp16 locally.
- `onnx/model_quantized.onnx` may also be absent in some source directories. If `onnx/model.onnx` is present, the prep script will generate the quantized model locally.

### 3. If the source only has PyTorch/safetensors weights, export ONNX first

Skip this step when the download already contains `onnx/model.onnx`.

```bash
python -m pip install -U "optimum[onnxruntime]" transformers safetensors
optimum-cli export onnx \
  --model bardsai/eu-pii-anonimization-multilang \
  --task token-classification \
  .model-sources/bardsai-eu-pii-anonimization-multilang-onnx-export
```

Then use `.model-sources/bardsai-eu-pii-anonimization-multilang-onnx-export` as the `--source-dir` in the next step. The prep script accepts a float ONNX file at either `model.onnx` or `onnx/model.onnx`.

### 4. Prepare runtime model assets

```bash
npm run prepare:model:bardsai -- \
  --source-dir .model-sources/bardsai-eu-pii-anonimization-multilang \
  --force
```

What this command does:

1. Verifies `config.json`, `tokenizer.json`, and `tokenizer_config.json`.
2. Copies tokenizer vocabulary files when present.
3. Copies `onnx/model_quantized.onnx` if available, otherwise creates it from a float ONNX file with ONNX Runtime dynamic QInt8 quantization.
4. Copies `onnx/model_fp16.onnx` if available, otherwise converts the float ONNX model to fp16.
5. Writes `generated/models/ner/bardsai-eu-pii-anonimization-multilang/manifest.json` with artifact metadata.

### 5. Build and package the extension

For a full build where missing model assets fail fast:

```bash
NER_MODEL_ASSETS_REQUIRED=1 npm run build
```

For a build that allows regex-only fallback when model assets are missing:

```bash
npm run build
```

Build output is written to `dist/`. The webpack build copies the prepared BardsAI model to `dist/models/ner/bardsai-eu-pii-anonimization-multilang/` and copies required ONNX Runtime Web files from `node_modules/onnxruntime-web/dist/` to `dist/vendor/onnxruntime-web/`.

## Install in Chrome

This unpacked-install path is for development. End users should use the Chrome Web Store listing or the signed ZIP attached to a GitHub Release.

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository's `dist/` directory.
5. Open or refresh a supported LLM chat tab before testing.

To produce the official packaged ZIP and checksum (matches the artifact uploaded to the Chrome Web Store and attached to GitHub Releases):

```bash
npm run version:check -- 0.2.0
npm run package:release
```

## Development workflow

Generate Rust/WASM once before starting webpack watch:

```bash
npm run build:wasm
npm run dev
```

`npm run dev` rebuilds the extension bundle into `dist/` when TypeScript, HTML, CSS, or copied static assets change.

When Rust code under `crate/src/` changes, rerun:

```bash
npm run build:wasm
```

Then reload the unpacked extension in `chrome://extensions` and refresh the target chat tab. If webpack watch does not pick up regenerated WASM glue, restart `npm run dev`.

## Optional/deprecated model preparation

### HikmaAI DistilBERT PII

HikmaAI is now a deprecated comparison model. It is not the default runtime model, but its prep scripts remain available for benchmarks and local comparisons.

```bash
hf download HikmaAI/hikmaai-distilbert-pii \
  --include "config.json" \
  --include "tokenizer.json" \
  --include "tokenizer_config.json" \
  --include "vocab.txt" \
  --include "special_tokens_map.json" \
  --include "onnx/model.onnx" \
  --include "onnx/model_quantized.onnx" \
  --include "onnx/model_fp16.onnx" \
  --local-dir .model-sources/hikmaai-distilbert-pii

npm run prepare:model:hikmaai -- \
  --source-dir .model-sources/hikmaai-distilbert-pii \
  --force
```

### AI4Privacy benchmark/prototype model

AI4Privacy is kept for manual comparison and local regression tests. Its license is CC-BY-NC-4.0, so treat it as a research/prototype asset unless your use case is compatible with that license.

```bash
hf download Isotonic/distilbert_finetuned_ai4privacy_v2 \
  --include "config.json" \
  --include "tokenizer.json" \
  --include "tokenizer_config.json" \
  --include "vocab.txt" \
  --include "special_tokens_map.json" \
  --include "onnx/model.onnx" \
  --include "onnx/model_quantized.onnx" \
  --local-dir .model-sources/ai4privacy-v2

npm run prepare:model:ai4privacy -- \
  --source-dir .model-sources/ai4privacy-v2 \
  --python .venv/bin/python \
  --force
```

AI4Privacy preparation requires `model_quantized.onnx`; if only `model.onnx` is available, the script generates the quantized file. It does not require fp16 because AI4Privacy is not an active WebGPU runtime model.

## Rebuilding fp16 WebGPU files only

If source directories are already downloaded and prepared, you can regenerate just the fp16 WebGPU ONNX files:

```bash
npm run convert:model:fp16 -- --force
```

This writes fp16 files into:

- `generated/models/ner/hikmaai-distilbert-pii/onnx/model_fp16.onnx`
- `generated/models/ner/bardsai-eu-pii-anonimization-multilang/onnx/model_fp16.onnx`

By default the converter copies an existing source `onnx/model_fp16.onnx` when available. To force conversion from fp32 ONNX:

```bash
npm run convert:model:fp16:hikmaai -- --from-float --force
npm run convert:model:fp16:bardsai -- --from-float --force
```

The converter does not write to `dist/`; run `npm run build:ext` or `npm run build` afterwards.

## Testing

```bash
npm run test
npm run test:rust
```

Opt-in local model regression tests require prepared AI4Privacy assets:

```bash
npm run test:ner:model
```

The regression corpus lives in `tests-local/ner-regression-corpus.json`. The harness disables remote model fetches and fails fast when `generated/models/ner/ai4privacy/` is missing.

## OpenPII benchmark suite

The OpenPII benchmark is opt-in and is not run by `npm test`.

Regex-only benchmark, no model assets required:

```bash
npm run benchmark:openpii -- --regex-only
```

Run with the standard prepared BardsAI model, or an optional/deprecated comparison model:

```bash
npm run benchmark:openpii -- --model bardsai
npm run benchmark:openpii -- --model hikmaai
npm run benchmark:openpii -- --model ai4privacy
```

Write a JSON report:

```bash
npm run benchmark:openpii -- --model bardsai --out /tmp/openpii-bardsai-report.json
```

Rebuild the pinned generated corpus from OpenPII source data:

```bash
npm run benchmark:openpii:download
npm run benchmark:openpii:build
```

## Useful scripts

- `npm run build:wasm` — build the Rust crate for `wasm32-unknown-unknown` and generate `crate/pkg/` with `wasm-bindgen`.
- `npm run build:ext` — bundle the Chrome extension into `dist/`.
- `npm run build` — run `build:wasm` and `build:ext`.
- `npm run dev` — run webpack in development watch mode.
- `npm run prepare:model:bardsai -- --source-dir <dir>` — prepare the standard BardsAI runtime/benchmark assets.
- `npm run prepare:model:hikmaai -- --source-dir <dir>` — prepare deprecated HikmaAI comparison assets.
- `npm run prepare:model:ai4privacy -- --source-dir <dir>` — prepare deprecated AI4Privacy benchmark/prototype assets.
- `npm run convert:model:fp16` — regenerate fp16 ONNX files for HikmaAI and BardsAI.
- `npm run test` — run Jest tests.
- `npm run test:ner:model` — run opt-in local AI4Privacy model regression tests.
- `npm run test:rust` — run Rust tests.
- `npm run benchmark:openpii -- --regex-only` — run OpenPII regex benchmark.
- `npm run benchmark:openpii -- --model <key>` — run OpenPII with `hikmaai`, `bardsai`, or `ai4privacy`.
- `npm run clean` — remove `dist/`, `crate/pkg/`, and `crate/target/`.

## Project layout

- `src/` — extension TypeScript, UI, offscreen detection, and benchmark code.
- `crate/` — Rust/WASM detection engine.
- `scripts/` — model prep, packaging checks, and benchmark helpers.
- `benchmarks/` — benchmark helper area; generated corpora, caches, and result reports stay local.
- `docs/` — product, validation, and design notes.

## Troubleshooting

### `wasm-bindgen: command not found`

Install the pinned CLI:

```bash
cargo install wasm-bindgen-cli --version 0.2.118
```

The CLI version must match the `wasm-bindgen` version used by the Rust crate. If you see a schema mismatch, reinstall the version shown in `crate/Cargo.lock`.

### Missing ONNX Runtime Web assets

Run:

```bash
npm install
```

The extension build expects selected files under `node_modules/onnxruntime-web/dist/` and copies them into `dist/vendor/onnxruntime-web/`.

### Prepared BardsAI model assets are missing

Run the BardsAI download and preparation steps above. To make missing model assets fatal during release packaging, build with:

```bash
NER_MODEL_ASSETS_REQUIRED=1 npm run build
```

### Python conversion fails with `No module named onnxruntime` or `No module named onnx`

Activate the Python environment before running model prep and reinstall conversion dependencies:

```bash
source .venv/bin/activate
python -m pip install -U onnx onnxruntime sympy
```

The BardsAI and HikmaAI prep wrappers call `python3`, so activation must make `python3` resolve to the environment with those packages installed.

### `Output directory already exists`

Model prep scripts protect existing generated assets. Rerun with `--force` to replace them:

```bash
npm run prepare:model:bardsai -- --source-dir .model-sources/bardsai-eu-pii-anonimization-multilang --force
```

### Chrome loads the extension but model status is unavailable

Rebuild after preparing model assets:

```bash
NER_MODEL_ASSETS_REQUIRED=1 npm run build
```

Then reload the unpacked extension and refresh the chat tab.

## Acknowledgements

<table width="100%"><tr>
<td align="left" width="120"><a href="https://www.dfki.de/web/forschung/forschungsbereiche/data-science-und-ihre-anwendungen" title="Data Science and its Applications, DFKI">
  <img alt="DSA — Data Science and its Applications" src="docs/assets/dsa-logo.png" height="120">
</a></td>
<td>
Privacy Guardrail is developed in the [Data Science and its Applications](https://www.dfki.de/web/forschung/forschungsbereiche/data-science-und-ihre-anwendungen) research group at the [German Research Center for Artificial Intelligence (DFKI)](https://www.dfki.de/).</td></tr></table>

### Contributors

- Björn Busch-Geertsema — Lead Developer
- Sergey Redyuk — Developer
- Prof. Dr. Sebastian Vollmer
- Rahul Sharma
- Islam Mesabah
- Kai Spriestersbach
- Andrea Sipka