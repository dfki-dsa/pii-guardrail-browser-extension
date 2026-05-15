# Detected Categories And Limitations

Privacy Guardrail detects a beta set of structured and free-text personal or sensitive data categories before paste.

Supported beta sites:

- `chatgpt.com`
- `chat.openai.com`
- `claude.ai`
- `gemini.google.com`

## Categories

| Group | Categories |
| --- | --- |
| Identity | `PERSON`, `USERNAME` |
| Contact | `EMAIL`, `PHONE`, `ADDRESS` |
| Financial | `CREDIT_CARD`, `IBAN`, `BANK_ACCOUNT`, `SSN` |
| Network | `IP_ADDRESS` |
| Location | `LOCATION` |
| Password | `PASSWORD` |
| Organization | `ORGANIZATION` |
| Low-signal | `URL`, `DATE`, `MISC` |

Low-signal categories can be noisy and may be disabled by default or tuned in settings.

## What Pattern Detection Handles Best

Pattern recognizers are strongest when the text has a stable format, such as email addresses, credit card numbers, IBANs, IP addresses, and some phone numbers.

## What Local AI Helps With

Local AI can help identify context-sensitive spans such as person names, organizations, addresses, locations, usernames, passwords, and miscellaneous sensitive phrases. It can still miss spans or flag harmless text.

## Known Limits

- Detection can miss sensitive content.
- Detection can flag text that is not sensitive in context.
- Ambiguous words, short names, code, tables, and unusual formatting can reduce quality.
- Local AI can be unavailable, slow, or degraded depending on browser and device resources.
- Restoration depends on local placeholder or vault records and may not handle every response rewrite.
- Unsupported sites are outside the first public beta scope.

Privacy Guardrail supports local review before sending. It does not guarantee perfect detection, prevention, or regulatory compliance.
