const HINT_KEY = 'pg_onboarding_hint';

describe('background onboarding lifecycle', () => {
  let store: Record<string, unknown>;
  let installedListener: ((details: { reason: string }) => Promise<void>) | undefined;
  let messageListener: ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean) | undefined;
  let tabsCreate: jest.Mock;
  let sendMessage: jest.Mock;

  async function importWorker(): Promise<void> {
    jest.resetModules();
    store = {};
    installedListener = undefined;
    messageListener = undefined;
    tabsCreate = jest.fn();
    sendMessage = jest.fn().mockImplementation(async (message) => {
      if (message?.type === 'COLLECT_SYSTEM_SIGNALS') {
        return { type: 'SYSTEM_SIGNALS', payload: { browserMemoryGb: 8, webGpu: 'available' } };
      }
      return {};
    });

    (globalThis as any).chrome = {
      storage: {
        local: {
          get: jest.fn(async (key: string) => ({ [key]: store[key] })),
          set: jest.fn(async (value: Record<string, unknown>) => { store = { ...store, ...value }; }),
          remove: jest.fn(),
        },
        session: { setAccessLevel: jest.fn().mockResolvedValue(undefined) },
        onChanged: { addListener: jest.fn() },
      },
      runtime: {
        getURL: jest.fn((path: string) => `chrome-extension://test/${path}`),
        sendMessage,
        onMessage: { addListener: jest.fn((listener) => { messageListener = listener; }) },
        onInstalled: { addListener: jest.fn((listener) => { installedListener = listener; }) },
        onStartup: { addListener: jest.fn() },
      },
      offscreen: {
        hasDocument: jest.fn().mockResolvedValue(false),
        createDocument: jest.fn().mockResolvedValue(undefined),
        closeDocument: jest.fn().mockResolvedValue(undefined),
      },
      tabs: {
        query: jest.fn().mockResolvedValue([]),
        get: jest.fn(),
        create: tabsCreate,
        onActivated: { addListener: jest.fn() },
        onUpdated: { addListener: jest.fn() },
      },
      action: { setIcon: jest.fn(), setBadgeText: jest.fn() },
    };

    await import('../../src/background/service-worker');
  }

  async function send(message: unknown, sender: unknown): Promise<unknown> {
    return new Promise((resolve) => {
      expect(messageListener?.(message, sender, resolve)).toBe(true);
    });
  }

  beforeEach(async () => {
    await importWorker();
  });

  test.each([
    ['install', 'new'],
    ['update', 'existing'],
    ['chrome_update', 'existing'],
  ] as const)('initializes %s without opening UI or detection', async (reason, status) => {
    await installedListener?.({ reason });

    expect(store[HINT_KEY]).toEqual({ schemaVersion: 1, status });
    expect(tabsCreate).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'COLLECT_SYSTEM_SIGNALS' });
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DETECT_PII' }));
  });

  test('preserves a valid duplicate install preference', async () => {
    store[HINT_KEY] = { schemaVersion: 1, status: 'acknowledged' };

    await installedListener?.({ reason: 'install' });

    expect(store[HINT_KEY]).toEqual({ schemaVersion: 1, status: 'acknowledged' });
  });

  test('only accepts acknowledgement from the extension popup URL', async () => {
    store[HINT_KEY] = { schemaVersion: 1, status: 'new' };

    await expect(send({ type: 'ACKNOWLEDGE_ONBOARDING_HINT' }, { url: 'https://chatgpt.com/' }))
      .resolves.toEqual(expect.objectContaining({ error: expect.any(String) }));
    expect(store[HINT_KEY]).toEqual({ schemaVersion: 1, status: 'new' });

    await expect(send(
      { type: 'ACKNOWLEDGE_ONBOARDING_HINT' },
      { url: 'chrome-extension://test/popup/popup.html' },
    )).resolves.toEqual({ type: 'ONBOARDING_HINT_ACKNOWLEDGED', payload: { acknowledged: true } });
    expect(store[HINT_KEY]).toEqual({ schemaVersion: 1, status: 'acknowledged' });
  });

  test('acknowledgement is idempotent and never creates a missing preference', async () => {
    await expect(send(
      { type: 'ACKNOWLEDGE_ONBOARDING_HINT' },
      { url: 'chrome-extension://test/popup/popup.html' },
    )).resolves.toEqual({ type: 'ONBOARDING_HINT_ACKNOWLEDGED', payload: { acknowledged: false } });

    store[HINT_KEY] = { schemaVersion: 1, status: 'new' };
    await send({ type: 'ACKNOWLEDGE_ONBOARDING_HINT' }, { url: 'chrome-extension://test/popup/popup.html' });
    await expect(send(
      { type: 'ACKNOWLEDGE_ONBOARDING_HINT' },
      { url: 'chrome-extension://test/popup/popup.html' },
    )).resolves.toEqual({ type: 'ONBOARDING_HINT_ACKNOWLEDGED', payload: { acknowledged: false } });
  });
});
