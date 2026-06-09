# Security Policy

Privacy Guardrail is a public beta. Please report suspected security or privacy issues privately before opening a public issue.

## Private Reporting

Send sensitive reports to `pii@dfki.de`.

Include:

- a short description of the issue
- affected version or commit
- browser and operating system
- steps to reproduce using synthetic or sanitized data
- whether the issue could expose clipboard content, prompts, responses, detected entities, placeholder maps, vault data, feedback logs, or model input

Do not include real personal data, secrets, private prompts, private responses, or private documents.

## Public Issues

GitHub Issues are **public** — anything you post is visible to anyone. Use them only for
non-sensitive bugs, compatibility reports, documentation issues, and feature requests.

**Do not post** real personal data, confidential documents, real prompts or responses,
screenshots containing real data, secrets, or other sensitive content. Keep all examples
**synthetic or sanitized**. For sensitive security or privacy reports, use the private channel
above (`pii@dfki.de`). See `PRIVACY.md` for the full data-protection policy.

## Supported Versions

| Version | Support |
| --- | --- |
| `0.2.x` public beta | Security and privacy reports accepted |
| earlier private/local versions | Not publicly supported |

## Security Expectations

Privacy Guardrail is intended to process supported-site paste content locally in the browser. The project does not include telemetry, analytics, automatic remote feedback collection, or upload of clipboard content, prompts, responses, detected entities, identity maps, vault data, feedback logs, or model input.

The beta is not a compliance product and does not guarantee complete detection or prevention of sensitive-data disclosure.
