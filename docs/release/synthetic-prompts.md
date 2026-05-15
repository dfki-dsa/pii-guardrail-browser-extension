# Synthetic Prompts For Screenshots

Copy-pasteable synthetic prompts for Chrome Web Store screenshot capture. Every value below is fake. Do not edit these prompts with real personal data before capture. If a future screenshot needs new categories, extend the table using the same synthetic-only rules.

## Synthetic Identity Pool

Use values from this pool only. Do not introduce real people, real accounts, or real organizations.

| Category | Synthetic values |
|---|---|
| Person name | `Alex Rivera`, `Jordan Park`, `Sam Okafor` |
| Email | `alex.rivera@example.test`, `jordan.park@example.test`, `sam.okafor@example.test` |
| Phone | `+1 415 555 0134`, `+44 20 7946 0958`, `+49 30 5550 1234` |
| Postal address | `742 Evergreen Terrace, Springfield, IL 62701`, `1 Sample Street, London EC1A 1AA` |
| Test card | `4111 1111 1111 1111` (declared as a fake test card in every prompt) |
| Test IBAN | `DE89 3704 0044 0532 0130 00` (test BBAN, do not present as a real account) |
| Generic identifier | `Order #SAMPLE-00042`, `Ticket SAMPLE-1024` |
| Placeholder examples | `[EMAIL_1]`, `[PERSON_1]`, `[PHONE_1]`, `[CARD_1]` |

`example.test` and `555` phone numbers are reserved for documentation and are safe to use. The card and IBAN values are widely published test values; in every captured prompt the surrounding text must call them out as fake test values, not as real account data.

## Prompt 01 — Short Mixed PII

Use for the primary detection/review-overlay shot on any supported site.

```text
Draft a short reply for Alex Rivera at alex.rivera@example.test. Their callback number is +1 415 555 0134. Reference fake test card 4111 1111 1111 1111 only as a synthetic example.
```

Expected detections: person name, email, phone, test card number.

## Prompt 02 — Placeholder Insertion

Use for the "placeholders inserted into composer" shot. Paste prompt 01, accept all detected spans in the review overlay, then capture the composer with placeholders inserted.

Expected composer content after accept-all (illustrative; exact placeholders depend on the active replacement mode):

```text
Draft a short reply for [PERSON_1] at [EMAIL_1]. Their callback number is [PHONE_1]. Reference fake test card [CARD_1] only as a synthetic example.
```

## Prompt 03 — Mixed Categories With Address

Use for a second review-overlay variant that shows category diversity.

```text
Please summarize the case file for Jordan Park (jordan.park@example.test). Their mailing address is 742 Evergreen Terrace, Springfield, IL 62701 and their phone is +44 20 7946 0958. Treat the order number Order #SAMPLE-00042 as the only reference.
```

Expected detections: person name, email, address, phone, generic identifier.

## Prompt 04 — Degraded / Pattern-Only Detection

Use when capturing the "Local AI off" or "Local AI failed" state to show that pattern-only detection still catches structured values.

```text
Send the confirmation to sam.okafor@example.test and call +49 30 5550 1234 if needed. The fake test card 4111 1111 1111 1111 is for example purposes only.
```

Expected detections under pattern-only fallback: email, phone, card number. Person name may or may not be highlighted depending on the active pattern rules; that is the point of the screenshot.

## Prompt 05 — Short Single-Entity

Use for tight crops of the review overlay where only one span needs to be visible.

```text
Please call Alex Rivera back today.
```

Expected detection: single person-name span.

## Capture Notes

- Paste these prompts exactly as written. Do not personalize, localize with real data, or substitute real values.
- If the chat service auto-expands the composer or auto-suggests completions, dismiss suggestions before capturing.
- If the assistant in the test account begins to respond, stop generation, delete the response, or crop it out. Screenshots must not include assistant responses to synthetic prompts unless the response itself is also clearly synthetic and reviewed.
- For the de-anonymization banner / restoration shot, prepare a synthetic assistant response in advance that references the same placeholders (for example: "I'll email [PERSON_1] at [EMAIL_1] shortly."). Type or paste this into the response area only if your test account allows it; otherwise crop the shot to the banner UI and omit the conversation context.
