# Chrome Permissions

Use this permission audit before public beta packaging and when preparing Chrome Web Store permission justifications.

## Static Check

Run:

```bash
npm run check:permissions
```

The check fails if the manifest adds unsupported host permissions, restores the unused `activeTab` permission, or exposes extension resources outside the supported beta sites.

## Manifest Permissions

| Permission | Keep for beta | Justification |
|---|---:|---|
| `storage` | Yes | Stores user settings, local identity-vault mappings, feedback logs, allow/block lists, and local system compatibility state in Chrome extension storage. |
| `offscreen` | Yes | Runs local WASM/ONNX detection work in an offscreen extension document because Manifest V3 service workers cannot host the long-lived browser APIs needed for model inference. |
| `tabs` | Yes | Required for visible extension workflows: opening support/privacy/security/options pages, broadcasting settings changes to supported chat tabs, and updating the action icon based on the current supported-site tab. |
| `activeTab` | No | Removed because the extension does not use temporary active-tab script injection or capture. |

## Host Permissions

The first public beta is limited to Chrome desktop stable and these chat sites:

- `https://chat.openai.com/*`
- `https://chatgpt.com/*`
- `https://claude.ai/*`
- `https://gemini.google.com/*`

Content scripts and web-accessible resources must use the same host list. Do not add generic/custom site support or `<all_urls>` for the first public beta.

## Web-Accessible Resources

The extension exposes only packaged runtime assets required by supported-site content scripts and local inference:

- `wasm/*.wasm`
- `offscreen/offscreen.html`
- packaged NER model assets under `models/ner/**`
- packaged ONNX Runtime Web assets under `vendor/onnxruntime-web/*`

These resources are scoped to the supported beta hosts, not all websites.
