import {
  ONBOARDING_STORAGE_KEY,
  dismissOnboarding,
  onboardingDismissed,
} from '../../src/shared/onboarding-storage';

const storage = (globalThis as any).chrome.storage.local;

describe('onboarding storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storage.get.mockResolvedValue({});
  });

  test('not dismissed on a fresh install', async () => {
    await expect(onboardingDismissed()).resolves.toBe(false);
  });

  test('dismissing round-trips', async () => {
    await dismissOnboarding();
    expect(storage.set).toHaveBeenCalledWith({ [ONBOARDING_STORAGE_KEY]: { dismissed: true } });

    storage.get.mockResolvedValue({ [ONBOARDING_STORAGE_KEY]: { dismissed: true } });
    await expect(onboardingDismissed()).resolves.toBe(true);
  });

  test('storage failure degrades to "not dismissed" instead of throwing', async () => {
    // A first-run card must never be the thing that breaks the popup.
    storage.get.mockRejectedValue(new Error('storage unavailable'));
    await expect(onboardingDismissed()).resolves.toBe(false);
  });
});
