# Chrome Web Store Screenshot Shot List

Authoritative list of frames to capture for the first public beta listing. Pair with [`screenshot-script.md`](./screenshot-script.md) (operator workflow and redaction rules) and [`synthetic-prompts.md`](./synthetic-prompts.md) (the synthetic prompt text).

All screenshots use real supported sites with synthetic prompts only. The redaction rules in `screenshot-script.md` apply to every frame.

## Target Specs

- Format: PNG.
- Size: 1280×800 (preferred) or 640×400. Match Chrome Web Store current requirements at submission time.
- Aspect ratio: 16:10 nominal, no letterboxing.
- File naming: `NN-short-description@WxH.png` with matching `.sha256` sidecar.

## Required Frames

| # | Title | Surface | Prompt | What it must show | Critical redactions |
|---|---|---|---|---|---|
| 01 | Extension active on ChatGPT | `chatgpt.com` page with toolbar visible | None (idle state) | Extension action icon active state, page status chip neutral, no overlay. | Crop sidebar, account avatar, prior chats, tab strip. |
| 02 | Review overlay with synthetic spans | `chatgpt.com` composer | Prompt 01 | Review overlay with detected spans highlighted by category, accept/ignore controls visible, paste content fully synthetic. | Crop sidebar; no assistant response in frame. |
| 03 | Placeholder insertion | `chatgpt.com` composer | Prompt 02 (accept-all flow from Prompt 01) | Composer showing placeholders substituted in the paste. | Crop sidebar; no assistant response in frame. |
| 04 | Review overlay on Claude | `claude.ai` composer | Prompt 03 | Review overlay variant on Claude, category diversity visible. | Crop conversation list, workspace name. |
| 05 | Review overlay on Gemini | `gemini.google.com` composer | Prompt 01 | Review overlay variant on Gemini. | Crop side rail, Google account avatar/name. |
| 06 | Degraded / pattern-only mode | Any supported site composer | Prompt 04 | Pattern-only detection still highlights structured values; page chip / banner shows degraded state. | Crop sidebar; show degraded surface clearly. |
| 07 | Popup — Local AI ready | Extension popup against any supported site or blank tab | None | Popup with Local AI ready state, settings entry points, support links. | Hide profile name in popup if shown. |
| 08 | Popup — Local AI failed with retry | Extension popup (forced via Debug System Check) | None | Popup showing "Local AI failed to load" with retry CTA. | None beyond default redactions. |
| 09 | Options page — system compatibility | Extension options page | None | System compatibility card showing Local AI status, retry, and degraded states explanation. | None beyond default redactions. |
| 10 | Public support links | Extension popup / options public support card | None | Visible "Report issue", "Report security/privacy issue", "Privacy/support" links to GitHub-hosted docs. Confirms transparency posture. | None beyond default redactions. |

## Optional Frames

| # | Title | Notes |
|---|---|---|
| O1 | De-anonymization banner / restoration | Capture only if a synthetic assistant response containing the same placeholders can be staged cleanly. Otherwise skip. |
| O2 | Critical low-memory protection mode | Forced via Debug System Check. Use only if Chrome Web Store listing copy references it explicitly. |
| O3 | CPU/WASM fallback warning | Forced via Debug System Check. Use only if a slot remains in the listing. |

## Per-Frame Operator Checklist

For each captured frame, record before saving:

- Frame ID and title from the table above.
- Site (`chatgpt.com`, `chat.openai.com`, `claude.ai`, `gemini.google.com`) or extension surface (popup, options).
- Prompt ID from `synthetic-prompts.md` (or "none" for idle/UI shots).
- Local AI state shown at capture time.
- Chrome version and operating system.
- Extension build commit and `manifest.json` version.
- All redaction rules from `screenshot-script.md` confirmed.

Reject any frame that fails the redaction or synthetic-data rules and recapture instead of editing the image.

## Output

Save reviewed final frames to a local staging directory (`screenshots/staging/` recommended; not committed). The Chrome Web Store submission slice picks reviewed PNGs from staging at upload time. No screenshot is committed to the public Git repository by default; the listing assets stay out of Git unless the operator explicitly reviews and approves a public asset.
