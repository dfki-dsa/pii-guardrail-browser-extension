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
  onboardingHint?: unknown;
  loadOnboardingHint?: () => Promise<unknown>;
  /** What the active supported page answers about its message box, if any. */
  pageProtection?: { composerMatch: 'adapter' | 'generic' | 'none' | null } | 'no-page';
}): Promise<Harness> {
  jest.resetModules();
  const store: Record<string, unknown> = {
    [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, ...opts.settings },
  };
  if (opts.systemStatus) store[SYSTEM_CHECK_KEY] = opts.systemStatus;
  if (opts.onboardingHint !== undefined) store.pg_onboarding_hint = opts.onboardingHint;

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
        get: jest.fn(async (key: string) => {
          if (key === 'pg_onboarding_hint' && opts.loadOnboardingHint) {
            return { [key]: await opts.loadOnboardingHint() };
          }
          return { [key]: store[key] };
        }),
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
      query: jest.fn().mockResolvedValue(
        opts.pageProtection === undefined ? [] : [{ id: 7 }],
      ),
      create: jest.fn(),
      sendMessage: jest.fn(async () => {
        if (opts.pageProtection === undefined || opts.pageProtection === 'no-page') {
          // A tab with no content script never answers.
          throw new Error('Receiving end does not exist.');
        }
        return { type: 'PAGE_PROTECTION_STATE', payload: opts.pageProtection };
      }),
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
    policyVersion: 2,
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

describe('createAppModels — onboarding preference', () => {
  test('uses ordinary Help when the preference read fails', async () => {
    await setupHarness({
      systemStatus: okStatus(),
      loadOnboardingHint: async () => { throw new Error('storage unavailable'); },
    });
    const { createAppModels } = jest.requireActual<typeof import('../../src/popup/popup-model.svelte')>('../../src/popup/popup-model.svelte.ts');
    const app = createAppModels();
    await flushInit();

    expect(get(app.onboarding.hintStatus)).toBeNull();
    expect(get(app.onboarding.invitationVisible)).toBe(false);
  });

  test('does not let a late preference read overwrite local acknowledgement', async () => {
    let resolveHint: ((value: unknown) => void) | undefined;
    await setupHarness({
      systemStatus: okStatus(),
      loadOnboardingHint: () => new Promise((resolve) => { resolveHint = resolve; }),
    });
    const { createAppModels } = jest.requireActual<typeof import('../../src/popup/popup-model.svelte')>('../../src/popup/popup-model.svelte.ts');
    const app = createAppModels();
    for (let i = 0; i < 10 && !resolveHint; i += 1) await Promise.resolve();

    app.onboarding.acknowledgeHint();
    resolveHint?.({ schemaVersion: 1, status: 'new' });
    await flushInit();

    expect(get(app.onboarding.hintStatus)).toBe('acknowledged');
    expect(get(app.onboarding.invitationVisible)).toBe(false);
  });

  test('validates storage changes and preserves valid acknowledged/existing statuses', async () => {
    const h = await setupHarness({ systemStatus: okStatus() });
    const { createAppModels } = jest.requireActual<typeof import('../../src/popup/popup-model.svelte')>('../../src/popup/popup-model.svelte.ts');
    const app = createAppModels();
    await flushInit();
    const change = (value: unknown) => h.storageChangedListeners.forEach((listener) => listener({
      pg_onboarding_hint: { newValue: value },
    }, 'local'));

    change({ schemaVersion: 1, status: 'existing' });
    expect(get(app.onboarding.hintStatus)).toBe('existing');
    expect(get(app.onboarding.invitationVisible)).toBe(false);
    change({ schemaVersion: 1, status: 'acknowledged' });
    expect(get(app.onboarding.hintStatus)).toBe('acknowledged');
    change({ schemaVersion: 2, status: 'new' });
    expect(get(app.onboarding.hintStatus)).toBeNull();
    expect(get(app.onboarding.invitationVisible)).toBe(false);
    change({ schemaVersion: 1, status: 'new' });
    expect(get(app.onboarding.hintStatus)).toBe('new');
    expect(get(app.onboarding.invitationVisible)).toBe(true);
  });

  test('reconciles a rejected acknowledgement with the durable new state', async () => {
    const h = await setupHarness({
      systemStatus: okStatus(),
      onboardingHint: { schemaVersion: 1, status: 'new' },
      handle: (message) => message?.type === 'ACKNOWLEDGE_ONBOARDING_HINT'
        ? Promise.reject(new Error('worker unavailable'))
        : undefined,
    });
    const { createAppModels } = jest.requireActual<typeof import('../../src/popup/popup-model.svelte')>('../../src/popup/popup-model.svelte.ts');
    const app = createAppModels();
    await flushInit();

    await app.onboarding.acknowledgeHint();

    expect(get(app.onboarding.hintStatus)).toBe('new');
    expect(get(app.onboarding.invitationVisible)).toBe(true);
    expect(h.sendMessage.mock.calls.filter(([message]) => message?.type === 'ACKNOWLEDGE_ONBOARDING_HINT')).toHaveLength(3);
  });

  test('reconciles an acknowledged:false response instead of retaining an optimistic acknowledgement', async () => {
    const h = await setupHarness({
      systemStatus: okStatus(),
      onboardingHint: { schemaVersion: 1, status: 'new' },
      handle: (message) => message?.type === 'ACKNOWLEDGE_ONBOARDING_HINT'
        ? { type: 'ONBOARDING_HINT_ACKNOWLEDGED', payload: { acknowledged: false } }
        : undefined,
    });
    const { createAppModels } = jest.requireActual<typeof import('../../src/popup/popup-model.svelte')>('../../src/popup/popup-model.svelte.ts');
    const app = createAppModels();
    await flushInit();

    await app.onboarding.acknowledgeHint();

    expect(get(app.onboarding.hintStatus)).toBe('new');
    expect(get(app.onboarding.invitationVisible)).toBe(true);
    expect(h.sendMessage.mock.calls.filter(([message]) => message?.type === 'ACKNOWLEDGE_ONBOARDING_HINT')).toHaveLength(1);
  });

  test('treats an untyped acknowledgement response as a definitive failure', async () => {
    const h = await setupHarness({
      systemStatus: okStatus(),
      onboardingHint: { schemaVersion: 1, status: 'new' },
      handle: (message) => message?.type === 'ACKNOWLEDGE_ONBOARDING_HINT'
        ? { type: 'ONBOARDING_HINT_ACKNOWLEDGED', payload: {} }
        : undefined,
    });
    const { createAppModels } = jest.requireActual<typeof import('../../src/popup/popup-model.svelte')>('../../src/popup/popup-model.svelte.ts');
    const app = createAppModels();
    await flushInit();

    await app.onboarding.acknowledgeHint();

    expect(get(app.onboarding.hintStatus)).toBe('new');
    expect(get(app.onboarding.invitationVisible)).toBe(true);
    expect(h.sendMessage.mock.calls.filter(([message]) => message?.type === 'ACKNOWLEDGE_ONBOARDING_HINT')).toHaveLength(1);
  });

  test('keeps acknowledgement hidden after a successful retry', async () => {
    let attempts = 0;
    const h = await setupHarness({
      systemStatus: okStatus(),
      onboardingHint: { schemaVersion: 1, status: 'new' },
      handle: (message) => {
        if (message?.type !== 'ACKNOWLEDGE_ONBOARDING_HINT') return undefined;
        attempts += 1;
        if (attempts === 1) return Promise.reject(new Error('worker restarting'));
        return { type: 'ONBOARDING_HINT_ACKNOWLEDGED', payload: { acknowledged: true } };
      },
    });
    const { createAppModels } = jest.requireActual<typeof import('../../src/popup/popup-model.svelte')>('../../src/popup/popup-model.svelte.ts');
    const app = createAppModels();
    await flushInit();

    await app.onboarding.acknowledgeHint();

    expect(attempts).toBe(2);
    expect(get(app.onboarding.hintStatus)).toBe('acknowledged');
    expect(get(app.onboarding.invitationVisible)).toBe(false);
    expect(h.sendMessage.mock.calls.filter(([message]) => message?.type === 'ACKNOWLEDGE_ONBOARDING_HINT')).toHaveLength(2);
  });

  test('does not duplicate concurrent acknowledgement attempts', async () => {
    let resolveAcknowledgement: ((response: unknown) => void) | undefined;
    const h = await setupHarness({
      systemStatus: okStatus(),
      onboardingHint: { schemaVersion: 1, status: 'new' },
      handle: (message) => message?.type === 'ACKNOWLEDGE_ONBOARDING_HINT'
        ? new Promise((resolve) => { resolveAcknowledgement = resolve; })
        : undefined,
    });
    const { createAppModels } = jest.requireActual<typeof import('../../src/popup/popup-model.svelte')>('../../src/popup/popup-model.svelte.ts');
    const app = createAppModels();
    await flushInit();

    const first = app.onboarding.acknowledgeHint();
    const second = app.onboarding.acknowledgeHint();
    await Promise.resolve();
    expect(h.sendMessage.mock.calls.filter(([message]) => message?.type === 'ACKNOWLEDGE_ONBOARDING_HINT')).toHaveLength(1);

    resolveAcknowledgement?.({ type: 'ONBOARDING_HINT_ACKNOWLEDGED', payload: { acknowledged: true } });
    await Promise.all([first, second]);
    expect(get(app.onboarding.hintStatus)).toBe('acknowledged');
  });
});

describe('createAppModels — page protection state', () => {
  test('reports that the page is being matched generically', async () => {
    // User story 12: the extension says when it is running on a generic match
    // of the page, so the user can tell that something about the site changed.
    await setupHarness({ systemStatus: okStatus(), pageProtection: { composerMatch: 'generic' } });
    const { createAppModels } = jest.requireActual<typeof import('../../src/popup/popup-model.svelte')>('../../src/popup/popup-model.svelte.ts');
    const app = createAppModels();
    await flushInit();

    expect(get(app.protection.composerMatch)).toBe('generic');
  });

  test('says nothing when the adapter is matching the page', async () => {
    await setupHarness({ systemStatus: okStatus(), pageProtection: { composerMatch: 'adapter' } });
    const { createAppModels } = jest.requireActual<typeof import('../../src/popup/popup-model.svelte')>('../../src/popup/popup-model.svelte.ts');
    const app = createAppModels();
    await flushInit();

    expect(get(app.protection.composerMatch)).toBe('adapter');
  });

  test('says nothing about a tab that cannot answer', async () => {
    await setupHarness({ systemStatus: okStatus(), pageProtection: 'no-page' });
    const { createAppModels } = jest.requireActual<typeof import('../../src/popup/popup-model.svelte')>('../../src/popup/popup-model.svelte.ts');
    const app = createAppModels();
    await flushInit();

    expect(get(app.protection.composerMatch)).toBeNull();
  });
});

describe('createAppModels — resource-safe popup', () => {
  test('opens public support and legal links in new tabs', async () => {
    await setupHarness({ systemStatus: okStatus() });
    const { createAppModels } = jest.requireActual<typeof import('../../src/popup/popup-model.svelte')>('../../src/popup/popup-model.svelte.ts');
    const { packagedTermsUrl, PUBLIC_PROJECT_LINKS } = jest.requireActual<typeof import('../../src/shared/project-links')>('../../src/shared/project-links');
    const app = createAppModels();

    app.settings.openIssueReport();
    app.settings.openSecurityReport();
    app.settings.openPrivacySupport();
    app.settings.openPrivacyPolicy();
    app.settings.openTermsOfUse();
    app.settings.openImpressum();

    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: PUBLIC_PROJECT_LINKS.newIssue });
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: PUBLIC_PROJECT_LINKS.security });
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: PUBLIC_PROJECT_LINKS.support });
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: PUBLIC_PROJECT_LINKS.privacy });
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: packagedTermsUrl() });
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: PUBLIC_PROJECT_LINKS.impressum });
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
      systemStatus: okStatus({ tier: 'warning', browserMemoryGb: 4 }),
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
        browserMemoryGb: 2,
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
        browserMemoryGb: 2,
        localAiState: 'off-low-memory-auto',
      }),
    });
    const { createAppModels } = jest.requireActual<typeof import('../../src/popup/popup-model.svelte')>('../../src/popup/popup-model.svelte.ts');
    const app = createAppModels();
    await flushInit();
    const summary = get(app.protection.resourceSummary);
    expect(summary?.tone).toBe('critical');
    expect(summary?.title).toMatch(/low memory protection mode/i);
  });

  test('exposes a warning summary on warning tier with Local AI on', async () => {
    await setupHarness({
      systemStatus: okStatus({ tier: 'warning', browserMemoryGb: 4 }),
    });
    const { createAppModels } = jest.requireActual<typeof import('../../src/popup/popup-model.svelte')>('../../src/popup/popup-model.svelte.ts');
    const app = createAppModels();
    await flushInit();
    const summary = get(app.protection.resourceSummary);
    expect(summary?.tone).toBe('warning');
    expect(summary?.detail).toMatch(/4 GB/);
  });

  test('OK tier with Local AI on produces no resource summary copy', async () => {
    await setupHarness({ systemStatus: okStatus() });
    const { createAppModels } = jest.requireActual<typeof import('../../src/popup/popup-model.svelte')>('../../src/popup/popup-model.svelte.ts');
    const app = createAppModels();
    await flushInit();
    expect(get(app.protection.resourceSummary)).toBeNull();
  });
});
