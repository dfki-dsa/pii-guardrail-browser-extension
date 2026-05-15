# Synthetic Screenshot Workflow

Public beta screenshots for `git@github.com:dfki-dsa/pii-guardrail-browser-extension.git` are captured manually by the release operator. They must use only synthetic prompts and must not reveal real personal data, real prompts, real responses, account identity, browser profile state, or internal project paths.

This document defines the capture workflow, the redaction rules for real-site capture, and the final review checklist. The synthetic prompts to paste live in [`synthetic-prompts.md`](./synthetic-prompts.md). The required shots live in [`screenshot-shot-list.md`](./screenshot-shot-list.md).

## Capture Posture

Screenshots for the first public beta are captured on the real supported sites (`chatgpt.com`, `chat.openai.com`, `claude.ai`, `gemini.google.com`) using only synthetic prompts. This is the documented operator decision for the first beta. Strict redaction rules below apply so that no real account, profile, or chat content can leak through the surrounding UI.

The popup, options page, and supported-page status chip are captured against the supported sites or against a blank tab. They do not require a chat account.

## Pre-Capture Setup

1. Use a dedicated, clean Chrome desktop stable profile created for screenshots. Do not use a personal profile.
2. Sign out of every account in that profile. If a service requires sign-in to reach the chat composer, use a throwaway test account created only for screenshots, and never paste real personal data.
3. Set the system clock and any visible OS chrome to neutral values. Hide menu bar items that show real names, calendars, notifications, networks, or VPNs.
4. Set Chrome zoom to 100%. Use a window size of 1280×800 or 1920×1280 to match Chrome Web Store screenshot sizing (typically 1280×800).
5. Disable other extensions in the screenshot profile so their badges and overlays cannot leak into shots.
6. Build the release-candidate extension with `npm run build` and load the unpacked `dist/` via `chrome://extensions` → Load unpacked. Record the build commit and version.
7. Run `npm run version:check -- 0.2.0` and `npm run check:privacy-boundary` against the build to confirm the captured artifact matches the release candidate.

## Capture Procedure

For each entry in [`screenshot-shot-list.md`](./screenshot-shot-list.md):

1. Open the target site or extension surface in a fresh tab.
2. Reset extension state if the previous shot left review overlays, banners, or modal state on screen. Reload the tab if needed.
3. Paste the matching synthetic prompt from [`synthetic-prompts.md`](./synthetic-prompts.md) into the chat composer using Cmd/Ctrl+V.
4. Wait for the review overlay, status chip, or banner described in the shot list.
5. Capture the screenshot using OS-native tools (e.g., macOS Cmd+Shift+4, Windows Snipping Tool). Save as PNG.
6. Save into `screenshots/staging/` locally. This path is not committed; it is the staging area for the operator to review before any Chrome Web Store upload.

Capture frames should crop tightly around the relevant Chrome content area. Avoid capturing the Chrome window chrome where it shows real profile names, tab favicons that reveal identity, or other tab titles.

## Redaction Rules For Real-Site Capture

Because the capture happens on real supported sites, the operator must enforce the following before saving each frame:

- Crop or blur any sidebar that lists prior real conversations, even synthetic-looking ones.
- Crop or blur account avatars, account names, workspace names, and team names.
- Crop the address bar if it shows tokens, query strings, or workspace identifiers beyond the bare hostname.
- Hide notification toasts, browser sync banners, and account-switcher tooltips.
- Hide other tabs in the tab strip if their titles reveal anything private.
- For the chat transcript area, do not capture earlier assistant responses or earlier user messages from the test account. Reset the conversation, start a new chat, or crop to the composer area only.
- Do not capture autocomplete suggestions, browser password prompts, or address-bar suggestions.

If a frame cannot meet these rules through cropping alone, redo the capture instead of editing the image.

## Local AI States

The shot list covers the Local AI states that must be visible in the Chrome Web Store listing. Use the Debug System Check controls under the options page to force the failure and CPU-fallback states deterministically. The states to capture are:

- Local AI ready (quiet OK).
- Local AI running on CPU (warning).
- Local AI failed to load (failure surface with retry).
- Local AI off by user choice (pattern-only mode).
- Low-memory protection mode (auto-disabled).

Match the popup status, options system-compatibility card, and supported-page chip in each captured frame so the screenshot does not contradict the actual extension behavior at capture time.

## Output Naming

Use the naming pattern `NN-short-description@WxH.png`, for example `02-chatgpt-review-overlay@1280x800.png`. Keep the numbering aligned with [`screenshot-shot-list.md`](./screenshot-shot-list.md). Save SHA-256 of each final PNG alongside the file as `NN-short-description@WxH.png.sha256` so the listing upload can be matched back to the reviewed file.

## Final Review Checklist

Before any screenshot is used in the Chrome Web Store listing:

- Every visible value is synthetic. No real names, emails, phone numbers, identifiers, addresses, financial data, medical data, or API keys appear in the frame.
- No browser profile name, account name, workspace name, avatar, tab title, URL query string, or notification reveals private data.
- The captured conversation contains only synthetic prompts from [`synthetic-prompts.md`](./synthetic-prompts.md) and synthetic assistant responses, with the responses either absent or cropped out.
- No prior assistant or user messages from the test account are visible.
- No other tab title, bookmark, or address-bar suggestion is visible.
- No system tray, menu bar, or OS notification reveals identity, calendar, or workplace state.
- The Local AI state shown matches the build state at capture time.
- The screenshot does not imply generic or custom site support beyond `chatgpt.com`, `chat.openai.com`, `claude.ai`, and `gemini.google.com`.
- The screenshot does not imply guaranteed detection, prevention, regulatory compliance, or enterprise readiness.
- The image dimensions and aspect ratio meet current Chrome Web Store requirements.
- The release operator and a second reviewer both sign off on each frame.

Chrome Web Store upload remains manual for the first public beta. The submission slice (`docs/issues/public-beta-launch/17-chrome-web-store-submission.md`) is responsible for upload itself, not screenshot capture.
