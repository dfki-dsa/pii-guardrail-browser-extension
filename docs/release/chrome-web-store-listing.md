# Chrome Web Store Listing Copy

Upload-ready copy and permission justifications for Privacy Guardrail `0.2.0`. The Chrome Web Store upload itself remains manual for the first release — this document only prepares the text and asset references the operator pastes into the Developer Dashboard.

## Item Name

```
Privacy Guardrail
```

## Short Description (≤132 characters)

```
Local review of personal data in your text before pasting into ChatGPT, Claude, or Gemini. No uploads, no telemetry.
```

## Category

```
Productivity
```

## Detailed Description

```
Privacy Guardrail helps you spot personal or sensitive data in text before you paste it into a supported chat assistant. All detection runs locally in your browser. Nothing you type, paste, review, or correct is uploaded to any server by this extension.

Developed at the German Research Center for Artificial Intelligence (DFKI), Forschungsbereich Data Science und ihre Anwendungen.

This is a public beta. 

Detection is assistive: it helps you catch things, but it will not catch everything and it is not a compliance or data-loss-prevention product.

What it does
- Intercepts pastes on supported chat sites and offers a local review step.
- Highlights potentially personal or sensitive spans such as names, emails, phone numbers, addresses, IBANs, credit card numbers, IP addresses, organizations, and locations.
- Lets you accept or ignore each detected span and inserts typed placeholders for the spans you accept.
- Keeps a local identity vault so the same value gets the same placeholder across a conversation, and supports restoration where the chat surface allows it — restored values are visually highlighted in the AI response so you can see what was filled back in.
- Combines fast pattern recognizers with an optional local AI model that runs entirely in your browser (WebGPU when available, CPU/WASM otherwise).
- Falls back to a clearly degraded pattern-only mode when local AI is unavailable, instead of silently pasting unchecked text.

Supported sites (Chrome desktop stable)
- chatgpt.com
- chat.openai.com
- claude.ai
- gemini.google.com

Generic or custom websites are not supported.

System requirements
- Chrome desktop stable (latest).
- Recommended: 16 GB RAM or more and a WebGPU-capable GPU for smooth Local AI detection.
- Minimum for Local AI: more than 8 GB browser-reported memory. On 8 GB or less the extension automatically disables Local AI and runs pattern-only detection. Between 8 GB and 14 GB Local AI stays on but a slowdown warning may appear.
- Without WebGPU, Local AI falls back to slower CPU/WASM execution.
- Pattern-only detection runs on any supported Chrome system.

Privacy posture
- No telemetry. No analytics. No automatic remote feedback collection.
- No upload of clipboard text, prompts, responses, detected entities, identity maps, vault data, or feedback logs.
- The local AI model and runtime are packaged with the extension; no remote model fetch.
- Settings, identity vault, allow/block lists, and local feedback logs are stored only in Chrome extension storage on your device.

Known limitations
- Detection can miss sensitive content and can flag harmless text.
- Short names, ambiguous words, code blocks, tables, and unusual formatting reduce detection quality.
- Local AI can be slow or unavailable depending on browser and device resources; pattern-only mode covers a narrower set of categories.
- Restoration depends on local placeholder records and may not handle every response rewrite.

Open source and reporting
- Source code: https://github.com/dfki-dsa/pii-guardrail-browser-extension
- Privacy notes: https://github.com/dfki-dsa/pii-guardrail-browser-extension/blob/main/PRIVACY.md
- Support: https://github.com/dfki-dsa/pii-guardrail-browser-extension/blob/main/SUPPORT.md
- Security and privacy reports: https://github.com/dfki-dsa/pii-guardrail-browser-extension/blob/main/SECURITY.md
- Sensitive security or privacy reports: pii@dfki.de

Please file public bug, false-positive, false-negative, and site-compatibility reports through GitHub Issues using only synthetic or sanitized examples. Do not include real personal data, secrets, or private prompts in public reports.
```

## Single Purpose Statement

```
Provide local, in-browser review of personal or sensitive data in text before it is pasted into supported large-language-model chat sites (ChatGPT, Claude, Gemini), without sending any text off-device.
```

## Permission Justifications

These match the manifest after the permission audit (`docs/release/chrome-permissions.md`). Paste each justification into the corresponding Developer Dashboard field.

### `storage`

```
Stores user settings, the local identity vault used to keep the same placeholder for the same value across a conversation, allow/block lists, local feedback logs, and local system compatibility state in Chrome extension storage. No data leaves the device.
```

### `offscreen`

```
Runs the local PII detection model in an offscreen extension document. Manifest V3 service workers cannot host the long-lived WebAssembly/ONNX runtime needed for in-browser inference, so an offscreen document is required to keep all detection on-device.
```

### `tabs`

```
Used for visible extension workflows: opening Privacy/Support/Security and Options pages from the popup, broadcasting settings changes to open supported chat tabs so review behavior stays consistent, and updating the toolbar icon to reflect whether the current tab is a supported site.
```

### Host permission justification (one combined entry)

```
The extension only acts on four supported chat sites: chatgpt.com, chat.openai.com, claude.ai, and gemini.google.com. Host access is required to inject the paste-interception content script, the local review banner, and to expose packaged WebAssembly/ONNX runtime and model assets to those pages so detection can run locally. No other websites are matched, and no broad <all_urls> access is requested.
```

### Remote code use

```
None. The extension does not load remote code. The local AI model and ONNX Runtime Web assets are packaged inside the extension. Content Security Policy is "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'".
```

## Privacy Practices Disclosures

For the Developer Dashboard "Privacy practices" section.

- Personally identifiable information: **Not collected.** All detection runs locally; no user content is transmitted by the extension.
- Health information: **Not collected.**
- Financial and payment information: **Not collected.** Card numbers and IBANs may be detected locally, but are never transmitted by the extension.
- Authentication information: **Not collected.** Detected passwords or tokens are flagged locally only.
- Personal communications: **Not collected.** Pasted prompt text is processed locally and not transmitted.
- Location: **Not collected.**
- Web history: **Not collected.**
- User activity: **Not collected.**
- Website content: **Not collected.** The extension reads paste events on supported sites only for local review and never transmits the content.

Certify all three required statements:

- I do not sell or transfer user data to third parties outside of the approved use cases.
- I do not use or transfer user data for purposes unrelated to the item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Support And Privacy Links

| Field | URL |
|---|---|
| Homepage URL | `https://github.com/dfki-dsa/pii-guardrail-browser-extension` |
| Support URL | `https://github.com/dfki-dsa/pii-guardrail-browser-extension/blob/main/SUPPORT.md` |
| Privacy policy URL | `https://github.com/dfki-dsa/pii-guardrail-browser-extension/blob/main/PRIVACY.md` |
| Security reporting | `https://github.com/dfki-dsa/pii-guardrail-browser-extension/blob/main/SECURITY.md` |
| Sensitive contact | `pii@dfki.de` |

## Screenshots And Promo Tiles

Screenshots are produced under slice 14 using the operator capture workflow in `docs/release/screenshot-script.md`, the prompts in `docs/release/synthetic-prompts.md`, and the frame list in `docs/release/screenshot-shot-list.md`. The first public beta captures on real supported sites with synthetic prompts only and strict redaction. Do not upload screenshots that show real user accounts, real prompts, real responses, real personal data, browser profile names, or internal project paths.

Required visuals before submission:

- At least three 1280×800 or 640×400 screenshots from the synthetic set.
- Optional small (440×280) and marquee (1400×560) promo tiles, only if available from the synthetic-screenshot workflow.

### Logo asset-to-slot mapping

Brand asset sources live under `docs/assets/`. The Developer Dashboard does not theme uploaded images, so all store assets use the **dark-on-light** variants (`*-black.png`). The product logo and the DFKI logo must read as **separate marks**, never visually merged.

| Store slot | Asset(s) | Notes |
|---|---|---|
| 128×128 store icon | `dist/icons/icon-128.png` (shield only) | wordmark would be unreadable at this size; do not use the combined logo here. |
| Small promo tile (440×280) | `docs/assets/logo-privacy-guardrail-by-dfki-black.png` on a light background | the "by DFKI" variant exists precisely for this slot — there is no room to place two separate marks. |
| Large promo tile (920×680) and marquee (1400×560) | `docs/assets/logo-privacy-guardrail-black.png` aligned left; `docs/assets/dfki_Logo_digital_black.png` aligned right | match the README hero treatment: separate marks, no connecting glyph or shared frame. |
| Screenshots (1280×800) | DSA badge (`docs/assets/dsa-logo.png`) + DFKI mark in a small footer strip, **only on the "credits/about" screenshot** | do not stamp affiliation logos on every screenshot — reviewers and users read it as noise. |

Variant selection rules:

- Use `logo-privacy-guardrail-by-dfki-*.png` **only** where the DFKI logo cannot also appear independently (e.g. the small promo tile, favicons, anywhere ≤ ~500 px wide).
- Use `logo-privacy-guardrail-*.png` (without "by DFKI") whenever the DFKI logo is shown separately on the same surface.
- DSA logo is dark-only and is treated as a badge; keep it small (≤ 40 px tall) and only in attribution contexts.

## Pre-Submission Checklist

- [ ] `manifest.json` version equals the released `0.2.0` artifact (`npm run version:check -- 0.2.0 --require-tag`).
- [ ] Uploaded ZIP is the exact artifact built by `npm run package:release` and matches the published SHA-256 checksum.
- [ ] Listing only references the four supported sites and does not advertise generic or custom site support.
- [ ] Permission justifications match the audited manifest in `docs/release/chrome-permissions.md`.
- [ ] Privacy policy and Support URLs resolve on the public GitHub repo.
- [ ] Screenshots are from the synthetic set only (slice 14).
- [ ] Sensitive-report email is `pii@dfki.de`.
