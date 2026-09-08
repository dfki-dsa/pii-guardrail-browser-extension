/**
 * First-run state for the onboarding flow.
 *
 * Own key rather than a field on `Settings`: `saveSettings` broadcasts
 * SETTINGS_UPDATED to every content script, and "restore defaults" must not
 * resurrect the welcome card for a long-time user. Local to the device.
 */

export const ONBOARDING_STORAGE_KEY = 'pg_onboarding';

/** True once the user has taken or waved away the first-run prompt. */
export async function onboardingDismissed(): Promise<boolean> {
  try {
    const stored = await chrome.storage.local.get(ONBOARDING_STORAGE_KEY);
    return stored[ONBOARDING_STORAGE_KEY]?.dismissed === true;
  } catch {
    return false;
  }
}

/** Stop offering the prompt. Called on take, dismiss, and finish alike. */
export async function dismissOnboarding(): Promise<void> {
  await chrome.storage.local.set({ [ONBOARDING_STORAGE_KEY]: { dismissed: true } });
}
