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
onnx/model_q4f16.onnx
onnx/model_q4f16.onnx.data
onnx/model_fp16.onnx
onnx/model_fp16.onnx.data
```

Both shipped transformer artifacts (`model_q4f16` and `model_fp16`) use ONNX external-data format: a small graph protobuf plus a `.onnx.data` weights sidecar. Embedded-weight protobufs force ONNX Runtime to copy all weights through the never-shrinking wasm heap during session init, which held multiple GB of RAM until the offscreen document closed. The q4f16 artifact is used for CPU/WASM fallback and as the default WebGPU model; the q8 `model_quantized.onnx` artifact is not packaged for the active release model.

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
python -m pip install -U "huggingface_hub[cli]" onnx onnxruntime onnx-ir sympy
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

The prep script verifies tokenizer metadata, copies tokenizer files, copies or creates `model_quantized.onnx` as a generated comparison/byproduct artifact, copies or creates `model_fp16.onnx`, and writes an asset manifest. Release packaging excludes `model_quantized.onnx`; q4f16 is the active CPU/WASM fallback.

Repackage the embedded fp16 model as ONNX external data (in place, under `generated/models`):

```bash
npm run convert:model:external-data -- --model bardsai-fp16
```

Pass `--force` to overwrite an existing `model_fp16.onnx.data`. The script verifies that the `location` recorded inside the protobuf matches the file name the runtime passes to ONNX Runtime (`session_options.externalData` in `src/shared/constants.ts`) and runs the ONNX checker on the result.

Generate the q4f16 artifact pair:

```bash
npm run convert:model:q4f16:bardsai
```

The script quantizes the fp16 model (or creates an fp16 intermediate from `onnx/model.onnx`) with ONNX Runtime's MatMulNBits 4-bit weight-only quantization. Defaults are `bits=4`, `block_size=32`, symmetric weights, `QOperator` format, `MatMul` ops only; see `--help` for overrides. The output is written directly in external-data format (`model_q4f16.onnx` plus `model_q4f16.onnx.data`) together with a conversion manifest, so no separate external-data repackaging step is needed. Validation asserts that every external tensor records the `model_q4f16.onnx.data` location the runtime passes to ONNX Runtime via `session_options.externalData`, and the manifest records size and SHA-256 for both the graph and the weights sidecar. Pass `--force` to replace an existing output. The Python environment additionally needs `onnx-ir` for the MatMulNBits quantizer import.

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
