# Public Beta Smoke Test Checklist

Run this checklist before tagging a public beta release for `git@github.com:dfki-dsa/pii-guardrail-browser-extension.git`. Use only synthetic data. Do not paste real personal data, secrets, private prompts, private responses, or private documents.

## Environment

Record:

- Extension version:
- Git commit:
- Chrome desktop stable version:
- Operating system:
- Build type: model-free / strict BardsAI package
- Local AI state shown by the extension:

Use the same reviewed build artifact that will become the release candidate.

## Synthetic Test Text

Use a short synthetic sample such as:

```text
Please draft a note for Alex Rivera at alex.rivera@example.test. Call +1 415 555 0134 and reference card 4111 1111 1111 1111 only as a fake test value.
```

Replace or extend the sample as needed, but keep all values synthetic.

## Per-Site Matrix

Run the steps below on:

- `chatgpt.com`
- `chat.openai.com`
- `claude.ai`
- `gemini.google.com`

## Steps For Each Site

1. Open the site in Chrome desktop stable.
2. Confirm the extension icon is active for the page.
3. Refresh the site after loading or updating the extension.
4. Paste the synthetic test text into the chat input.
5. Confirm detection starts instead of silently inserting unchecked text.
6. Confirm the cancel path returns control without sending text.
7. Paste again and open the review overlay.
8. Confirm detected spans are visible and categories are understandable.
9. Accept at least one detected span.
10. Ignore at least one detected span for the current paste when multiple spans are available.
11. Confirm placeholders are inserted into the chat input for accepted spans.
12. Confirm ignored spans remain as the original synthetic text for that paste.
13. Submit only if the sample is synthetic and the test account is appropriate for manual validation.
14. Where response restoration is supported, confirm placeholders in the response can be restored from the local map.
15. Confirm the Local AI or degraded-protection state shown by the extension matches the build and system state.
16. Open the page console and extension service worker console.
17. Confirm there are no new extension errors during paste, review, insertion, submission, or restoration.

## Degraded And Failure Checks

Run at least one validation pass with Local AI unavailable or disabled, if the build supports that state:

- The user sees a clear degraded-protection state.
- The extension does not silently claim full Local AI protection.
- Pattern-based detection still works for obvious synthetic values.
- The user can make an informed paste decision.

## Restoration And Site-Adapter Checks

Restoration no longer depends on knowing each site's conversation addresses,
and every fallback that replaced that knowledge succeeds quietly — see
`docs/adr/0001-conversation-scope-from-evidence.md`. Nothing in the field
reports that a site has moved, so these checks are where it is caught.

### Refresh the captured DOM fixtures

Before tagging, refresh `tests/fixtures/site-dom/` from a live page on each
supported site and run `npm test`. The procedure and the redaction rules are
in `tests/fixtures/site-dom/README.md`. Record the capture date and client
build in the table there.

A fixture that no longer matches is the signal to update the adapter. A
fixture that still matches is the only evidence a release has that the
adapters are current.

### Diagnostic probes

Run these with **Debug** enabled in extension settings, on each supported
site, with the page console open. All of them exist today; the point of the
pass is that a release looks at them.

1. Paste and accept a replacement in a new chat, then send. Confirm a debug
   line reporting tokens moved to the conversation's new address.
2. Reload the page. Confirm the reveal banner still offers the same count.
3. Switch to another conversation and back. Confirm a debug line reporting the
   tab ledger cleared on the switch, and that the reveal banner returns.
4. Set the console to show **Verbose** and look for
   `is on this page but no original is known for it`. Any such line names a
   placeholder the user can see and the extension will not resolve.
5. Open the popup on each site. Confirm it does **not** show the generic-match
   line — that line means the site's markup has moved and the adapter needs
   updating before release.
6. Confirm the page status chip shows no "Message box not recognized" state
   after a paste on any supported site.
7. Check the page console for new extension errors across all of the above.

Record any site where step 5 or 6 fires: that is adapter rot, and it ships as
degraded protection unless the adapter is fixed first.

## Local AI Release Readiness Matrix

These checks are blockers for the public beta and pair with the automated
suite in `tests/release/local-ai-release-readiness.test.ts`. Reproduce each
scenario on a loaded extension build and confirm the documented surface.

| Scenario | Setup | Expected popup status | Expected page chip / banner | Detection invariant |
|---|---|---|---|---|
| Successful warmup | OK tier, WebGPU available, Local AI on | No status pill (quiet OK) or "Local AI ready" | No degraded chip | Local AI + pattern spans visible in review overlay |
| Failed warmup | Inject load failure via Debug System Check | "Local AI failed to load" with Retry | "Local AI model failed to load" with retry guidance | Pattern detection still runs; no silent unchecked paste |
| Retry after failure | Use options-page Retry button | Transitions to loading → ready (or back to failed with new reason) | Chip clears after successful retry | After ready, full Local AI + pattern detection resumes |
| CPU/WASM fallback | Force WebGPU off, allow model to load | "Local AI is running on CPU" warning | "Local AI is running on CPU" | Detection proceeds, slower than usual is acceptable |
| Auto-disable on critical memory | Simulate critical tier on first install | "Low memory protection mode" critical | "Low memory protection mode" after the one-time modal | Pattern detection remains active; Local AI is off |
| Local AI off by user choice | Toggle Local AI off in popup or options | "Local AI detection off" info | "Pattern detection only" | Pattern detection remains active; no model load occurs |

For each scenario also confirm:

- The popup never claims full Local AI protection while Local AI is off,
  auto-disabled, failed, or in CPU/WASM fallback.
- The supported-page chip surfaces the same degraded state where applicable.
- No NER model fetch or load is triggered when Local AI is off.
- The service worker and offscreen consoles show no new errors.

## Result

For each supported site, record:

- Pass/fail.
- Local AI state.
- Any console errors.
- Any unsupported DOM or paste behavior.
- Whether the issue blocks public beta release.

Public bug reports must use synthetic or sanitized reproduction steps only.
