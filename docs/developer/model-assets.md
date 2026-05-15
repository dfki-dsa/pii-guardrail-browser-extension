# Model Assets

Privacy Guardrail runs detection locally in the browser. Deterministic recognizers are built from Rust to WebAssembly, and optional transformer NER uses model assets packaged with the extension. The public beta source is published at `git@github.com:dfki-dsa/pii-guardrail-browser-extension.git`.

## Release Model

The official public beta package uses BardsAI EU multilingual NER assets prepared under:

```text
generated/models/ner/bardsai-eu-pii-anonimization-multilang/
```

Required release assets:

```text
config.json
tokenizer.json
tokenizer_config.json
onnx/model_quantized.onnx
onnx/model_fp16.onnx
```

The generated directory is ignored by Git. Prepared model assets are release artifacts, not source files.

## Why Assets Are Not Committed

Model and runtime artifacts are not committed because they are large generated files with their own upstream licensing, provenance, and review requirements. Keeping them out of source control also makes the public repository easier to inspect and keeps the public initial commit focused on source code, tests, docs, and build scripts.

Official release packages must still include the prepared runtime assets. The release checklist should verify the exact package contents and attach the package checksum to the GitHub pre-release.

## Prepare BardsAI Assets

Create a Python environment for conversion tools:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
python -m pip install -U "huggingface_hub[cli]" onnx onnxruntime sympy
```

Download the needed upstream files into the local source cache:

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

Prepare the runtime copy:

```bash
npm run prepare:model:bardsai -- \
  --source-dir .model-sources/bardsai-eu-pii-anonimization-multilang \
  --force
```

The prep script verifies tokenizer metadata, copies tokenizer files, copies or creates `model_quantized.onnx`, copies or creates `model_fp16.onnx`, and writes an asset manifest.

If the source directory only has PyTorch or safetensors weights, export ONNX first with Optimum, then pass the exported directory to `prepare:model:bardsai`.

## Build With Assets Required

Use strict model enforcement for release validation:

```bash
NER_MODEL_ASSETS_REQUIRED=1 npm run build
```

This fails when required BardsAI files are missing. A normal `npm run build` allows the extension to build without the transformer model so developers can run model-free checks.

## Optional Comparison Assets

The repository still contains preparation scripts for deprecated or comparison models:

- `npm run prepare:model:hikmaai`
- `npm run prepare:model:ai4privacy`
- `npm run convert:model:fp16`

These are not the standard public beta runtime model. AI4Privacy assets are treated as local research/prototype assets and are not included in the official beta package.

## Licensing Caveats

Project source code is Apache-2.0, but bundled model, runtime, font, and npm/Cargo dependencies keep their own licenses. Before packaging a public release:

1. Review upstream model license and provenance.
2. Review ONNX Runtime Web and transformers.js distribution terms.
3. Update `THIRD_PARTY_NOTICES.md` if bundled assets change.
4. Keep generated model sources and prepared assets out of Git.

Do not make benchmark, accuracy, compliance, or prevention claims from model inclusion alone.
