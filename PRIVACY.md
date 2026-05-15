# Privacy Policy

Privacy Guardrail is a public beta Chrome extension for local, assistive PII review before text is pasted into supported LLM chat apps.

The extension is designed around local processing. It does not provide a guarantee that all sensitive content will be detected or removed.

## Permanent Privacy Posture

Privacy Guardrail does not include:

- telemetry
- analytics
- automatic remote feedback collection
- automatic crash report upload
- upload of clipboard content
- upload of prompts or responses
- upload of detected entities
- upload of identity maps or vault data
- upload of local feedback logs
- upload of model input

The project does not send pasted text to a remote inference service. Detection runs in the browser using local deterministic recognizers and, when available, local model assets packaged with the extension.

## Local Data

Privacy Guardrail may store local state in Chrome extension storage so that selected replacements can be restored later. This can include placeholder mappings, identity vault entries, settings, and local feedback or correction records where the feature is enabled.

This data is intended to remain local to the browser profile. It is not collected by this project.

## Diagnostics And Training

Future diagnostics may exist only as user-initiated local exports. A diagnostic export must be created deliberately by the user before it can leave the browser.

User content and local feedback logs are not used for training by this project unless a user separately creates and contributes a sanitized sample outside the extension. Do not send real personal data, secrets, private prompts, private responses, or private documents in public issues.

## Supported Beta Scope

The first public beta is scoped to Chrome desktop stable and these supported sites:

- ChatGPT at `chatgpt.com`
- ChatGPT at `chat.openai.com`
- Claude at `claude.ai`
- Gemini at `gemini.google.com`

Other sites are outside the public beta support scope.

## Contact

For public support, use GitHub Issues. For sensitive security or privacy reports, see `SECURITY.md`.
