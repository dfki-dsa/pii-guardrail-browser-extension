export const ONBOARDING_HINT_STORAGE_KEY = 'pg_onboarding_hint';
export const ONBOARDING_HINT_SCHEMA_VERSION = 1;

export type OnboardingHintStatus = 'new' | 'acknowledged' | 'existing';

export interface OnboardingHint {
  schemaVersion: typeof ONBOARDING_HINT_SCHEMA_VERSION;
  status: OnboardingHintStatus;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Return only the supported, versioned preference record shape. */
export function isOnboardingHint(value: unknown): value is OnboardingHint {
  return isRecord(value)
    && value.schemaVersion === ONBOARDING_HINT_SCHEMA_VERSION
    && (value.status === 'new' || value.status === 'acknowledged' || value.status === 'existing');
}

/**
 * Load the durable first-time emphasis preference. Missing, malformed, and
 * future-version records deliberately look unavailable to callers: they must
 * not be used to infer a fresh install or rewritten by a popup read.
 */
export async function loadOnboardingHint(): Promise<OnboardingHint | null> {
  const stored = await chrome.storage.local.get(ONBOARDING_HINT_STORAGE_KEY);
  const hint = stored[ONBOARDING_HINT_STORAGE_KEY];
  return isOnboardingHint(hint) ? hint : null;
}

let preferenceWriteQueue: Promise<void> = Promise.resolve();

function enqueuePreferenceWrite<T>(operation: () => Promise<T>): Promise<T> {
  const queued = preferenceWriteQueue.catch(() => undefined).then(operation);
  // Keep a recovered queue for the next lifecycle operation, while returning
  // the original error to this operation's caller.
  preferenceWriteQueue = queued.then(() => undefined, () => undefined);
  return queued;
}

function record(status: OnboardingHintStatus): OnboardingHint {
  return { schemaVersion: ONBOARDING_HINT_SCHEMA_VERSION, status };
}

/**
 * Stamp only a missing preference during Chrome's install lifecycle. A genuine
 * fresh install gets emphasis; every other lifecycle reason gets ordinary,
 * reusable Help. Valid, malformed, and unknown records are left untouched.
 */
export function initializeOnboardingHint(reason: string): Promise<void> {
  return enqueuePreferenceWrite(async () => {
    const stored = await chrome.storage.local.get(ONBOARDING_HINT_STORAGE_KEY);
    // chrome.storage omits missing keys. A present non-undefined value may be
    // malformed or from a future version, and must remain untouched.
    if (stored[ONBOARDING_HINT_STORAGE_KEY] !== undefined) return;

    await chrome.storage.local.set({
      [ONBOARDING_HINT_STORAGE_KEY]: record(reason === 'install' ? 'new' : 'existing'),
    });
  });
}

/**
 * Acknowledge emphasis once it has been deliberately dismissed or used. This
 * never creates a record and only changes the supported `new` state.
 */
export function acknowledgeOnboardingHint(): Promise<boolean> {
  return enqueuePreferenceWrite(async () => {
    const stored = await chrome.storage.local.get(ONBOARDING_HINT_STORAGE_KEY);
    const hint = stored[ONBOARDING_HINT_STORAGE_KEY];
    if (!isOnboardingHint(hint) || hint.status !== 'new') return false;

    await chrome.storage.local.set({
      [ONBOARDING_HINT_STORAGE_KEY]: record('acknowledged'),
    });
    return true;
  });
}
