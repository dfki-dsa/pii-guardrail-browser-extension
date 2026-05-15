# Reporting Issues Safely

Use GitHub Issues for public beta bugs, supported-site compatibility reports, false positives, false negatives, documentation problems, feature requests, and questions.

Do not post real personal data, secrets, private prompts, model responses, private documents, screenshots containing private content, or confidential logs in public issues.

## Use Synthetic Or Sanitized Examples

Good public examples use fake values:

```text
Please email Jordan Park at jordan.park@example.test about invoice INV-12345.
```

Avoid examples copied from real conversations, customer records, internal tickets, documents, or emails. If the exact format matters, recreate the shape with fake names, fake domains, fake identifiers, and fake prose.

## Include Context

For reproducible reports, include:

- Chrome version
- operating system
- Privacy Guardrail version
- supported site: `chatgpt.com`, `chat.openai.com`, `claude.ai`, or `gemini.google.com`
- whether Local AI was ready, unavailable, off, loading, or failed
- whether the issue happened during paste review, placeholder insertion, or restoration
- synthetic text that demonstrates the issue

## Sensitive Reports

Report security or privacy issues privately using `SECURITY.md`. This includes anything that might expose clipboard content, prompts, responses, detected entities, placeholder maps, identity vault data, feedback logs, or model input.

## Public Beta Expectations

Privacy Guardrail is assistive local review software. Issue reports should not assume perfect detection, prevention of disclosure, regulatory compliance, or support for sites outside the public beta scope.
