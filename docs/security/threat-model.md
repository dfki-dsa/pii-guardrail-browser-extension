# Threat Model

Privacy Guardrail is a public beta Chrome extension for local, assistive PII review before text is pasted into supported LLM chat apps. This document describes the intended security and privacy boundary for the public source at `git@github.com:dfki-dsa/pii-guardrail-browser-extension.git`.

## Assets

The extension handles:

- Clipboard text being pasted into supported chat inputs.
- Detected entity spans and category labels.
- Placeholder maps used to replace sensitive text with stable placeholders.
- Identity vault records used for consistent local placeholder restoration.
- Local settings, allow/block lists, Local AI state, and feedback/correction records when enabled.
- Packaged WASM, ONNX Runtime Web, and local model assets.

These assets should remain local to the browser profile unless the user deliberately exports or shares sanitized information outside the extension.

## Trust Boundaries

### Extension Pages

The popup, options page, background service worker, and offscreen document run as extension pages. They can use extension storage and message passing. Extension pages must not add telemetry, analytics, automatic crash uploads, remote feedback upload, or remote model inference without a new privacy and security review.

### Content Scripts

Content scripts run on the supported beta sites:

- `chatgpt.com`
- `chat.openai.com`
- `claude.ai`
- `gemini.google.com`

They should limit interaction to supported chat UI behavior needed for paste interception, review display, placeholder insertion, page status, and restoration where supported.

### Page Context Script

The clipboard interceptor includes a page-world script where needed to observe paste behavior. Treat this boundary as exposed to page behavior: only pass the minimum data needed, validate messages, and avoid trusting page-provided state for security decisions.

### Local Model Runtime

Transformer NER runs locally using packaged model and ONNX Runtime Web assets. The release package should include reviewed local assets. Runtime code must not fetch a remote model or send model input to a remote service.

## In Scope Threats

- Accidental upload of pasted text, prompts, responses, detected entities, identity maps, vault data, feedback logs, or model input.
- Overbroad extension permissions or host access.
- Unsupported-site behavior being mistaken for supported beta protection.
- Silent Local AI degradation that leaves users with weaker detection without a clear state.
- Unsafe public issue reports containing real personal data, secrets, prompts, responses, or private documents.
- Supply-chain and license risk from bundled model/runtime assets.
- Extension storage exposure through browser profile compromise or local machine compromise.

## Non-Goals

Privacy Guardrail does not claim to:

- Prevent every sensitive-data disclosure.
- Provide legal or regulatory compliance.
- Protect against a compromised browser, operating system, Chrome profile, or malicious extension with broader permissions.
- Protect content after the user sends it to a third-party site.
- Support generic/custom sites in the first public beta.
- Replace organizational data-loss prevention controls.

## Controls

- Local deterministic detection runs through the bundled Rust/WASM engine.
- Local transformer detection uses packaged assets when available.
- The public beta support scope is limited to Chrome desktop stable and the supported sites listed above.
- Public docs and issue templates require synthetic or sanitized examples.
- Sensitive security/privacy reports are routed through `SECURITY.md`.
- Generated model assets, local model sources, local test corpora, and private planning docs are excluded from Git.
- Release validation must include permission review, source-boundary review, model-free checks, strict model-asset checks, manual site smoke tests, and package review.

## Residual Beta Risks

- Detection can miss sensitive content or flag harmless content.
- Supported sites can change their DOM or paste behavior without notice.
- Local AI may be unavailable on some systems or may fall back to slower CPU/WASM execution.
- Local storage persists in the browser profile until the user clears it or the extension removes it.
- Model/runtime dependencies may require renewed license and provenance review before each public release.
- Manual Chrome Web Store upload can select the wrong artifact unless the package checksum is checked against the GitHub pre-release.
