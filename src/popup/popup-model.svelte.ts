import { derived, writable, get, type Readable, type Writable } from 'svelte/store';
import type {
  DetectionOptions,
  DetectPiiRequest,
  GetNerStatusRequest,
  GetSystemCompatibilityStatusRequest,
  GroupName,
  Message,
  NerModelKey,
  NerStatus,
  NerStatusChangedBroadcast,
  NerStatusResponse,
  PiiResultResponse,
  PiiSpan,
  ReplacementModeSetting,
  Settings,
  SettingsUpdatedMessage,
  SystemCompatibilityStatus,
  SystemCompatibilityStatusResponse,
} from '../shared/message-types';
import { ACTIVE_NER_MODELS, runtimeNerModelKey } from '../shared/constants';
import { GROUP_NAMES, GROUP_DEFAULT_ON, filterByGroup } from '../shared/category-groups';
import { applyAllowlistToText } from '../shared/feedback';
import { loadIdentityVault } from '../shared/identity-vault';
import { shouldAutoWarmLocalAi } from '../shared/local-ai-warmup-gate';
import { deriveResourceSummary, type ResourceSummary } from '../shared/popup-resource-summary';
import { PUBLIC_PROJECT_LINKS } from '../shared/project-links';
import { minResolvedThreshold, resolveThreshold } from '../shared/sensitivity-resolver';
import { SYSTEM_CHECK_STORAGE_KEY } from '../shared/system-check-storage';
import { clearEntityMaps, clearFeedback as clearFeedbackLog, getFeedbackLog, loadSettings, saveSettings } from '../shared/storage';

export type TabId = 'protect' | 'detect' | 'test' | 'settings';
export type TabDefinition = { id: TabId; label: string };
export type DetectionCategoryId = GroupName;
export type DetectionCategory = {
  id: GroupName;
  label: string;
  description: string;
  enabled: boolean;
  defaultEnabled: boolean;
};
export type FeedbackCounts = { confirmed: number; ignored: number; pending: number };
export type StatusTone = 'ok' | 'danger' | 'muted';
export type StatusPill = { label: string; tone: StatusTone; title?: string };

export type NavigationModel = { activeTab: Writable<TabId>; setActiveTab: (tab: TabId) => void };
export type ProtectionModel = {
  enabled: Writable<boolean>;
  wasmStatus: Writable<StatusPill>;
  nerStatus: Writable<StatusPill>;
  cpuFallback: Writable<boolean>;
  version: Writable<string>;
  modelLabel: Writable<string>;
  systemCompatibility: Writable<SystemCompatibilityStatus | null>;
  resourceSummary: Readable<ResourceSummary | null>;
  toggle: () => void;
  setEnabled: (enabled: boolean) => Promise<void>;
};
export type CategoriesModel = {
  categories: Writable<DetectionCategory[]>;
  enabledCount: Readable<number>;
  sensitivityMode: Writable<Settings['sensitivityMode']>;
  toggleCategory: (categoryId: GroupName) => void;
  setCategoryEnabled: (categoryId: GroupName, enabled: boolean) => Promise<void>;
  restoreDefaults: () => Promise<void>;
};
export type VaultModel = {
  memoryEnabled: Writable<boolean>;
  consistentReplacementMode: Writable<boolean>;
  mappingCount: Writable<number>;
  clearMappings: () => Promise<void>;
  openVaultOptions: () => void;
  setMemoryEnabled: (enabled: boolean) => Promise<void>;
  setReplacementMode: (mode: ReplacementModeSetting) => Promise<void>;
};
export type TestModel = {
  testInput: Writable<string>;
  isRunning: Writable<boolean>;
  resultText: Writable<string>;
  runCount: Writable<number>;
  feedbackCounts: Writable<FeedbackCounts>;
  runMockDetection: () => Promise<void>;
  runDetection: () => Promise<void>;
  clearFeedback: () => Promise<void>;
};
export type SettingsModel = {
  minConfidence: Writable<number>;
  debug: Writable<boolean>;
  clipboardInterceptEnabled: Writable<boolean>;
  nerModel: Writable<NerModelKey>;
  availableNerModels: typeof ACTIVE_NER_MODELS;
  openOptions: () => void;
  openIssueReport: () => void;
  openSecurityReport: () => void;
  openPrivacySupport: () => void;
  setMinConfidence: (value: number) => Promise<void>;
  setDebug: (enabled: boolean) => Promise<void>;
  setClipboardInterceptEnabled: (enabled: boolean) => Promise<void>;
  setNerModel: (model: NerModelKey) => Promise<void>;
};
export type AppModels = {
  navigation: NavigationModel;
  protection: ProtectionModel;
  categories: CategoriesModel;
  vault: VaultModel;
  test: TestModel;
  settings: SettingsModel;
};

export const tabs: TabDefinition[] = [
  { id: 'protect', label: 'Protect' },
  { id: 'detect', label: 'Detect' },
  { id: 'test', label: 'Test' },
  { id: 'settings', label: 'Settings' },
];

const CATEGORY_DESCRIPTIONS: Record<GroupName, string> = {
  Identity: 'Names, usernames',
  Contact: 'Email, phone, address',
  Financial: 'Cards, IBAN, accounts',
  Network: 'IP addresses',
  Location: 'Places and regions',
  Password: 'Secrets and keys',
  Organization: 'Companies and orgs',
  'Low-signal': 'URLs, dates, misc',
};

function categoriesFromSettings(settings: Settings): DetectionCategory[] {
  return GROUP_NAMES.map((group) => ({
    id: group,
    label: group,
    description: CATEGORY_DESCRIPTIONS[group],
    enabled: settings.groupsEnabled[group],
    defaultEnabled: GROUP_DEFAULT_ON[group],
  }));
}

async function broadcastSettings(settings: Settings): Promise<void> {
  const message: SettingsUpdatedMessage = { type: 'SETTINGS_UPDATED', payload: settings };
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => tab.id ? chrome.tabs.sendMessage(tab.id, message).catch(() => undefined) : undefined));
}

function modelLabelFor(key: NerModelKey): string {
  return ACTIVE_NER_MODELS.find((model) => model.key === key)?.label ?? key;
}

function status(label: string, tone: StatusTone, title?: string): StatusPill {
  return { label, tone, title };
}

function currentDetectionConfig(settings: Settings | null, nerModel: Writable<NerModelKey>): DetectionOptions {
  const provider = settings?.nerProvider ?? 'transformers';
  return { ner_provider: provider, ner_model: runtimeNerModelKey(get(nerModel)) };
}

function openExternalUrl(url: string): void {
  void chrome.tabs.create({ url });
}

export function createAppModels(): AppModels {
  let currentSettings: Settings | null = null;
  let lastNerStatus: NerStatus | null = null;

  const activeTab = writable<TabId>('protect');
  const enabled = writable(true);
  const wasmStatus = writable<StatusPill>(status('Loading...', 'muted'));
  const nerStatus = writable<StatusPill>(status('Loading...', 'muted'));
  const cpuFallback = writable(false);
  const version = writable(typeof chrome !== 'undefined' ? chrome.runtime.getManifest().version : '');
  const modelLabel = writable('');
  const systemCompatibility = writable<SystemCompatibilityStatus | null>(null);
  const nerStatusRaw = writable<NerStatus | null>(null);
  const settingsStore = writable<Settings | null>(null);
  const resourceSummary: Readable<ResourceSummary | null> = derived(
    [settingsStore, systemCompatibility, nerStatusRaw],
    ([$settings, $status, $ner]) => deriveResourceSummary($settings, $status, $ner),
  );

  const categories = writable<DetectionCategory[]>([]);
  const enabledCount = derived(categories, ($categories) => $categories.filter((category) => category.enabled).length);
  const sensitivityMode = writable<Settings['sensitivityMode']>('global');

  const memoryEnabled = writable(true);
  const consistentReplacementMode = writable(true);
  const mappingCount = writable(0);

  const testInput = writable("Hi, I'm Dana Reyes (dana@acme.io), card 4242 4242 4242 4242.");
  const isRunning = writable(false);
  const resultText = writable('');
  const runCount = writable(0);
  const feedbackCounts = writable<FeedbackCounts>({ confirmed: 0, ignored: 0, pending: 0 });

  const minConfidence = writable(0.5);
  const debug = writable(false);
  const clipboardInterceptEnabled = writable(true);
  const nerModel = writable<NerModelKey>('bardsai');

  function applySettings(settings: Settings): void {
    currentSettings = settings;
    settingsStore.set(settings);
    enabled.set(settings.enabled);
    categories.set(categoriesFromSettings(settings));
    sensitivityMode.set(settings.sensitivityMode);
    memoryEnabled.set(settings.identityVaultEnabled);
    consistentReplacementMode.set(settings.defaultReplacementMode === 'placeholder');
    minConfidence.set(settings.minConfidence);
    debug.set(settings.debug);
    clipboardInterceptEnabled.set(settings.clipboardInterceptEnabled);
    const normalizedModel = runtimeNerModelKey(settings.nerModel);
    nerModel.set(normalizedModel);
    modelLabel.set(modelLabelFor(normalizedModel));
  }

  async function refreshStats(): Promise<void> {
    const [feedback, vault] = await Promise.all([getFeedbackLog(), loadIdentityVault()]);
    feedbackCounts.set({ confirmed: feedback.length, ignored: currentSettings?.allowlist.length ?? 0, pending: 0 });
    mappingCount.set(vault.records.length);
  }

  async function saveAndBroadcast(partial: Partial<Settings>): Promise<void> {
    await saveSettings(partial);
    const updated = await loadSettings();
    applySettings(updated);
    await broadcastSettings(updated);
    await refreshStats();
  }

  async function probeWasm(): Promise<void> {
    try {
      const response: PiiResultResponse = await chrome.runtime.sendMessage({
        type: 'DETECT_PII',
        payload: { text: 'test', requestId: 'init_check', config: { ner_provider: 'off', ner_enabled: false } },
      } as DetectPiiRequest);
      wasmStatus.set(response?.type === 'PII_RESULT' ? status('Loaded', 'ok') : status('Not loaded', 'danger'));
    } catch {
      wasmStatus.set(status('Not loaded', 'danger'));
    }
  }

  async function fetchNerStatus(config?: DetectionOptions): Promise<NerStatus | null> {
    try {
      const request: GetNerStatusRequest = { type: 'GET_NER_STATUS', payload: { config } };
      const response: NerStatusResponse = await chrome.runtime.sendMessage(request);
      return response?.type === 'NER_STATUS' ? response.payload : null;
    } catch {
      return null;
    }
  }

  function renderNerStatus(statusValue: NerStatus): void {
    lastNerStatus = statusValue;
    nerStatusRaw.set(statusValue);
    cpuFallback.set(statusValue.mode === 'transformers' && statusValue.state === 'ready' && statusValue.device === 'wasm');
    if (statusValue.modelLabel) modelLabel.set(statusValue.modelLabel);
    const readyLabel = statusValue.modelLabel ? `Ready: ${shortModelLabel(statusValue.modelLabel)}` : 'Ready';
    const title = statusValue.message ? (statusValue.modelLabel ? `${statusValue.modelLabel}: ${statusValue.message}` : statusValue.message) : undefined;
    switch (statusValue.state) {
      case 'ready': nerStatus.set(status(readyLabel, 'ok', title)); break;
      case 'idle': nerStatus.set(status('Not loaded', 'muted', title)); break;
      case 'loading': nerStatus.set(status('Loading...', 'muted', title)); break;
      case 'failed': nerStatus.set(status('Failed', 'danger', title)); break;
      case 'unavailable': nerStatus.set(status('Unavailable', 'muted', title)); break;
    }
  }

  async function refreshNerStatus(config = currentDetectionConfig(currentSettings, nerModel)): Promise<void> {
    cpuFallback.set(false);
    nerStatus.set(status('Loading...', 'muted'));
    const statusValue = await fetchNerStatus(config);
    if (statusValue) renderNerStatus(statusValue);
    // If fetch failed (e.g., offscreen listener wasn't ready yet), leave the
    // "Loading..." pill in place. The offscreen will push NER_STATUS_CHANGED
    // once it transitions, so we don't need to synthesise a "Failed" label.
  }

  async function warmUpNer(config = currentDetectionConfig(currentSettings, nerModel)): Promise<void> {
    if (config.ner_provider === 'off') return;
    try {
      await chrome.runtime.sendMessage({
        type: 'DETECT_PII',
        payload: { text: 'warmup', requestId: `popup_warmup_${Date.now()}`, config },
      } as DetectPiiRequest);
    } catch {
      // refreshNerStatus will show cached failure/unavailable state where possible.
    }
  }

  async function fetchSystemCompatibility(): Promise<SystemCompatibilityStatus | null> {
    try {
      const request: GetSystemCompatibilityStatusRequest = { type: 'GET_SYSTEM_COMPATIBILITY_STATUS' };
      const response: SystemCompatibilityStatusResponse = await chrome.runtime.sendMessage(request);
      return response?.type === 'SYSTEM_COMPATIBILITY_STATUS' ? response.payload : null;
    } catch {
      return null;
    }
  }

  function applyLocalAiOffStatus(): void {
    lastNerStatus = null;
    nerStatusRaw.set(null);
    cpuFallback.set(false);
    nerStatus.set(status('Off', 'muted', 'Local AI detection is off. Pattern detection remains active.'));
  }

  async function init(): Promise<void> {
    const settings = await loadSettings();
    applySettings(settings);
    await refreshStats();
    void probeWasm();

    const systemStatus = await fetchSystemCompatibility();
    systemCompatibility.set(systemStatus);

    const config = currentDetectionConfig(currentSettings, nerModel);
    if (config.ner_provider === 'off') {
      applyLocalAiOffStatus();
      return;
    }

    if (!shouldAutoWarmLocalAi(currentSettings, systemStatus, lastNerStatus)) {
      // Resource-unsafe state (warning/critical-override/unknown/known
      // CPU/WASM fallback). Read cached runtime status without warming.
      await refreshNerStatus(config);
      return;
    }

    const warmup = warmUpNer(config);
    await refreshNerStatus(config);
    await warmup.catch(() => undefined);
    await refreshNerStatus(config);
  }

  function updateCategoryLocal(categoryId: GroupName, value: boolean): Record<GroupName, boolean> {
    const base = currentSettings?.groupsEnabled ?? Object.fromEntries(GROUP_NAMES.map((group) => [group, GROUP_DEFAULT_ON[group]])) as Record<GroupName, boolean>;
    return { ...base, [categoryId]: value };
  }

  async function setCategoryEnabled(categoryId: GroupName, value: boolean): Promise<void> {
    await saveAndBroadcast({ groupsEnabled: updateCategoryLocal(categoryId, value) });
  }

  async function runDetection(): Promise<void> {
    const text = get(testInput).trim();
    if (!text || isRunning && get(isRunning)) return;
    isRunning.set(true);
    resultText.set('Running detection pipeline...');
    nerStatus.set(status('Loading...', 'muted'));
    cpuFallback.set(false);
    try {
      const settings = await loadSettings();
      applySettings(settings);
      const request: DetectPiiRequest = {
        type: 'DETECT_PII',
        payload: {
          text,
          requestId: `popup_${Date.now()}`,
          config: { ...currentDetectionConfig(settings, nerModel), min_confidence: minResolvedThreshold(settings) },
        },
      };
      const response: PiiResultResponse = await chrome.runtime.sendMessage(request);
      if (response?.type !== 'PII_RESULT') {
        resultText.set('Error: Invalid response');
        return;
      }
      let spans = filterByGroup(response.payload.spans, settings.groupsEnabled);
      spans = applyAllowlistToText(text, spans, settings.allowlist);
      spans = spans.filter((span) => span.score >= resolveThreshold(settings, span.entity_type));
      const ner = await fetchNerStatus(currentDetectionConfig(settings, nerModel));
      if (ner) renderNerStatus(ner);
      const nerLine = ner ? formatNerStatusLine(ner) : '';
      const body = spans.length === 0 ? formatNoPii(response.payload.timings) : formatResults(spans, response.payload.timings);
      resultText.set(nerLine ? `${nerLine}\n\n${body}` : body);
      runCount.update((count) => count + 1);
    } catch (error) {
      resultText.set(`Error: ${error}`);
    } finally {
      isRunning.set(false);
      await refreshStats();
    }
  }

  const app: AppModels = {
    navigation: { activeTab, setActiveTab: activeTab.set },
    protection: {
      enabled,
      wasmStatus,
      nerStatus,
      cpuFallback,
      version,
      modelLabel,
      systemCompatibility,
      resourceSummary,
      toggle: () => void saveAndBroadcast({ enabled: !get(enabled) }),
      setEnabled: (value) => saveAndBroadcast({ enabled: value }),
    },
    categories: {
      categories,
      enabledCount,
      sensitivityMode,
      toggleCategory: (categoryId) => void setCategoryEnabled(categoryId, !(get(categories).find((category) => category.id === categoryId)?.enabled ?? false)),
      setCategoryEnabled,
      restoreDefaults: () => saveAndBroadcast({ groupsEnabled: { ...GROUP_DEFAULT_ON } }),
    },
    vault: {
      memoryEnabled,
      consistentReplacementMode,
      mappingCount,
      clearMappings: async () => { await clearEntityMaps(); await refreshStats(); },
      openVaultOptions: () => chrome.tabs.create({ url: `${chrome.runtime.getURL('options/options.html')}#vault-section` }),
      setMemoryEnabled: (value) => saveAndBroadcast({ identityVaultEnabled: value }),
      setReplacementMode: (mode) => saveAndBroadcast({ defaultReplacementMode: mode }),
    },
    test: {
      testInput,
      isRunning,
      resultText,
      runCount,
      feedbackCounts,
      runMockDetection: runDetection,
      runDetection,
      clearFeedback: async () => { await clearFeedbackLog(); await refreshStats(); },
    },
    settings: {
      minConfidence,
      debug,
      clipboardInterceptEnabled,
      nerModel,
      availableNerModels: ACTIVE_NER_MODELS,
      openOptions: () => chrome.runtime.openOptionsPage(),
      openIssueReport: () => openExternalUrl(PUBLIC_PROJECT_LINKS.newIssue),
      openSecurityReport: () => openExternalUrl(PUBLIC_PROJECT_LINKS.security),
      openPrivacySupport: () => openExternalUrl(PUBLIC_PROJECT_LINKS.support),
      setMinConfidence: (value) => saveAndBroadcast({ minConfidence: value }),
      setDebug: async (value) => { await saveSettings({ debug: value }); debug.set(value); },
      setClipboardInterceptEnabled: (value) => saveAndBroadcast({ clipboardInterceptEnabled: value }),
      setNerModel: async (model) => {
        const normalized = runtimeNerModelKey(model);
        await saveAndBroadcast({ nerModel: normalized });
        const config = currentDetectionConfig(currentSettings, nerModel);
        nerStatus.set(status('Loading...', 'muted'));
        cpuFallback.set(false);
        await warmUpNer(config).catch(() => undefined);
        await refreshNerStatus(config);
      },
    },
  };

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message: Message) => {
      if (message?.type === 'NER_STATUS_CHANGED') {
        renderNerStatus((message as NerStatusChangedBroadcast).payload);
      }
      return false;
    });
  }

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes['pg_settings']?.newValue) {
        applySettings(changes['pg_settings'].newValue as Settings);
        void refreshStats();
      }
      if (changes['pg_identity_vault']) void refreshStats();
      if (changes[SYSTEM_CHECK_STORAGE_KEY]) {
        const next = changes[SYSTEM_CHECK_STORAGE_KEY].newValue as SystemCompatibilityStatus | undefined;
        systemCompatibility.set(next ?? null);
      }
    });
  }

  void init();
  return app;
}

type Timings = NonNullable<PiiResultResponse['payload']['timings']>;

function formatTimings(timings?: Timings): string {
  if (!timings) return '';
  if (timings.nerMs !== undefined) return ` in ${timings.totalMs}ms (NER ${timings.nerMs}ms)`;
  return ` in ${timings.totalMs}ms`;
}
function formatNoPii(timings?: Timings): string { return `No obvious PII detected${formatTimings(timings)}. Review before sending — detection can miss things.`; }
function formatResults(spans: PiiSpan[], timings?: Timings): string {
  let output = `Found ${spans.length} PII span(s)${formatTimings(timings)}:\n\n`;
  for (const span of spans) {
    output += `  "${span.text}"\n`;
    output += `    Type: ${span.entity_type}\n`;
    output += `    Score: ${(span.score * 100).toFixed(1)}%\n`;
    output += `    Position: ${span.start}-${span.end}\n`;
    output += `    Source: ${span.source}\n\n`;
  }
  return output;
}
function formatNerStatusLine(statusValue: NerStatus): string {
  const model = statusValue.modelLabel ? `${statusValue.modelLabel}: ` : '';
  const label = statusValue.state === 'ready' ? 'NER ready'
    : statusValue.state === 'idle' ? 'NER not loaded'
    : statusValue.state === 'loading' ? 'NER loading'
    : statusValue.state === 'failed' ? 'NER failed'
    : 'NER unavailable';
  return statusValue.message ? `${model}${label}: ${statusValue.message}` : `${model}${label}`;
}
function shortModelLabel(label: string): string {
  if (label.startsWith('AI4Privacy')) return 'AI4Privacy';
  if (label.startsWith('BardsAI')) return 'BardsAI';
  if (label.startsWith('HikmaAI')) return 'HikmaAI';
  return label;
}
