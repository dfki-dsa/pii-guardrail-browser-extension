# Local AI Explained

Privacy Guardrail has two local detection layers:

- deterministic pattern recognizers for structured values such as emails, credit cards, IBANs, IP addresses, and similar formats
- optional Local AI for context-sensitive text such as names, locations, organizations, addresses, usernames, passwords, and miscellaneous sensitive fragments

Both layers run in the browser. The project does not send pasted text to a remote inference service.

## Local AI

The public beta package uses local model assets bundled with the extension when Local AI is available. Chrome loads the model in the extension runtime and runs inference locally through ONNX Runtime Web.

Local AI may use WebGPU when Chrome and the device support it. If WebGPU is unavailable, the extension can use a CPU/WASM path. The CPU/WASM path can be slower, especially on large pastes or lower-memory devices.

## Model Precision

The model picker in the popup and options page offers two builds of the detection model:

- **q4f16 (default):** a compact 4-bit model that keeps Local AI around 1 GB of RAM while loaded. This is also the CPU/WASM fallback model.
- **fp16:** the full-precision WebGPU model. It uses slightly more RAM and roughly twice the GPU memory for slightly better detection of some structured values.

The fp16 choice only applies on the GPU path; the CPU/WASM fallback uses q4f16. Switching the precision reloads Local AI immediately so the change takes effect right away.

## Loading And Unloading

Local AI is not the same thing as the Local AI runtime. The setting controls whether the model-backed detection layer is allowed to run; the runtime is the loaded in-browser model execution environment.

When Local AI is turned off, Privacy Guardrail unloads the Local AI runtime so Chrome can reclaim those resources. Pattern detection remains active.

When Local AI is on, the runtime may be loaded by a paste scan, an explicit warmup action, the popup on capable systems, or supported-page activity on capable systems. A capable system currently means:

- browser-reported memory is greater than 14 GB
- passive WebGPU availability is detected
- the runtime is not known to be using CPU/WASM fallback

The extension keeps an already-loaded runtime resident while the user is active on a foreground supported chat page. Activity is lightweight and local: keyboard input, paste, pointer/touch interaction, scroll, focus, and visibility changes are reduced to a throttled in-memory signal. Background tabs do not keep Local AI loaded.

By default, the runtime unloads after 10 minutes of inactivity. The options page lets you choose 1, 5, 10, or 30 minutes, or keep it for the browser session. Automatic warmup on capable active supported pages is enabled by default and can be turned off in options.

## System Requirements

Local AI inference is resource-intensive. The extension checks the browser-reported memory and WebGPU availability passively and adapts:

- **Recommended:** at least 16 GB of RAM and a WebGPU-capable GPU. This is the smooth-experience target.
- **More than 8 GB and up to 14 GB:** Local AI stays on, but a slowdown warning is surfaced. The 14 GB threshold gives some leeway below the 16 GB recommendation so most modern laptops are not flagged unnecessarily.
- **8 GB or less:** the extension automatically disables Local AI on this run to avoid exhausting browser resources. Pattern detection continues to run. You can override this from the options page if you accept the risk of browser slowdowns.
- **No WebGPU:** Local AI falls back to a CPU/WASM execution path. It still runs locally, just more slowly.
- **Pattern-only detection** does not need WebGPU and is not affected by the memory thresholds.

The browser only reports memory in coarse buckets, so these checks are heuristic. Real-world performance also depends on what else the browser and operating system are doing.

Chrome does not expose reliable production GPU-memory information to the extension. Some WebGPU memory details exist only behind developer flags, so Privacy Guardrail does not use GPU-memory thresholds for Windows or other platforms today. On Apple silicon, system and GPU memory are shared, so the browser-reported memory threshold is the practical guardrail.

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
