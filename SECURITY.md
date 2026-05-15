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

Use public GitHub Issues for non-sensitive bugs, compatibility reports, documentation issues, and feature requests. Keep examples synthetic or sanitized.

## Supported Versions

| Version | Support |
| --- | --- |
| `0.2.x` public beta | Security and privacy reports accepted |
| earlier private/local versions | Not publicly supported |

## Security Expectations

Privacy Guardrail is intended to process supported-site paste content locally in the browser. The project does not include telemetry, analytics, automatic remote feedback collection, or upload of clipboard content, prompts, responses, detected entities, identity maps, vault data, feedback logs, or model input.

The beta is not a compliance product and does not guarantee complete detection or prevention of sensitive-data disclosure.
