# Privacy Boundary Verification

Run this check before release validation and before creating the official Chrome package:

```bash
npm run check:privacy-boundary
```

The check is CI-safe and does not require prepared model assets. It verifies that the extension source does not add telemetry, analytics, crash-reporting dependencies, or runtime network primitives that could upload user content.

## What Is Checked

- Runtime source under `src/` is scanned for `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `EventSource`, remote `importScripts`, and remote script tags.
- `package.json` dependencies are scanned for common analytics, telemetry, and crash-reporting packages.
- Transformers.js runtime configuration is checked so remote model loading stays disabled and packaged extension assets remain the model/runtime source.

## Approved Runtime Network Primitive

The only approved runtime network primitive is the `fetch(url, { method: 'HEAD' })` probe in `src/offscreen/ner-provider.ts`.

That probe is limited to local extension asset existence checks. The NER provider builds the checked URLs with `chrome.runtime.getURL(...)`, and Transformers.js is configured with:

- `allowRemoteModels = false`
- `allowLocalModels = true`
- `localModelPath = chrome.runtime.getURL(...)`
- browser, filesystem, and WASM caches disabled

If a future change needs another network primitive, document the user-visible reason, prove that it cannot upload clipboard text, prompts, responses, detected entities, identity vault data, feedback logs, or model input, and extend the static check with a narrow allowlist entry.

## Local Data Boundary

The extension stores settings, placeholder maps, identity vault records, allow/block lists, system compatibility state, and feedback records in Chrome extension local storage or in local runtime memory. The public beta does not include telemetry, analytics, automatic remote feedback collection, automatic crash-report upload, or remote inference.

User content and local feedback logs are not used for training by this project unless a user separately creates and contributes a sanitized sample outside the extension.
