# Privacy Policy

This privacy policy describes how the **Privacy Guardrail** Chrome extension processes
personal data, in accordance with Articles 13 and 14 of the EU General Data Protection
Regulation (GDPR).

Privacy Guardrail is a public-beta Chrome extension that helps you **detect, review, mark,
replace, and later restore** personal data in text *before* you paste it into supported
large-language-model (LLM) chat applications. It runs **locally in your browser**. It is an
**assistive tool only and does not guarantee** that all sensitive content will be detected,
marked, or removed. You remain responsible for reviewing text before you send it.

The extension does **not** anonymize data in a legal sense. It assists you in identifying and
substituting personal data; the result may still allow re-identification.

## 1. Controller (Verantwortlicher)

The controller responsible for the extension within the meaning of Art. 4(7) GDPR is:

Deutsches Forschungszentrum für Künstliche Intelligenz GmbH (DFKI)
Trippstadter Str. 122
67663 Kaiserslautern, Germany
Tel.: +49 631 20575 0
Email: info@dfki.de

Geschäftsführung: Prof. Dr. Antonio Krüger, Helmut Ditzer
Registergericht: Amtsgericht Kaiserslautern, Registernummer: HRB 2313
VAT ID: DE 148 646 973

Project contact: Department Data Science and its Applications (DSA), DFKI —
Prof. Dr. Sebastian Vollmer, sebastian.vollmer@dfki.de

See the [Impressum](IMPRESSUM.md) for the full legal notice.

## 2. Data Protection Officer

You can reach the DFKI Data Protection Officer at:

Tel.: +49 631 20575 0
Email: datenschutz@dfki.de

## 3. Purposes of Processing

The extension processes data on your device for the following purposes:

- **Local detection** of personal data in text you paste or enter on supported sites.
- **Review and marking** of detected items so you can decide what to keep, replace, or ignore.
- **Replacement** of selected items with placeholders or synthetic substitutes.
- **Restoration** of original values in responses, where you have chosen to do so.
- **Storing your settings** and the **placeholder/value mappings** needed to perform the
  replacement and restoration you requested.

## 4. Legal Basis

- **Art. 6(1)(b) GDPR** (performance of a function you request): the extension processes the
  text you provide in order to carry out the detection, replacement, and restoration that you
  explicitly initiate.
- **Art. 6(1)(f) GDPR** (legitimate interests), where relevant: enabling you to reduce the
  amount of personal data you disclose to third-party AI services, and operating a functional,
  secure research prototype. All processing remains local to your device.

Because all processing happens locally on your end device and DFKI does not receive any of the
processed content, DFKI does not act as a controller over the substance of the text you process.

## 5. Recipients & Non-Transmission

DFKI does **not** receive, store, or evaluate user content from the extension. In particular,
the extension does **not** transmit user content, prompts, responses, detection results,
placeholder mappings, identity-vault data, local feedback records/logs, or model input to DFKI
or to DFKI-operated/project-operated servers. There is no telemetry back-channel.

Voluntary reports you submit outside the extension, for example through GitHub Issues or by
email to `pii@dfki.de`, are separate from extension operation and contain only what you choose
to send.

Privacy Guardrail does **not** include:

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

Detection runs in the browser using local deterministic recognizers and, where available, a
local AI/NER model packaged with the extension. Pasted text is **not** sent to any remote
inference service by the extension.

## 6. Clipboard Access

Because the extension works on text you copy and paste, this section describes precisely when
and how it accesses clipboard content.

**No clipboard permissions.** The extension's manifest requests neither the `clipboardRead` nor
the `clipboardWrite` browser permission. Those permissions are what would allow an extension to
read the clipboard's contents on demand. Without them, the extension only ever sees clipboard
text that the browser itself hands to the page during a copy or paste you perform, and only
writes to the clipboard when you click one of its buttons (see below). It cannot read your
clipboard in the background, on a schedule, or while you are on any other website.

**Where it runs.** The extension's page scripts are injected **only** on the supported chat sites
listed in §7 (`chatgpt.com`, `chat.openai.com`, `claude.ai`, `gemini.google.com`). On every other
website, no extension code runs at all and no clipboard content is accessible to it.

**When clipboard text is read.** On the supported sites only, and only as part of an action you
perform yourself:

- **When you paste.** If you paste into the chat input field of a supported site, the extension
  reads the pasted text from the paste event itself (`ClipboardEvent.clipboardData`), which the
  browser hands to the page for that single event. Pastes into other fields on the page are
  ignored, as is pasted text shorter than 10 characters. The text is then processed locally for
  detection and presented to you for review.
- **When you copy.** If the **Intercept copy** setting is enabled, then when you copy text on a
  supported site the extension inspects the copied text for placeholders it inserted earlier, so
  that it can offer to restore the original values. It takes that text from the copy event or
  from the current page selection. To catch copies triggered by the website's own buttons, a
  small script on those sites also observes clipboard writes that the site itself makes and
  reports them to the extension. That script is part of the page scripts injected on those sites
  and is always present there; when interception is off, the extension discards what it reports
  without inspecting the text.

The extension does not poll or monitor the clipboard between these events. What it keeps
afterwards is limited to the local storage described in §9: the placeholder ↔ original-value
mappings needed for restoration, and, if you correct a detection while reviewing, that item's
text together with up to 20 characters of the surrounding text on either side, kept in the local
feedback log. Both stay on your device.

**When clipboard text is written.** The extension writes to the clipboard only when you click a
button it has put on the page, and only with text in which placeholders have been restored to
their original values. There are two such buttons: **Replace with originals** in the notification
shown after you copy, and **Copy** in the banner above a response that contains restored values.
If you do not click either, nothing is written. These writes require no clipboard permission
because they happen in the page in direct response to your click, in the same way a website's own
copy button works.

**How to switch it off.** The copy-side behavior is controlled by the **Intercept copy** setting.
Reviewing what you paste is controlled by the master protection toggle. With master protection
switched off, the extension no longer reviews what you paste, no longer inspects what you copy,
and stores nothing further. The page-world observer described above remains installed on the
supported sites, because it is part of the page scripts injected there, but nothing in the
extension acts on what it reports. What it reports travels only as a message within the page you
are already on; the text is not inspected, not stored, and never leaves your browser.

In every case, clipboard content is processed **locally in your browser**. As stated in §5, it is
never transmitted to DFKI.

## 7. AI Services (ChatGPT, Claude, Gemini)

The extension supports use alongside third-party AI chat services, currently:

- ChatGPT (`chatgpt.com`, `chat.openai.com`)
- Claude (`claude.ai`)
- Gemini (`gemini.google.com`)

Transmission of text to one of these providers happens **only when you yourself send** the
reviewed text in that service's chat interface. At that point the text leaves your browser and
is processed by the respective provider under **its own privacy terms and as its own
controller**. The extension does not send anything to these providers on your behalf; it only
helps you review text beforehand. Please consult each provider's privacy policy for how it
processes the data you submit.

## 8. Third-Country Transfers

The extension itself causes **no** transfer of personal data to third countries; nothing is
transmitted off your device by the extension. However, if you choose to submit text to an AI
service (see §7), that provider may process your submission in a third country under its own
terms. Any such transfer is governed by the provider, not by DFKI or this extension.

## 9. Local Storage, Retention, and Deletion

The extension stores state in your browser's local extension storage (`chrome.storage.local`),
on your end device only. The following keys may be stored, each only as needed for the function
you use:

| Storage key | Contents | Why it is necessary |
| --- | --- | --- |
| `pg_settings` | Your preferences (categories, sensitivity, replacement mode, theme, Local AI options, allow/block lists) | To apply your chosen configuration |
| `pg_entity_maps` | Placeholder ↔ original-value mappings, keyed by conversation URL | To restore original values you replaced |
| `pg_identity_vault` | Identity vault entries (stable replacements for recurring identities) | To produce consistent replacements across pastes |
| `pg_feedback` | Local correction/feedback records: the corrected item's text, a short excerpt of the text around it, the detected and corrected category, and a timestamp (capped at the last 1000 entries) | To improve your local experience; never uploaded |
| `pg_system_check` | Result of the local system/compatibility check | To show whether Local AI can run on your device |

**Where it is stored:** locally in your browser profile, on your device. It is **not** collected
by DFKI.

**Local-storage necessity (§ 25 TDDDG):** the extension uses `chrome.storage.local` only to
provide functions you explicitly request, including applying your settings, keeping
placeholder/value mappings for restoration, maintaining stable local replacement identities,
storing local correction records, and showing the local system-compatibility result. This local
storage is necessary for those requested extension functions. It is not used for tracking,
analytics, telemetry, advertising, or remote profiling.

**Retention:** data remains until **you** delete it. There is no automatic upload and no
server-side copy. The feedback log is additionally capped at the most recent 1000 entries.

**How to delete it:**

- Clear placeholder mappings per conversation or for all conversations from the extension UI.
- Clear identity vault entries from the Vault card in the options page.
- Clear the local feedback log from the options page.
- Reset settings from the options page.

**On uninstall or browser-profile deletion:** Chrome removes the extension's
`chrome.storage.local` data, so all of the above is deleted by the browser.

## 10. Special Categories of Data (Art. 9 GDPR)

Depending on the text you choose to process, the extension may touch **special categories of
personal data** (Art. 9 GDPR) — for example data revealing health, religion, or similar. Any
such data is **processed locally on your device only** and is **not transmitted to DFKI**. You
decide what text to process and what to send onward to an AI service.

## 11. Automated Decision-Making / Profiling

The extension does **not** carry out automated decision-making that produces legal effects or
similarly significantly affects you within the meaning of Art. 22 GDPR. Detection is **assistive
scoring** that surfaces suggestions for your review; it does not make decisions about a data
subject. The extension does not create profiles of users.

## 12. Your Rights

Under the GDPR you have the right to:

- **access** your personal data (Art. 15),
- **rectification** of inaccurate data (Art. 16),
- **erasure** (Art. 17),
- **restriction** of processing (Art. 18),
- **object** to processing (Art. 21),
- **data portability** (Art. 20).

Because data processed by the extension stays on your device and DFKI holds none of it, you can
exercise most of these rights directly by viewing, editing, or deleting your local data (see §9).
For any request concerning DFKI as controller, contact the addresses in §1 and §2.

You also have the right to **lodge a complaint with a supervisory authority** (Art. 77 GDPR), in
particular in the EU member state of your residence, workplace, or the place of the alleged
infringement.

## 13. Diagnostics & Training

User content and local feedback logs are **not used for training** by this project. The local
feedback log (§9) stays on your device and is never uploaded.

The only exception is when **you deliberately create and submit a sanitized sample outside the
extension** (for example, attaching a synthetic example to a report). That is your own,
deliberate action.

Any future diagnostic feature will be **described and assessed separately before it is
introduced**. This policy does not pre-authorize any future diagnostic data flow.

## 14. Public Support / GitHub Issues

Public support is handled via **GitHub Issues, which are public**. Anything you post there is
visible to anyone.

**Do not post** real personal data, confidential documents, real prompts or responses,
screenshots containing real data, secrets, or other sensitive content in GitHub Issues. Keep all
examples **synthetic or sanitized**.

## 15. Confidential Reporting

For sensitive security or privacy reports, contact **pii@dfki.de** directly. Do not use public
GitHub Issues for sensitive reports. See [SECURITY.md](SECURITY.md) for what to include.

## 16. Limits of Detection

Privacy Guardrail is **assistive only**. It does **not guarantee** complete detection, marking,
or removal of personal or sensitive data, and it is **not a compliance product**. Detection can
miss content or mis-flag content. Always review text yourself before sending it to any AI service.

## 17. Impressum

For the full legal notice (provider identification under § 5 DDG), see the
[Impressum](IMPRESSUM.md).
