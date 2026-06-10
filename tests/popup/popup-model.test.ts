import { get } from 'svelte/store';
import type { SystemCompatibilityStatus, Settings } from '../../src/shared/message-types';
import { DEFAULT_SETTINGS } from '../../src/shared/constants';

const SETTINGS_KEY = 'pg_settings';
const SYSTEM_CHECK_KEY = 'pg_system_check';

type SendMessageHandler = (message: any) => unknown;

interface Harness {
  sendMessage: jest.Mock;
  store: Record<string, unknown>;
  storageChangedListeners: Array<(changes: Record<string, { newValue?: unknown }>, area: string) => void>;
}

async function setupHarness(opts: {
  settings?: Partial<Settings>;
  systemStatus: SystemCompatibilityStatus | null;
  handle?: SendMessageHandler;
}): Promise<Harness> {
  jest.resetModules();
  const store: Record<string, unknown> = {
    [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, ...opts.settings },
  };
  if (opts.systemStatus) store[SYSTEM_CHECK_KEY] = opts.systemStatus;

  const storageChangedListeners: Harness['storageChangedListeners'] = [];

  const sendMessage = jest.fn(async (message: any) => {
    if (opts.handle) {
      const result = opts.handle(message);
      if (result !== undefined) return result;
    }
    if (message?.type === 'GET_SYSTEM_COMPATIBILITY_STATUS') {
      return opts.systemStatus
        ? { type: 'SYSTEM_COMPATIBILITY_STATUS', payload: opts.systemStatus }
        : {};
    }
    if (message?.type === 'GET_NER_STATUS') {
      return { type: 'NER_STATUS', payload: { mode: 'transformers', state: 'idle' } };
    }
    if (message?.type === 'DETECT_PII') {
      return { type: 'PII_RESULT', payload: { requestId: message.payload.requestId, spans: [] } };
    }
    return {};
  });

  (globalThis as any).chrome = {
    storage: {
      local: {
        get: jest.fn(async (key: string) => ({ [key]: store[key] })),
        set: jest.fn(async (value: Record<string, unknown>) => { Object.assign(store, value); }),
        remove: jest.fn(async (key: string) => { delete store[key]; }),
      },
      onChanged: {
        addListener: jest.fn((listener) => { storageChangedListeners.push(listener); }),
      },
    },
    runtime: {
      sendMessage,
      getURL: jest.fn((path: string) => `chrome-extension://test/${path}`),
      getManifest: jest.fn(() => ({ version: '0.0.0-test' })),
      openOptionsPage: jest.fn(),
    },
    tabs: {
      query: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
    },
  };

  return { sendMessage, store, storageChangedListeners };
}

async function flushInit(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

function detectPiiCalls(sendMessage: jest.Mock): unknown[] {
  return sendMessage.mock.calls
    .map(([m]) => m)
    .filter((m: any) => m?.type === 'DETECT_PII' && m.payload?.requestId?.startsWith?.('popup_warmup_'));
}

function okStatus(overrides: Partial<SystemCompatibilityStatus> = {}): SystemCompatibilityStatus {
  return {
    schemaVersion: 1,
    policyVersion: 1,
    checkedAt: 0,
    browserMemoryGb: 32,
    webGpu: 'available',
    tier: 'ok',
    recommendation: 'none',
    notes: [],
    localAiState: 'enabled',
    runtimeState: 'not-loaded',
    criticalModal: 'none',
    ...overrides,
  };
}

describe('createAppModels — resource-safe popup', () => {
  test('opens public support links in new tabs', async () => {
    await setupHarness({ systemStatus: okStatus() });
    const { createAppModels } = jest.requireActual<typeof import('../../src/popup/popup-model.svelte')>('../../src/popup/popup-model.svelte.ts');
    const { PUBLIC_PROJECT_LINKS } = jest.requireActual<typeof import('../../src/shared/project-links')>('../../src/shared/project-links');
    const app = createAppModels();

    app.settings.openIssueReport();
    app.settings.openSecurityReport();
    app.settings.openPrivacySupport();

    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: PUBLIC_PROJECT_LINKS.newIssue });
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: PUBLIC_PROJECT_LINKS.security });
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: PUBLIC_PROJECT_LINKS.support });
  });

  test('OK tier with Local AI on auto-warms the model', async () => {
    const h = await setupHarness({ systemStatus: okStatus() });
    const { createAppModels } = jest.requireActual<typeof import('../../src/popup/popup-model.svelte')>('../../src/popup/popup-model.svelte.ts');
    createAppModels();
    await flushInit();
    expect(detectPiiCalls(h.sendMessage).length).toBeGreaterThan(0);
  });

  test('warning tier does not auto-warm', async () => {
    const h = await setupHarness({
      systemStatus: okStatus({ tier: 'warning', browserMemoryGb: 12 }),
    });
    const { createAppModels } = jest.requireActual<typeof import('../../src/popup/popup-model.svelte')>('../../src/popup/popup-model.svelte.ts');
    createAppModels();
    await flushInit();
    expect(detectPiiCalls(h.sendMessage)).toHaveLength(0);
  });

  test('critical override does not auto-warm', async () => {
    const h = await setupHarness({
      systemStatus: okStatus({
        tier: 'critical',
        browserMemoryGb: 8,
        localAiState: 'enabled-low-memory-override',
      }),
    });
    const { createAppModels } = jest.requireActual<typeof import('../../src/popup/popup-model.svelte')>('../../src/popup/popup-model.svelte.ts');
    createAppModels();
    await flushInit();
    expect(detectPiiCalls(h.sendMessage)).toHaveLength(0);
  });

  test('unknown memory does not auto-warm', async () => {
    const h = await setupHarness({
      systemStatus: okStatus({ tier: 'unknown', browserMemoryGb: undefined }),
    });
    const { createAppModels } = jest.requireActual<typeof import('../../src/popup/popup-model.svelte')>('../../src/popup/popup-model.svelte.ts');
    createAppModels();
    await flushInit();
    expect(detectPiiCalls(h.sendMessage)).toHaveLength(0);
  });

  test('CPU/WASM fallback signal does not auto-warm', async () => {
    const h = await setupHarness({
      systemStatus: okStatus({ webGpu: 'unavailable' }),
    });
    const { createAppModels } = jest.requireActual<typeof import('../../src/popup/popup-model.svelte')>('../../src/popup/popup-model.svelte.ts');
    createAppModels();
    await flushInit();
    expect(detectPiiCalls(h.sendMessage)).toHaveLength(0);
  });

  test('Local AI off in settings does not warm or fetch NER status', async () => {
    const h = await setupHarness({
      settings: { nerProvider: 'off' },
      systemStatus: okStatus({ localAiState: 'off-user-choice' }),
    });
    const { createAppModels } = jest.requireActual<typeof import('../../src/popup/popup-model.svelte')>('../../src/popup/popup-model.svelte.ts');
    const app = createAppModels();
    await flushInit();

    expect(detectPiiCalls(h.sendMessage)).toHaveLength(0);
    const nerStatusCalls = h.sendMessage.mock.calls
      .map(([m]) => m)
      .filter((m: any) => m?.type === 'GET_NER_STATUS');
    expect(nerStatusCalls).toHaveLength(0);

    const pill = get(app.protection.nerStatus);
    expect(pill.label.toLowerCase()).toContain('off');
  });

  test('exposes a critical resource summary when Local AI auto-disabled', async () => {
    await setupHarness({
      settings: { nerProvider: 'off' },
      systemStatus: okStatus({
        tier: 'critical',
        browserMemoryGb: 8,
        localAiState: 'off-low-memory-auto',
      }),
    });
    const { createAppModels } = jest.requireActual<typeof import('../../src/popup/popup-model.svelte')>('../../src/popup/popup-model.svelte.ts');
    const app = createAppModels();
    await flushInit();
    const summary = get(app.protection.resourceSummary);
    expect(summary?.tone).toBe('critical');
    expect(summary?.title).toMatch(/low memory/i);
    expect(summary?.title).toMatch(/local inference disabled/i);
  });

  test('exposes a warning summary on warning tier with Local AI on', async () => {
    await setupHarness({
      systemStatus: okStatus({ tier: 'warning', browserMemoryGb: 12 }),
    });
    const { createAppModels } = jest.requireActual<typeof import('../../src/popup/popup-model.svelte')>('../../src/popup/popup-model.svelte.ts');
    const app = createAppModels();
    await flushInit();
    const summary = get(app.protection.resourceSummary);
    expect(summary?.tone).toBe('warning');
    expect(summary?.detail).toMatch(/12 GB/);
  });

  test('OK tier with Local AI on produces no resource summary copy', async () => {
    await setupHarness({ systemStatus: okStatus() });
    const { createAppModels } = jest.requireActual<typeof import('../../src/popup/popup-model.svelte')>('../../src/popup/popup-model.svelte.ts');
    const app = createAppModels();
    await flushInit();
    expect(get(app.protection.resourceSummary)).toBeNull();
  });
});
