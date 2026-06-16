import type { Settings, FeedbackEntry, NerModelKey, NerProviderMode, NerWebGpuDtype, GroupName, AllowlistEntry, BlocklistEntry, CancelDetectionBehavior, LocalAiUnloadTimeoutMs } from './message-types';
import { ENTITY_TYPES } from './message-types';
import { DEFAULT_SETTINGS, LOCAL_AI_UNLOAD_TIMEOUT_CHOICES, NER_WEBGPU_DTYPE_CHOICES, runtimeNerModelKey } from './constants';
import { GROUP_NAMES, GROUP_DEFAULT_ON } from './category-groups';

const SETTINGS_KEY = 'pg_settings';
const FEEDBACK_KEY = 'pg_feedback';
const ENTITY_MAPS_KEY = 'pg_entity_maps';

/** Load extension settings from chrome.storage.local. */
export async function loadSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY) ?? {};
  return normalizeSettings(result[SETTINGS_KEY]);
}

/** Save extension settings to chrome.storage.local. */
export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  const current = await loadSettings();
  const merged = normalizeSettings({ ...current, ...settings });
  await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
}

function isNerProviderMode(value: unknown): value is NerProviderMode {
  return value === 'off' || value === 'fixture' || value === 'transformers';
}

function isNerModelKey(value: unknown): value is NerModelKey {
  return value === 'ai4privacy' || value === 'bardsai' || value === 'hikmaai';
}

function isNerWebGpuDtype(value: unknown): value is NerWebGpuDtype {
  return (NER_WEBGPU_DTYPE_CHOICES as readonly unknown[]).includes(value);
}

function normalizeGroupsEnabled(raw: unknown): Record<GroupName, boolean> {
  const base: Record<GroupName, boolean> = {} as Record<GroupName, boolean>;
  for (const group of GROUP_NAMES) {
    const stored = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[group] : undefined;
    base[group] = typeof stored === 'boolean' ? stored : GROUP_DEFAULT_ON[group];
  }
  return base;
}

function normalizeGroupThresholds(raw: unknown): Partial<Record<GroupName, number>> {
  if (!raw || typeof raw !== 'object') return {};
  const result: Partial<Record<GroupName, number>> = {};
  for (const group of GROUP_NAMES) {
    const val = (raw as Record<string, unknown>)[group];
    if (typeof val === 'number' && val >= 0 && val <= 1) {
      result[group] = val;
    }
  }
  return result;
}

function isCancelDetectionBehavior(value: unknown): value is CancelDetectionBehavior {
  return value === 'ask' || value === 'paste-original' || value === 'drop';
}

function isLocalAiUnloadTimeoutMs(value: unknown): value is LocalAiUnloadTimeoutMs {
  return (LOCAL_AI_UNLOAD_TIMEOUT_CHOICES as readonly unknown[]).includes(value);
}

function normalizeAllowlist(raw: unknown): AllowlistEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is AllowlistEntry =>
    entry !== null &&
    typeof entry === 'object' &&
    typeof entry.pattern === 'string' &&
    entry.scope === 'any' &&
    typeof entry.addedAt === 'number' &&
    (entry.source === 'manual' || entry.source === 'detection')
  );
}

function normalizeBlocklist(raw: unknown): BlocklistEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is BlocklistEntry =>
    entry !== null &&
    typeof entry === 'object' &&
    typeof entry.pattern === 'string' &&
    (entry.scope === 'any' || (ENTITY_TYPES as readonly string[]).includes(entry.scope)) &&
    typeof entry.addedAt === 'number' &&
    (entry.source === 'manual' || entry.source === 'detection')
  );
}

function normalizeSettings(raw: unknown): Settings {
  const candidate = raw && typeof raw === 'object' ? raw as Partial<Settings> : {};
  const settings = { ...DEFAULT_SETTINGS, ...candidate };
  if (typeof settings.minConfidence !== 'number' || settings.minConfidence <= 0 || settings.minConfidence > 1) {
    settings.minConfidence = DEFAULT_SETTINGS.minConfidence;
  }
  if (!isNerProviderMode(settings.nerProvider)) {
    settings.nerProvider = DEFAULT_SETTINGS.nerProvider;
  }
  if (!isNerModelKey(settings.nerModel)) {
    settings.nerModel = DEFAULT_SETTINGS.nerModel;
  } else {
    settings.nerModel = runtimeNerModelKey(settings.nerModel);
  }
  if (!isNerWebGpuDtype(settings.nerWebGpuDtype)) {
    settings.nerWebGpuDtype = DEFAULT_SETTINGS.nerWebGpuDtype;
  }
  if (settings.sensitivityMode !== 'global' && settings.sensitivityMode !== 'individual') {
    settings.sensitivityMode = 'global';
  }
  if (
    settings.defaultReplacementMode !== 'placeholder' &&
    settings.defaultReplacementMode !== 'synthetic'
  ) {
    settings.defaultReplacementMode = DEFAULT_SETTINGS.defaultReplacementMode;
  }
  if (typeof settings.identityVaultEnabled !== 'boolean') {
    settings.identityVaultEnabled = DEFAULT_SETTINGS.identityVaultEnabled;
  }
  if (settings.theme !== 'dark' && settings.theme !== 'light') {
    settings.theme = DEFAULT_SETTINGS.theme;
  }
  if (typeof settings.clipboardInterceptEnabled !== 'boolean') {
    settings.clipboardInterceptEnabled = DEFAULT_SETTINGS.clipboardInterceptEnabled;
  }
  settings.groupsEnabled = normalizeGroupsEnabled(candidate.groupsEnabled);
  settings.groupThresholds = normalizeGroupThresholds(candidate.groupThresholds);
  settings.allowlist = normalizeAllowlist(candidate.allowlist);
  settings.blocklist = normalizeBlocklist(candidate.blocklist);
  if (typeof settings.skipCodeBlocks !== 'boolean') {
    settings.skipCodeBlocks = false;
  }
  if (!isCancelDetectionBehavior(settings.cancelDetectionBehavior)) {
    settings.cancelDetectionBehavior = DEFAULT_SETTINGS.cancelDetectionBehavior;
  }
  if (!isLocalAiUnloadTimeoutMs(settings.localAiUnloadTimeoutMs)) {
    settings.localAiUnloadTimeoutMs = DEFAULT_SETTINGS.localAiUnloadTimeoutMs;
  }
  if (typeof settings.keepLocalAiLoadedWhileActive !== 'boolean') {
    settings.keepLocalAiLoadedWhileActive = DEFAULT_SETTINGS.keepLocalAiLoadedWhileActive;
  }
  if (typeof settings.autoWarmLocalAiOnActiveSupportedPage !== 'boolean') {
    settings.autoWarmLocalAiOnActiveSupportedPage = DEFAULT_SETTINGS.autoWarmLocalAiOnActiveSupportedPage;
  }
  return settings;
}

/** Append a feedback entry to the log. */
export async function logFeedback(entry: FeedbackEntry): Promise<void> {
  const result = await chrome.storage.local.get(FEEDBACK_KEY) ?? {};
  const log: FeedbackEntry[] = result[FEEDBACK_KEY] || [];
  log.push(entry);
  // Keep last 1000 entries to avoid unbounded growth
  if (log.length > 1000) {
    log.splice(0, log.length - 1000);
  }
  await chrome.storage.local.set({ [FEEDBACK_KEY]: log });
}

/** Get all feedback entries. */
export async function getFeedbackLog(): Promise<FeedbackEntry[]> {
  const result = await chrome.storage.local.get(FEEDBACK_KEY) ?? {};
  return result[FEEDBACK_KEY] || [];
}

/** Clear all feedback entries. */
export async function clearFeedback(): Promise<void> {
  await chrome.storage.local.remove(FEEDBACK_KEY);
}

/** Entity map storage — keyed by conversation URL. */
export interface StoredEntityMap {
  [placeholder: string]: string;
}

/** Save an entity map for a specific conversation URL. */
export async function saveEntityMap(
  conversationUrl: string,
  map: StoredEntityMap
): Promise<void> {
  const result = await chrome.storage.local.get(ENTITY_MAPS_KEY) ?? {};
  const maps: Record<string, StoredEntityMap> = result[ENTITY_MAPS_KEY] || {};
  maps[conversationUrl] = { ...maps[conversationUrl], ...map };
  await chrome.storage.local.set({ [ENTITY_MAPS_KEY]: maps });
}

/** Load the entity map for a specific conversation URL. */
export async function loadEntityMap(
  conversationUrl: string
): Promise<StoredEntityMap> {
  const result = await chrome.storage.local.get(ENTITY_MAPS_KEY) ?? {};
  const maps: Record<string, StoredEntityMap> = result[ENTITY_MAPS_KEY] || {};
  return maps[conversationUrl] || {};
}

/** Clear entity maps for a specific conversation or all conversations. */
export async function clearEntityMaps(conversationUrl?: string): Promise<void> {
  if (conversationUrl) {
    const result = await chrome.storage.local.get(ENTITY_MAPS_KEY) ?? {};
    const maps: Record<string, StoredEntityMap> = result[ENTITY_MAPS_KEY] || {};
    delete maps[conversationUrl];
    await chrome.storage.local.set({ [ENTITY_MAPS_KEY]: maps });
  } else {
    await chrome.storage.local.remove(ENTITY_MAPS_KEY);
  }
}
