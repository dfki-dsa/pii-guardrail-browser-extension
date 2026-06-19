# Troubleshooting

Privacy Guardrail public beta support is scoped to Chrome desktop stable and:

- `chatgpt.com`
- `chat.openai.com`
- `claude.ai`
- `gemini.google.com`

## Extension Looks Inactive

- Confirm the extension is installed and enabled in `chrome://extensions`.
- Refresh the supported chat tab after installing or updating.
- Confirm you are on one of the supported beta sites.
- Open the extension popup and check whether protection is enabled.

## Paste Was Not Reviewed

- Very short pasted text may not trigger a scan.
- Unsupported sites are outside the beta scope.
- Pattern-only mode may find no supported structured spans.
- Category settings, allowlist entries, or sensitivity settings may suppress detections.

## Local AI Is Unavailable Or Failed

- Open the extension popup or options page and check Local AI status.
- Refresh the supported chat tab.
- Try a smaller paste.
- Close unused tabs if Chrome is under memory pressure.
- If Local AI remains unavailable, treat protection as degraded and review the text manually.

Pattern-based detection can still run when Local AI is off or unavailable, but coverage is narrower.

## Local AI Loads Or Unloads Unexpectedly

- On capable systems, Local AI can warm automatically while you are active on a supported chat page. Capable means more than 14 GB browser-reported memory, passive WebGPU available, and no known CPU/WASM fallback.
- Background tabs do not keep Local AI loaded.
- Turning Local AI off unloads the Local AI runtime; pattern detection remains active.
- By default, Local AI unloads after 10 minutes of inactivity. You can change the timeout or disable active-page warmup in options.

## Browser Is Slow

- Wait for the scan to finish or cancel the scan.
- Try pasting a shorter section.
- Close unused tabs or apps.
- Check whether the extension is using CPU/WASM fallback instead of WebGPU.
- If you selected the full-precision (fp16) WebGPU model, switch back to the default 4-bit (q4f16) model in the model picker to reduce memory use.
- If Local AI is still too heavy, turn off active-page warmup or turn Local AI detection off in options. Pattern detection continues to run.

## Unsupported Site Expectations

Privacy Guardrail does not advertise generic or custom site support for the first public beta. If you need support for another site, file a feature request with synthetic examples and explain the workflow without sharing private content.

## Console Error Collection

For a useful bug report:

1. Reproduce the issue with synthetic text.
2. Open Chrome DevTools on the supported chat tab.
3. Check the Console for extension errors.
4. Copy only non-sensitive error text.
5. Remove real personal data, secrets, prompts, responses, private documents, and confidential logs before posting.

Use private security reporting for anything that could expose sensitive data.
