import { DEFAULT_SETTINGS } from '../../src/shared/constants';
import { SYSTEM_CHECK_STORAGE_KEY, buildSystemCheckResult } from '../../src/shared/system-check-storage';

const SETTINGS_KEY = 'pg_settings';

describe('background system compatibility orchestration', () => {
  let store: Record<string, unknown>;
  let installedListener: (() => Promise<void>) | undefined;
  let messageListener: ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean) | undefined;
  let sendMessage: jest.Mock;
  let createDocument: jest.Mock;
  let closeDocument: jest.Mock;
  let hasDocument: jest.Mock;

  async function importWorker(): Promise<void> {
    jest.resetModules();
    store = {};
    installedListener = undefined;
    sendMessage = jest.fn().mockImplementation(async (message) => {
      if (message?.type === 'COLLECT_SYSTEM_SIGNALS') {
        return { type: 'SYSTEM_SIGNALS', payload: { browserMemoryGb: 8, webGpu: 'available' } };
      }
      return {};
    });
    createDocument = jest.fn().mockResolvedValue(undefined);
    closeDocument = jest.fn().mockResolvedValue(undefined);
    hasDocument = jest.fn().mockResolvedValue(false);

    (globalThis as any).chrome = {
      storage: {
        local: {
          get: jest.fn(async (key: string) => ({ [key]: store[key] })),
          set: jest.fn(async (value: Record<string, unknown>) => { store = { ...store, ...value }; }),
          remove: jest.fn(async (key: string) => { delete store[key]; }),
        },
        onChanged: { addListener: jest.fn() },
      },
      runtime: {
        sendMessage,
        onMessage: { addListener: jest.fn((listener) => { messageListener = listener; }) },
        onInstalled: { addListener: jest.fn((listener) => { installedListener = listener; }) },
        onStartup: { addListener: jest.fn() },
        getURL: jest.fn((path: string) => `chrome-extension://test/${path}`),
      },
      offscreen: {
        hasDocument,
        createDocument,
        closeDocument,
      },
      tabs: {
        query: jest.fn().mockResolvedValue([]),
        get: jest.fn(),
        create: jest.fn(),
        onActivated: { addListener: jest.fn() },
        onUpdated: { addListener: jest.fn() },
      },
      action: {
        setIcon: jest.fn(),
        setBadgeText: jest.fn(),
      },
    };

    await import('../../src/background/service-worker');
  }

  async function flushAsyncWork(): Promise<void> {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  }

  test('auto-disables transformer Local AI once on a first critical compatibility result', async () => {
    await importWorker();

    await installedListener?.();

    expect(store[SETTINGS_KEY]).toEqual(expect.objectContaining({
      nerProvider: 'off',
      nerModel: DEFAULT_SETTINGS.nerModel,
    }));
    expect(store[SYSTEM_CHECK_STORAGE_KEY]).toEqual(expect.objectContaining({
      tier: 'critical',
      recommendation: 'auto-disable-local-ai',
      localAiState: 'off-low-memory-auto',
      criticalModal: 'pending',
    }));
    expect(createDocument).toHaveBeenCalledTimes(1);
  });

  test('does not disable Local AI on warning memory', async () => {
    await importWorker();
    sendMessage.mockImplementationOnce(async () => ({
      type: 'SYSTEM_SIGNALS',
      payload: { browserMemoryGb: 12, webGpu: 'available' },
    }));

    await installedListener?.();

    expect(store[SETTINGS_KEY]).toEqual(expect.objectContaining({ nerProvider: 'transformers' }));
    expect(store[SYSTEM_CHECK_STORAGE_KEY]).toEqual(expect.objectContaining({
      tier: 'warning',
      localAiState: 'enabled',
    }));
  });

  test('existing low-memory override prevents repeated automatic disabling', async () => {
    await importWorker();
    store[SYSTEM_CHECK_STORAGE_KEY] = {
      ...buildSystemCheckResult({ browserMemoryGb: 8, webGpu: 'available' }, 100),
      localAiState: 'enabled-low-memory-override',
      lowMemoryOverride: true,
    };
    store[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, nerProvider: 'transformers' };

    await installedListener?.();

    expect(store[SETTINGS_KEY]).toEqual(expect.objectContaining({ nerProvider: 'transformers' }));
    expect(createDocument).not.toHaveBeenCalled();
  });

  test('dismiss critical modal message persists dismissal', async () => {
    await importWorker();
    store[SYSTEM_CHECK_STORAGE_KEY] = {
      ...buildSystemCheckResult({ browserMemoryGb: 8, webGpu: 'available' }, 100),
      localAiState: 'off-low-memory-auto',
      criticalModal: 'pending',
    };

    const response = await new Promise((resolve) => {
      messageListener?.({ type: 'DISMISS_CRITICAL_LOCAL_AI_MODAL' }, {}, resolve);
    });

    expect(store[SYSTEM_CHECK_STORAGE_KEY]).toEqual(expect.objectContaining({ criticalModal: 'dismissed' }));
    expect(response).toEqual({
      ok: true,
      payload: expect.objectContaining({ criticalModal: 'dismissed' }),
    });
  });

  test('explicit Local AI enable on critical systems records low-memory override', async () => {
    await importWorker();
    store[SYSTEM_CHECK_STORAGE_KEY] = buildSystemCheckResult({ browserMemoryGb: 8, webGpu: 'available' }, 100);
    store[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, nerProvider: 'off' };

    const response = await new Promise((resolve) => {
      messageListener?.({ type: 'SET_LOCAL_AI_DETECTION', payload: { enabled: true } }, {}, resolve);
    });

    expect(store[SETTINGS_KEY]).toEqual(expect.objectContaining({ nerProvider: 'transformers' }));
    expect(store[SYSTEM_CHECK_STORAGE_KEY]).toEqual(expect.objectContaining({
      localAiState: 'enabled-low-memory-override',
      lowMemoryOverride: true,
    }));
    expect(response).toEqual({
      type: 'SYSTEM_COMPATIBILITY_STATUS',
      payload: expect.objectContaining({ localAiState: 'enabled-low-memory-override' }),
    });
  });

  test('explicit Local AI off records user choice', async () => {
    await importWorker();
    store[SYSTEM_CHECK_STORAGE_KEY] = buildSystemCheckResult({ browserMemoryGb: 16, webGpu: 'available' }, 100);
    store[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, nerProvider: 'transformers' };
    hasDocument.mockResolvedValue(true);

    await new Promise((resolve) => {
      messageListener?.({ type: 'SET_LOCAL_AI_DETECTION', payload: { enabled: false } }, {}, resolve);
    });

    expect(store[SETTINGS_KEY]).toEqual(expect.objectContaining({ nerProvider: 'off' }));
    expect(store[SYSTEM_CHECK_STORAGE_KEY]).toEqual(expect.objectContaining({ localAiState: 'off-user-choice' }));
    expect(closeDocument).toHaveBeenCalledTimes(1);
  });

  test('warmup message creates the NER offscreen document and returns model status', async () => {
    await importWorker();
    store[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, nerProvider: 'transformers' };
    sendMessage.mockImplementation(async (message) => {
      if (message?.type === 'OFFSCREEN_PING') return { type: 'OFFSCREEN_PONG' };
      if (message?.type === 'DETECT_PII') return { type: 'PII_RESULT', payload: { requestId: message.payload.requestId, spans: [] } };
      if (message?.type === 'GET_NER_STATUS') return { type: 'NER_STATUS', payload: { mode: 'transformers', state: 'ready', model: 'bardsai' } };
      return {};
    });

    const response = await new Promise((resolve) => {
      messageListener?.({ type: 'WARM_UP_LOCAL_AI', payload: { config: { ner_provider: 'transformers' } } }, {}, resolve);
    });

    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'DETECT_PII' }));
    expect(response).toEqual({ type: 'NER_STATUS', payload: expect.objectContaining({ state: 'ready' }) });
  });

  test('failed warmup flips Local AI to off and records a load failure reason', async () => {
    await importWorker();
    store[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, nerProvider: 'transformers' };
    store[SYSTEM_CHECK_STORAGE_KEY] = buildSystemCheckResult({ browserMemoryGb: 16, webGpu: 'available' }, 100);
    sendMessage.mockImplementation(async (message) => {
      if (message?.type === 'DETECT_PII') return { type: 'PII_RESULT', payload: { requestId: message.payload.requestId, spans: [] } };
      if (message?.type === 'GET_NER_STATUS') {
        return {
          type: 'NER_STATUS',
          payload: { mode: 'transformers', state: 'failed', message: 'WASM init failed' },
        };
      }
      return {};
    });

    const response = await new Promise((resolve) => {
      messageListener?.({ type: 'WARM_UP_LOCAL_AI', payload: { config: { ner_provider: 'transformers' } } }, {}, resolve);
    });

    expect(response).toEqual({
      type: 'NER_STATUS',
      payload: expect.objectContaining({ state: 'failed' }),
    });
    expect(store[SETTINGS_KEY]).toEqual(expect.objectContaining({ nerProvider: 'off' }));
    expect(store[SYSTEM_CHECK_STORAGE_KEY]).toEqual(expect.objectContaining({
      localAiState: 'off-load-failure',
      runtimeState: 'failed',
      loadFailure: expect.objectContaining({ message: 'WASM init failed' }),
    }));
  });

  test('successful warmup persists runtimeState=ready in system-check storage', async () => {
    await importWorker();
    store[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, nerProvider: 'transformers' };
    store[SYSTEM_CHECK_STORAGE_KEY] = buildSystemCheckResult({ browserMemoryGb: 32, webGpu: 'available' }, 100);
    sendMessage.mockImplementation(async (message) => {
      if (message?.type === 'DETECT_PII') return { type: 'PII_RESULT', payload: { requestId: message.payload.requestId, spans: [] } };
      if (message?.type === 'GET_NER_STATUS') {
        return {
          type: 'NER_STATUS',
          payload: { mode: 'transformers', state: 'ready', model: 'bardsai', device: 'webgpu' },
        };
      }
      return {};
    });

    await new Promise((resolve) => {
      messageListener?.({ type: 'WARM_UP_LOCAL_AI', payload: { config: { ner_provider: 'transformers' } } }, {}, resolve);
    });

    expect(store[SETTINGS_KEY]).toEqual(expect.objectContaining({ nerProvider: 'transformers' }));
    expect(store[SYSTEM_CHECK_STORAGE_KEY]).toEqual(expect.objectContaining({ runtimeState: 'ready' }));
  });

  test('retry after failure (re-enable then warmup ready) clears the load-failure marker', async () => {
    await importWorker();
    const failed = {
      ...buildSystemCheckResult({ browserMemoryGb: 32, webGpu: 'available' }, 100),
      localAiState: 'off-load-failure' as const,
      runtimeState: 'failed' as const,
      loadFailure: { message: 'old failure', at: 50 },
    };
    store[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, nerProvider: 'off' };
    store[SYSTEM_CHECK_STORAGE_KEY] = failed;

    sendMessage.mockImplementation(async (message) => {
      if (message?.type === 'DETECT_PII') return { type: 'PII_RESULT', payload: { requestId: message.payload.requestId, spans: [] } };
      if (message?.type === 'GET_NER_STATUS') return { type: 'NER_STATUS', payload: { mode: 'transformers', state: 'ready', model: 'bardsai' } };
      return {};
    });

    await new Promise((resolve) => {
      messageListener?.({ type: 'SET_LOCAL_AI_DETECTION', payload: { enabled: true } }, {}, resolve);
    });
    await new Promise((resolve) => {
      messageListener?.({ type: 'WARM_UP_LOCAL_AI', payload: { config: { ner_provider: 'transformers' } } }, {}, resolve);
    });

    expect(store[SETTINGS_KEY]).toEqual(expect.objectContaining({ nerProvider: 'transformers' }));
    expect(store[SYSTEM_CHECK_STORAGE_KEY]).toEqual(expect.objectContaining({
      localAiState: 'enabled',
      runtimeState: 'ready',
      loadFailure: undefined,
    }));
  });

  test('re-run system check updates stored compatibility without disabling Local AI on warning memory', async () => {
    await importWorker();
    store[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, nerProvider: 'transformers' };
    store[SYSTEM_CHECK_STORAGE_KEY] = buildSystemCheckResult({ browserMemoryGb: 32, webGpu: 'available' }, 100);
    sendMessage.mockImplementation(async (message) => {
      if (message?.type === 'COLLECT_SYSTEM_SIGNALS') {
        return { type: 'SYSTEM_SIGNALS', payload: { browserMemoryGb: 12, webGpu: 'available' } };
      }
      return {};
    });

    const response = await new Promise<any>((resolve) => {
      messageListener?.({ type: 'RE_RUN_SYSTEM_CHECK' }, {}, resolve);
    });

    expect(response.type).toBe('SYSTEM_COMPATIBILITY_STATUS');
    expect(response.payload).toEqual(expect.objectContaining({ tier: 'warning' }));
    expect(response.pendingCriticalRecommendation).toBe(false);
    expect(store[SETTINGS_KEY]).toEqual(expect.objectContaining({ nerProvider: 'transformers' }));
    expect(store[SYSTEM_CHECK_STORAGE_KEY]).toEqual(expect.objectContaining({ tier: 'warning' }));
  });

  test('re-run that becomes critical with Local AI on flags a pending recommendation but does not disable yet', async () => {
    await importWorker();
    store[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, nerProvider: 'transformers' };
    store[SYSTEM_CHECK_STORAGE_KEY] = buildSystemCheckResult({ browserMemoryGb: 32, webGpu: 'available' }, 100);
    sendMessage.mockImplementation(async (message) => {
      if (message?.type === 'COLLECT_SYSTEM_SIGNALS') {
        return { type: 'SYSTEM_SIGNALS', payload: { browserMemoryGb: 8, webGpu: 'available' } };
      }
      return {};
    });

    const response = await new Promise<any>((resolve) => {
      messageListener?.({ type: 'RE_RUN_SYSTEM_CHECK' }, {}, resolve);
    });

    expect(response.payload).toEqual(expect.objectContaining({
      tier: 'critical',
      recommendation: 'auto-disable-local-ai',
      localAiState: 'enabled',
      criticalModal: 'none',
    }));
    expect(response.pendingCriticalRecommendation).toBe(true);
    expect(store[SETTINGS_KEY]).toEqual(expect.objectContaining({ nerProvider: 'transformers' }));
  });

  test('re-run preserves explicit low-memory override and does not flag a pending recommendation', async () => {
    await importWorker();
    store[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, nerProvider: 'transformers' };
    store[SYSTEM_CHECK_STORAGE_KEY] = {
      ...buildSystemCheckResult({ browserMemoryGb: 8, webGpu: 'available' }, 100),
      localAiState: 'enabled-low-memory-override',
      lowMemoryOverride: true,
    };
    sendMessage.mockImplementation(async (message) => {
      if (message?.type === 'COLLECT_SYSTEM_SIGNALS') {
        return { type: 'SYSTEM_SIGNALS', payload: { browserMemoryGb: 8, webGpu: 'available' } };
      }
      return {};
    });

    const response = await new Promise<any>((resolve) => {
      messageListener?.({ type: 'RE_RUN_SYSTEM_CHECK' }, {}, resolve);
    });

    expect(response.pendingCriticalRecommendation).toBe(false);
    expect(store[SETTINGS_KEY]).toEqual(expect.objectContaining({ nerProvider: 'transformers' }));
    expect(store[SYSTEM_CHECK_STORAGE_KEY]).toEqual(expect.objectContaining({
      lowMemoryOverride: true,
      localAiState: 'enabled-low-memory-override',
    }));
  });

  test('re-run does not request a NER offscreen document or call GET_NER_STATUS', async () => {
    await importWorker();
    store[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, nerProvider: 'transformers' };
    store[SYSTEM_CHECK_STORAGE_KEY] = buildSystemCheckResult({ browserMemoryGb: 32, webGpu: 'available' }, 100);
    sendMessage.mockImplementation(async (message) => {
      if (message?.type === 'COLLECT_SYSTEM_SIGNALS') {
        return { type: 'SYSTEM_SIGNALS', payload: { browserMemoryGb: 32, webGpu: 'available' } };
      }
      return {};
    });

    await new Promise<any>((resolve) => {
      messageListener?.({ type: 'RE_RUN_SYSTEM_CHECK' }, {}, resolve);
    });

    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(createDocument.mock.calls[0][0].url).toContain('system-check/system-check-offscreen.html');
    const nerLoadCalled = sendMessage.mock.calls.some(([msg]) => msg?.type === 'GET_NER_STATUS' || msg?.type === 'DETECT_PII');
    expect(nerLoadCalled).toBe(false);
  });

  test('accepting a critical recommendation disables Local AI and re-pends the modal', async () => {
    await importWorker();
    store[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, nerProvider: 'transformers' };
    store[SYSTEM_CHECK_STORAGE_KEY] = {
      ...buildSystemCheckResult({ browserMemoryGb: 8, webGpu: 'available' }, 100),
      localAiState: 'enabled',
      criticalModal: 'dismissed',
    };
    hasDocument.mockResolvedValue(true);

    const response = await new Promise<any>((resolve) => {
      messageListener?.({ type: 'APPLY_CRITICAL_RECOMMENDATION', payload: { accepted: true } }, {}, resolve);
    });

    expect(response.type).toBe('SYSTEM_COMPATIBILITY_STATUS');
    expect(store[SETTINGS_KEY]).toEqual(expect.objectContaining({ nerProvider: 'off' }));
    expect(store[SYSTEM_CHECK_STORAGE_KEY]).toEqual(expect.objectContaining({
      localAiState: 'off-low-memory-auto',
      criticalModal: 'pending',
    }));
    expect(closeDocument).toHaveBeenCalledTimes(1);
  });

  test('declining a critical recommendation preserves Local AI and records the decline', async () => {
    await importWorker();
    store[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, nerProvider: 'transformers' };
    store[SYSTEM_CHECK_STORAGE_KEY] = {
      ...buildSystemCheckResult({ browserMemoryGb: 8, webGpu: 'available' }, 100),
      localAiState: 'enabled',
    };

    const response = await new Promise<any>((resolve) => {
      messageListener?.({ type: 'APPLY_CRITICAL_RECOMMENDATION', payload: { accepted: false } }, {}, resolve);
    });

    expect(response.type).toBe('SYSTEM_COMPATIBILITY_STATUS');
    expect(store[SETTINGS_KEY]).toEqual(expect.objectContaining({ nerProvider: 'transformers' }));
    const stored = store[SYSTEM_CHECK_STORAGE_KEY] as any;
    expect(stored.localAiState).toBe('enabled');
    expect(typeof stored.recommendationDeclinedAt).toBe('number');
    expect(stored.criticalModal).not.toBe('pending');
  });

  test('Local AI off status requests do not create the NER offscreen document', async () => {
    await importWorker();
    store[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, nerProvider: 'off' };

    const response = await new Promise((resolve) => {
      messageListener?.({ type: 'GET_NER_STATUS' }, {}, resolve);
    });

    expect(response).toEqual({
      type: 'NER_STATUS',
      payload: expect.objectContaining({ mode: 'off', state: 'unavailable' }),
    });
    expect(createDocument).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'GET_NER_STATUS' }));
  });

  test('supported-page activity does not warm Local AI when active-page warmup is disabled', async () => {
    await importWorker();
    store[SETTINGS_KEY] = {
      ...DEFAULT_SETTINGS,
      autoWarmLocalAiOnActiveSupportedPage: false,
    };
    store[SYSTEM_CHECK_STORAGE_KEY] = buildSystemCheckResult({ browserMemoryGb: 32, webGpu: 'available' }, 100);
    (chrome.tabs.query as jest.Mock).mockResolvedValue([{ id: 7, url: 'https://chatgpt.com/c/1' }]);

    const response = await new Promise((resolve) => {
      messageListener?.(
        { type: 'SUPPORTED_PAGE_ACTIVITY', payload: { visible: true } },
        { tab: { id: 7, url: 'https://chatgpt.com/c/1' } },
        resolve,
      );
    });

    expect(response).toEqual({ ok: true });
    expect(createDocument).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DETECT_PII' }));
  });

  test('supported-page activity can opt in to Local AI warmup on capable systems', async () => {
    await importWorker();
    store[SETTINGS_KEY] = {
      ...DEFAULT_SETTINGS,
      autoWarmLocalAiOnActiveSupportedPage: true,
    };
    store[SYSTEM_CHECK_STORAGE_KEY] = buildSystemCheckResult({ browserMemoryGb: 32, webGpu: 'available' }, 100);
    (chrome.tabs.query as jest.Mock).mockResolvedValue([{ id: 7, url: 'https://chatgpt.com/c/1' }]);
    sendMessage.mockImplementation(async (message) => {
      if (message?.type === 'OFFSCREEN_PING') return { type: 'OFFSCREEN_PONG' };
      if (message?.type === 'DETECT_PII') return { type: 'PII_RESULT', payload: { requestId: message.payload.requestId, spans: [] } };
      if (message?.type === 'GET_NER_STATUS') return { type: 'NER_STATUS', payload: { mode: 'transformers', state: 'ready', model: 'bardsai' } };
      return {};
    });

    await new Promise((resolve) => {
      messageListener?.(
        { type: 'SUPPORTED_PAGE_ACTIVITY', payload: { visible: true } },
        { tab: { id: 7, url: 'https://chatgpt.com/c/1' } },
        resolve,
      );
    });
    await flushAsyncWork();

    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'DETECT_PII' }));
    expect(store[SYSTEM_CHECK_STORAGE_KEY]).toEqual(expect.objectContaining({ runtimeState: 'ready' }));
  });
});
