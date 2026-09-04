# Changelog

All notable public changes to Privacy Guardrail will be documented in this file.

The project follows public beta release notes for `0.x` versions.

## Unreleased

- Privacy Guardrail now recognizes a chat by what is on the page instead of by its web address. It used to carry a list of what a conversation's address looks like on each site, and a site quietly changing that shape was enough to lose your replacements — which happened twice in two releases. A replacement is now filed under a conversation when it is actually seen in that conversation's messages, so a site renaming a chat, redesigning its pages, or serving you a different layout no longer costs you anything. This also works on chat sites the extension has no specific knowledge of.
- Placeholders that come back unchanged can now be restored even when Privacy Guardrail has no record of the conversation at all. Previously a chat it had lost track of offered nothing; the worst case is now that placeholders the AI has garbled — different capitalization, missing brackets — are not offered, while intact ones still are.
- Privacy Guardrail now reviews pastes on a chat page even when it no longer recognizes the site's message box, by using the box you actually pasted into. It used to let those pastes through unreviewed. The popup says quietly when it is working this way, so you can tell that something about the site has changed, and the stronger on-page warning is now reserved for pastes that genuinely were not reviewed.
- The reveal banner now appears on replies even when a site has changed how it marks them up, and its count grows as Privacy Guardrail recognizes more of the conversation instead of being fixed at the moment the banner appeared. Reveal never writes into the message box or any other field you can type in.
- Privacy Guardrail no longer stores your original values against a conversation. What it remembers about a conversation is now only which replacements were used in it; the original values live solely in the identity vault, where the options page lets you see and edit them. A conversation recorded against the wrong page can no longer reveal anything.
- With cross-session memory switched off, no original values are written to durable storage at all. They previously went to a store with no way to inspect them, which meant the setting relocated your data rather than stopping it being kept. Restoration still survives reloading a page and moving between conversations for as long as the browser is open, and nothing outlives the browser session.
- Conversations recorded by earlier versions keep working after the update. Nothing is migrated, rewritten or deleted, and conversations broken by the previous address matching start working again as soon as their placeholders are seen on the page.
- Fixed pastes not being reviewed on chat pages whose message box is inside an encapsulated editor, which read as no message box at all.
- Fixed reviewed text being inserted in the wrong place, or lost, when a site rebuilt its page while the review was running. It now goes back to the box the paste came from.
- Fixed replaced values being forgotten on ChatGPT, in the layout ChatGPT now also serves to signed-in users on the desktop. Version 0.4.2 fixed this for the classic layout, but the newer one gives a conversation a web address of a different shape, which the extension did not recognize as a conversation at all. Sending the first message therefore looked like a switch to a different chat: the replacements recorded while composing were discarded instead of moved across, so replies came back with placeholders that could no longer be turned back into your original values. Beyond the missing reveal, this also reset the numbering, so a later paste in the same chat could reuse a label such as the first person placeholder for a different person. Chats started before this fix still have their replacements filed under the "new chat" screen, but they are no longer lost: intact placeholders in those chats are recognized again from the identity vault.

## [0.4.2] - Public Beta

- Fixed replaced values being forgotten once a new chat got its own address. Starting a chat, pasting something that was replaced and sending it moves the page from the "new chat" screen to the conversation's own URL, and the replacements stayed filed under the screen you left — so after a reload the reply could no longer be turned back into your original values. They now move with the conversation, and switching between existing chats without a page reload loads the right conversation's replacements.
- Fixed the reveal banner missing replies that arrive in bursts. A reply that paused mid-stream for longer than half a second was only inspected up to that pause, and a reply that was still empty when first checked was written off for good — in both cases the replaced values that arrived afterwards were never offered for reveal.
- Fixed Privacy Guardrail not recognizing the message box on ChatGPT when signed out, so no review was offered before pasting. That ChatGPT layout renders the message box as a plain text field instead of the rich editor the extension was built against. Both layouts are now recognized, and pasting keeps the cursor where you left it in either.
- Fixed the de-anonymization banner not appearing on ChatGPT replies in that same layout.
- Fixed chat sites added by a later release staying inactive for existing installs. The list of supported sites is kept in your settings, and once it had been written it was never reconciled with the sites a newer version knows about — so on a newly supported site the toolbar icon stayed inactive and Local AI never warmed up, while pastes were still reviewed. Updating now adds the sites a release brings with it, without dropping anything already in the list.
- Privacy Guardrail now tells you when it cannot find a chat page's message box. Chat sites change their layout, and when one changes enough that the extension no longer recognizes where you type, pastes went through without review while the extension still looked healthy. Pasting into a page it cannot attach to now shows a warning on the page and a status note explaining that pastes there are not reviewed, until reloading the page restores it.
- Privacy Guardrail now tells you when it has switched itself off. If it fails to start on a page, pastes are no longer reviewed for the rest of that page's visit, and it previously gave no sign of this at all — so you could keep pasting while believing you were covered. It now shows a warning on the page and asks you to reload.
- Renamed the **Intercept clipboard** setting to **Intercept copy**. It only ever governed the offer to restore original values when you copy text out of a chat; it never affected the review of text you paste, which follows the master protection toggle. The old name suggested it covered both directions.
- The privacy policy now has a Clipboard Access section spelling out when the extension reads or writes clipboard content, that it holds no clipboard permissions, and that it runs only on the supported chat sites.

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
