# Local AI Explained

Privacy Guardrail has two local detection layers:

- deterministic pattern recognizers for structured values such as emails, credit cards, IBANs, IP addresses, and similar formats
- optional Local AI for context-sensitive text such as names, locations, organizations, addresses, usernames, passwords, and miscellaneous sensitive fragments

Both layers run in the browser. The project does not send pasted text to a remote inference service.

## Local AI

The public beta package uses local model assets bundled with the extension when Local AI is available. Chrome loads the model in the extension runtime and runs inference locally through ONNX Runtime Web.

Local AI may use WebGPU when Chrome and the device support it. If WebGPU is unavailable, the extension can use a CPU/WASM path. The CPU/WASM path can be slower, especially on large pastes or lower-memory devices.

## System Requirements

Local AI inference is resource-intensive. The extension checks the browser-reported memory and WebGPU availability passively and adapts:

- **Recommended:** at least 16 GB of RAM and a WebGPU-capable GPU. This is the smooth-experience target.
- **More than 8 GB and up to 14 GB:** Local AI stays on, but a slowdown warning is surfaced. The 14 GB threshold gives some leeway below the 16 GB recommendation so most modern laptops are not flagged unnecessarily.
- **8 GB or less:** the extension automatically disables Local AI on this run to avoid exhausting browser resources. Pattern detection continues to run. You can override this from the options page if you accept the risk of browser slowdowns.
- **No WebGPU:** Local AI falls back to a CPU/WASM execution path. It still runs locally, just more slowly.
- **Pattern-only detection** does not need WebGPU and is not affected by the memory thresholds.

The browser only reports memory in coarse buckets, so these checks are heuristic. Real-world performance also depends on what else the browser and operating system are doing.

## Pattern-Only Fallback

If Local AI is off, unavailable, still loading, or failed, deterministic pattern detection can still run. Pattern-only mode is useful for structured identifiers but has weaker coverage for free-text entities.

Examples that pattern detection is better suited for:

- email addresses
- phone numbers
- credit card numbers
- IBANs
- IP addresses

Examples that may need Local AI or user review:

- person names
- organization names
- postal addresses
- ambiguous locations
- sensitive phrases without a fixed format

## Degraded States

The extension surfaces Local AI state in the popup, options page, and supported-page status UI. A degraded state can mean:

- Local AI was turned off by the user.
- Chrome or the device cannot load the model safely.
- The model failed to load.
- The browser is using a slower CPU/WASM fallback.

When protection is degraded, treat the review as pattern-only or partial and inspect the pasted text manually.

## Limits

Local AI is assistive. It can miss sensitive text, flag harmless text, or behave differently across languages, formatting, and context. Privacy Guardrail does not guarantee complete detection, prevention of disclosure, or regulatory compliance.
