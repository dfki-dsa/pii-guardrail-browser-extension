export const PUBLIC_PROJECT_REPO_URL = 'https://github.com/dfki-dsa/pii-guardrail-browser-extension';

export const PUBLIC_PROJECT_LINKS = {
  repo: PUBLIC_PROJECT_REPO_URL,
  issues: `${PUBLIC_PROJECT_REPO_URL}/issues`,
  newIssue: `${PUBLIC_PROJECT_REPO_URL}/issues/new/choose`,
  privacy: `${PUBLIC_PROJECT_REPO_URL}/blob/main/PRIVACY.md`,
  security: `${PUBLIC_PROJECT_REPO_URL}/blob/main/SECURITY.md`,
  support: `${PUBLIC_PROJECT_REPO_URL}/blob/main/SUPPORT.md`,
  impressum: `${PUBLIC_PROJECT_REPO_URL}/blob/main/IMPRESSUM.md`,
  terms: `${PUBLIC_PROJECT_REPO_URL}/blob/main/TERMS.md`,
} as const;

export const PACKAGED_TERMS_PATH = 'TERMS.html';
export const TERMS_PUBLISHED = true;

export function packagedTermsUrl(): string {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(PACKAGED_TERMS_PATH);
  }

  return PUBLIC_PROJECT_LINKS.terms;
}

export const SECURITY_SUPPORT_EMAIL = 'pii@dfki.de';

/**
 * The limits-of-detection statement every disclaimer is built from. Kept in
 * sync with PRIVACY.md §15, the store listing, and the README.
 */
const LIMITS_STATEMENT =
  'Privacy Guardrail is assistive only and can miss or mis-flag sensitive content.';

/**
 * The full disclaimer: the statement plus the instruction to review. Shown in
 * the extension popup, which is where it reaches someone using auto-mode, who
 * may never see the review pop-up.
 */
export const LIMITS_DISCLAIMER = `${LIMITS_STATEMENT} Always review text before you send it.`;

/**
 * The disclaimer at the foot of the review pop-up: the statement alone. The
 * instruction to review is left out there on purpose — the pop-up is the
 * review. Built from the same statement so the two wordings cannot drift.
 */
export const REVIEW_POPUP_DISCLAIMER = LIMITS_STATEMENT;

/**
 * EU AI Act Art. 50 transparency notice. Surfaced wherever Local AI is
 * presented (options System Compatibility card, popup protection status) so the
 * user is told detection relies on a local on-device AI model with limits.
 * Kept consistent with LIMITS_DISCLAIMER and the AI Act classification memo.
 */
export const AI_TRANSPARENCY_NOTICE =
  'Detection uses a local AI model that runs on your device. It can miss or mis-flag sensitive content, so review text before you send it.';
