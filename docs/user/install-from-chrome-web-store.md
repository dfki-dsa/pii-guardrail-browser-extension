# Install From Chrome Web Store

Privacy Guardrail is distributed through the Chrome Web Store. Use the Web Store listing as the primary install and update path.

## Requirements

- Chrome desktop stable.
- A supported beta site:
  - `chatgpt.com`
  - `chat.openai.com`
  - `claude.ai`
  - `gemini.google.com`

Other browsers and sites are outside the first public beta support scope.

### System requirements for Local AI

- Recommended: at least 16 GB of RAM and a WebGPU-capable GPU.
- On 8 GB or less, the extension automatically disables Local AI and uses pattern-only detection.
- Between 8 GB and 14 GB, Local AI stays on but you may see a slowdown warning.
- Without WebGPU, Local AI falls back to a slower CPU/WASM path.

See [Local AI explained](local-ai-explained.md#system-requirements) for the full details.

## Install

1. Open the Privacy Guardrail Chrome Web Store listing.
2. Select **Add to Chrome**.
3. Confirm the Chrome permission prompt.
4. Open or refresh a supported chat tab after installation.
5. Pin the extension if you want quick access to status and settings.

The extension only runs on the supported beta sites listed above. If a supported chat tab was already open during installation, refresh it once so Chrome can inject the content script.

## Updates

Chrome normally updates installed extensions automatically. To check manually:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Update**.
4. Refresh supported chat tabs after the update finishes.

## Beta Notes

Privacy Guardrail provides assistive local review before paste. It does not guarantee complete detection, prevention of disclosure, or regulatory compliance.

For developer builds from source, see the repository `README.md`. End-user beta installs should use the Chrome Web Store package.
