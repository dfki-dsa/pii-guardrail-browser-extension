# Changelog

All notable public changes to Privacy Guardrail will be documented in this file.

The project follows public beta release notes for `0.x` versions.

## Unreleased

## [0.4.1] - Public Beta

- Reduced the packaged extension from about 408 MB to about 167 MB by shipping the optimized Local AI model. Version 0.4.0 added the tooling for this but still packaged the unoptimized model assets.
- The bundled tokenizer is now 5.6 MB instead of 16.8 MB, and the 4-bit model weights 167 MB instead of 433 MB, because the model vocabulary is restricted to Latin, Greek, and Cyrillic scripts and word embeddings are stored as int8.
- Local AI's vocabulary now covers Latin, Greek, and Cyrillic only. Names and addresses written in other scripts, for example Chinese, Japanese, or Arabic, are less likely to be flagged by Local AI. Pattern detection is unchanged.
- Corrected documentation that still described a selectable full-precision (fp16) model. The extension ships a single 4-bit (q4f16) build for both the WebGPU and the CPU/WASM path.

## [0.4.0] - Public Beta

- Fixed ChatGPT paste interception so the local review flow blocks the native paste before the user approves it.
- Reduced the shipped Local AI package size by deduplicating WASM assets, pruning the tokenizer vocabulary, and quantizing embedding weights to int8.
- Added reproducible tooling and documentation for preparing the optimized BardsAI model assets.

## [0.3.2] - Public Beta

- Added terms of use, release legal notices, and packaged legal documents for GitHub release artifacts
- Surfaced legal and support links in the popup and options UI

## [0.3.1] - Public Beta

- Reused the stored system compatibility check for WebGPU detection, avoiding an extra adapter probe that could fail while Local AI loads
- Improved the supported-page status chip: Local AI model load failures now show the underlying error detail, and CPU fallback is surfaced when Local AI is running without WebGPU
- Made content-script runtime messages best-effort so stale page scripts do not surface errors after the extension is reloaded
- Clarified privacy policy and Chrome Web Store listing wording

## [0.3.0] - Public Beta

Version 0.2.4 was an internal version bump that was never published; its changes are included here.

- Reduced Local AI memory use: both WebGPU model files now ship in ONNX external-data format, removing the multi-gigabyte memory spike while the model loads
- Added a GPU model precision choice to the Local AI model picker (popup and options page): a compact 4-bit (q4f16) default that keeps Local AI around 1 GB of RAM while loaded, and a full-precision (fp16) option that uses slightly more RAM and roughly twice the GPU memory
- Switching the model or precision now reloads Local AI immediately so the change takes effect right away
- Added automatic Local AI warmup while active on a supported chat page on capable systems, with options to control retention and the inactivity unload timeout
- Surfaced raw Local AI model labels in debug output
- Migrated toast notifications to the design system
- Updated privacy and legal disclosures

## [0.2.3] - Public Beta

- Added BETA badge to the popup and options page headers
- Filled in Impressum legal notice with provider, project, and DPO contacts
- Adjusted accent color
- Removed the GitHub Actions CI workflow (validation runs locally via `npm run validate:ci`)

## [0.2.2] - Public Beta

- Shortened extension description to fit the Chrome Web Store 132-character limit

## [0.2.1] - Public Beta

- Reframed extension description and popup messaging
- Added Impressum / legal notice link to README

## [0.2.0] - Public Beta

Initial public beta placeholder.

Planned release notes will cover:

- Chrome desktop beta support for ChatGPT, Claude, and Gemini.
- Local assistive PII review before paste.
- Pattern-based detection and optional packaged Local AI detection.
- Local placeholder mapping and restoration support where available.
- Public documentation for privacy, security, support, contribution, and release workflows.

This beta does not guarantee complete detection, prevention of disclosure, or regulatory compliance.
