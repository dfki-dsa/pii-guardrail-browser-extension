# Changelog

All notable public changes to Privacy Guardrail will be documented in this file.

The project follows public beta release notes for `0.x` versions.

## [0.3.0] - Public Beta

Version 0.2.4 was an internal version bump that was never published; its changes are included here.

- Reduced Local AI memory use: both shipped model files now use ONNX external-data format, removing the multi-gigabyte memory spike while the model loads
- Added a WebGPU model precision choice to the Local AI model picker (popup and options page): a compact 4-bit (q4f16) default that also backs CPU/WASM fallback, and a full-precision (fp16) option that uses slightly more RAM and roughly twice the GPU memory
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
