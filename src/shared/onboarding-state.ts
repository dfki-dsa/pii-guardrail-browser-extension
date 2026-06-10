/**
 * Onboarding state helpers.
 *
 * The flag is kept in chrome.storage.local so it survives browser restarts
 * and is never synced to any external service.
 */

const ONBOARDING_KEY = 'onboardingDismissed';

/**
 * Returns true if the user has already dismissed the onboarding overlay.
 */
export async function hasSeenOnboarding(): Promise<boolean> {
  const result = await chrome.storage.local.get(ONBOARDING_KEY);
  return result[ONBOARDING_KEY] === true;
}

/**
 * Marks the onboarding overlay as seen so it does not appear again
 * on subsequent visits to the Options page.
 */
export async function markOnboardingSeen(): Promise<void> {
  await chrome.storage.local.set({ [ONBOARDING_KEY]: true });
}

/**
 * Clears the dismissed flag so the onboarding overlay will appear again
 * on the next visit. Useful for the "Onboarding guide" re-open action.
 */
export async function resetOnboardingSeen(): Promise<void> {
  await chrome.storage.local.remove(ONBOARDING_KEY);
}
