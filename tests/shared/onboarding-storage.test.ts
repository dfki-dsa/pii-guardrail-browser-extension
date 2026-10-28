import {
  ONBOARDING_HINT_STORAGE_KEY,
  acknowledgeOnboardingHint,
  initializeOnboardingHint,
  isOnboardingHint,
  loadOnboardingHint,
} from '../../src/shared/onboarding-storage';

describe('onboarding hint storage', () => {
  let store: Record<string, unknown>;

  beforeEach(() => {
    jest.resetModules();
    store = {};
    (chrome.storage.local.get as jest.Mock).mockImplementation(async (key: string) => ({ [key]: store[key] }));
    (chrome.storage.local.set as jest.Mock).mockImplementation(async (value: Record<string, unknown>) => {
      store = { ...store, ...value };
    });
  });

  test('strictly validates only the supported version and statuses', () => {
    expect(isOnboardingHint({ schemaVersion: 1, status: 'new' })).toBe(true);
    expect(isOnboardingHint({ schemaVersion: 1, status: 'acknowledged' })).toBe(true);
    expect(isOnboardingHint({ schemaVersion: 1, status: 'existing' })).toBe(true);
    expect(isOnboardingHint({ schemaVersion: 2, status: 'new' })).toBe(false);
    expect(isOnboardingHint({ schemaVersion: 1, status: 'unknown' })).toBe(false);
    expect(isOnboardingHint(null)).toBe(false);
  });

  test.each([
    ['install', 'new'],
    ['update', 'existing'],
    ['chrome_update', 'existing'],
    ['shared_module_update', 'existing'],
  ] as const)('initializes missing preference for %s', async (reason, status) => {
    await initializeOnboardingHint(reason);

    await expect(loadOnboardingHint()).resolves.toEqual({ schemaVersion: 1, status });
  });

  test('preserves valid, malformed, and unknown records during initialization', async () => {
    for (const value of [
      { schemaVersion: 1, status: 'acknowledged' },
      { schemaVersion: 1, status: 'future-status' },
      { schemaVersion: 2, status: 'new' },
      null,
    ]) {
      jest.resetModules();
      store = { [ONBOARDING_HINT_STORAGE_KEY]: value };
      const storage = await import('../../src/shared/onboarding-storage');

      await storage.initializeOnboardingHint('install');

      expect(store[ONBOARDING_HINT_STORAGE_KEY]).toEqual(value);
    }
  });

  test('acknowledges only a valid new record and is idempotent', async () => {
    store[ONBOARDING_HINT_STORAGE_KEY] = { schemaVersion: 1, status: 'new' };

    await expect(acknowledgeOnboardingHint()).resolves.toBe(true);
    await expect(acknowledgeOnboardingHint()).resolves.toBe(false);
    expect(store[ONBOARDING_HINT_STORAGE_KEY]).toEqual({ schemaVersion: 1, status: 'acknowledged' });
  });

  test('does not create or rewrite missing, existing, malformed, or unknown acknowledgement records', async () => {
    for (const value of [undefined, { schemaVersion: 1, status: 'existing' }, { schemaVersion: 2, status: 'new' }]) {
      jest.resetModules();
      store = value === undefined ? {} : { [ONBOARDING_HINT_STORAGE_KEY]: value };
      const storage = await import('../../src/shared/onboarding-storage');

      await expect(storage.acknowledgeOnboardingHint()).resolves.toBe(false);
      expect(store[ONBOARDING_HINT_STORAGE_KEY]).toEqual(value);
    }
  });

  test('serializes initialization before a fast acknowledgement', async () => {
    let releaseRead: (() => void) | undefined;
    (chrome.storage.local.get as jest.Mock)
      .mockImplementationOnce(async (key: string) => {
        await new Promise<void>((resolve) => { releaseRead = resolve; });
        return { [key]: store[key] };
      })
      .mockImplementation(async (key: string) => ({ [key]: store[key] }));

    const initialization = initializeOnboardingHint('install');
    for (let i = 0; i < 5 && !releaseRead; i += 1) await Promise.resolve();
    const acknowledgement = acknowledgeOnboardingHint();
    releaseRead?.();
    await initialization;
    await expect(acknowledgement).resolves.toBe(true);

    expect(store[ONBOARDING_HINT_STORAGE_KEY]).toEqual({ schemaVersion: 1, status: 'acknowledged' });
  });

  test('serializes concurrent acknowledgements', async () => {
    store[ONBOARDING_HINT_STORAGE_KEY] = { schemaVersion: 1, status: 'new' };

    await expect(Promise.all([acknowledgeOnboardingHint(), acknowledgeOnboardingHint()]))
      .resolves.toEqual([true, false]);
  });

  test('recovers the queue after a rejected storage operation', async () => {
    (chrome.storage.local.get as jest.Mock)
      .mockRejectedValueOnce(new Error('temporary storage error'))
      .mockImplementation(async (key: string) => ({ [key]: store[key] }));

    await expect(initializeOnboardingHint('install')).rejects.toThrow('temporary storage error');
    await initializeOnboardingHint('install');

    expect(store[ONBOARDING_HINT_STORAGE_KEY]).toEqual({ schemaVersion: 1, status: 'new' });
  });
});
