# GitHub Repo Settings Checklist

Use this checklist when preparing the public GitHub repository at
`https://github.com/dfki-dsa/pii-guardrail-browser-extension`.

This project keeps repository settings as a manual release task for the first
public beta. Do not run account automation or scripts to create labels, change
branch protection, enable vulnerability reporting, or publish releases as part
of the issue-template slice.

## Issue Templates

The public repository should include issue forms for:

- Bug report.
- Site compatibility report.
- False positive.
- False negative.
- Feature request.
- Docs issue.
- General question.

Every issue form must tell reporters not to paste real personal data, secrets,
private prompts, model responses, private documents, screenshots with account
details, or confidential logs. False positive and false negative reports should
ask for synthetic or sanitized examples plus supported site, Chrome version,
extension version, and Local AI state.

Site compatibility reports are limited to the public beta scope:

- Chrome desktop stable.
- ChatGPT at `chatgpt.com` and `chat.openai.com`.
- Claude at `claude.ai`.
- Gemini at `gemini.google.com`.

## Manual Labels

Create these labels manually in the public repository:

| Label | Purpose |
|---|---|
| `bug` | Confirmed or likely product defect. |
| `site-compatibility` | Supported-site behavior, selector, UI, or workflow compatibility. |
| `false-positive` | Safe text was flagged as sensitive incorrectly. |
| `false-negative` | Sensitive synthetic/sanitized text was missed. |
| `docs` | Documentation fixes or additions. |
| `question` | Usage, project, or support questions. |
| `good-first-issue` | Genuinely small, low-risk, well-scoped work only. |
| `needs-repro` | More reproduction detail is needed before action. |
| `accepted` | Maintainers accepted the issue for implementation. |
| `blocked` | Work is blocked by an external dependency or earlier slice. |
| `wontfix/privacy-policy` | Declined because it conflicts with the no-telemetry/no-content-upload privacy policy. |

Reserve `good-first-issue` for changes that can be implemented without broad
architecture knowledge, account access, security-sensitive handling, or large
behavior changes.

## Manual Repository Settings

- Enable private vulnerability reporting.
- Require CI on the protected default branch once CI is added.
- Require at least one review for external pull requests.
- Protect `v*` tags if GitHub repository settings support tag protection.
- Keep Chrome Web Store upload manual for the first public beta.
