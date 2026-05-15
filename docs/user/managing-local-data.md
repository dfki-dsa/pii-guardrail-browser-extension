# Managing Local Data

Privacy Guardrail stores its data in Chrome extension local storage for your browser profile. The project does not collect this data.

## What May Be Stored

Depending on enabled features and usage, local storage can include:

- extension settings
- placeholder maps for supported conversations
- identity vault records
- replacement mode choices
- allowlist and blocklist entries
- local feedback or correction logs

This data can include original sensitive text because placeholder restoration needs a local mapping from placeholders or synthetic values back to the original value.

## Identity Vault

The identity vault keeps consistent replacements across supported conversations and providers. For example, the same name can resolve to the same placeholder or synthetic value on `chatgpt.com`, `chat.openai.com`, `claude.ai`, and `gemini.google.com`.

Vault records are stored locally in the browser profile. They are not placed in Chrome sync storage by this project.

## Feedback Logs

When correction or feedback features are enabled, the extension may keep local records used to adjust detection behavior. These records are local and are not used for training by this project unless you separately create and contribute a sanitized sample outside the extension.

## Clearing Local Data

Use the extension options page for available controls such as clearing feedback, clearing stored mappings, or managing vault records. Removing the extension from Chrome also removes extension-owned local storage for that browser profile.

Before sharing screenshots, bug reports, logs, or exported diagnostics, remove real personal data, secrets, private prompts, private responses, and private documents.

## Export Concepts

Future diagnostics may exist as user-initiated local exports. An export should only leave your browser after you deliberately create it and choose to share it. Public issue reports should use synthetic or sanitized examples.
