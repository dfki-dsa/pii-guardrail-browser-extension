# How To Use Privacy Guardrail

Privacy Guardrail reviews pasted text locally before it is inserted into a supported LLM chat page.

Supported beta sites:

- `chatgpt.com`
- `chat.openai.com`
- `claude.ai`
- `gemini.google.com`

## Paste Review

1. Copy text you want to paste.
2. Paste into a supported chat input.
3. If the paste is long enough to scan, Privacy Guardrail checks it locally.
4. Review the detected spans before insertion.
5. Keep the spans you want anonymized and ignore spans you do not want changed.
6. Confirm the reviewed paste.

When no supported span is found, the extension allows the paste without showing the full review overlay.

## Auto-replace

If you paste often and do not want to confirm each time, turn on **Auto-replace** in the extension popup under **Settings → Behavior**. It is off by default.

With Auto-replace on:

1. Paste into a supported chat input as usual.
2. Detected items are replaced straight away, with no review overlay. The items replaced are the ones the review would have pre-selected, so text inside code blocks you chose to skip is left alone.
3. A notice appears for a few seconds with two buttons:
   - **Undo** puts your original text back. Nothing is replaced.
   - **Review** opens the review overlay for that paste. What you confirm there replaces the text in the message box. Closing the overlay keeps the automatic replacement.
4. If you ignore the notice, the replacement stays.

Undo and Review only work while the replaced text is still in the message box as it was inserted. If you have edited or sent it, the notice tells you that nothing was changed.

Auto-replace acts on pasted text only, and detection can miss things or replace something harmless. Read the message before you send it.

## Placeholders

Accepted spans are replaced with typed placeholders such as:

```text
[EMAIL_1]
[PERSON_1]
[CREDIT_CARD_1]
```

The placeholder map is stored locally so that supported responses can be restored later. Placeholder numbering is stable for the local identity vault where the same original value is reused.

## Ignoring Detections

The review UI lets you ignore a detection for the current paste when it is not sensitive in context. Ignored text is pasted unchanged.

For repeated false positives, use the extension settings to add allowlist entries or adjust category sensitivity.

## Restoration

On supported chat pages, Privacy Guardrail watches model responses for placeholders and restores known originals locally where supported. Restoration depends on the local placeholder or vault record still being available. If the model rewrites a placeholder heavily, restoration may be incomplete.

## Canceling A Scan

If a scan is taking too long, use the cancel control. Depending on your settings, the extension may ask whether to paste the original text or drop the pending paste.

Privacy Guardrail is an assistive beta tool. Review the final text yourself before sending it.
