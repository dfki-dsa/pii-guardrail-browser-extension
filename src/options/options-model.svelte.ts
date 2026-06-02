import { writable, type Writable } from 'svelte/store';
import type {
  AllowlistEntry,
  BlocklistEntry,
  CancelDetectionBehavior,
  EntityType,
  GroupName,
  LocalAiUnloadTimeoutMs,
  ReplacementModeSetting,
  Settings,
  NerModelKey,
  NerStatusResponse,
  ReRunSystemCheckResponse,
  SettingsUpdatedMessage,
  SystemCompatibilityStatus,
  SystemCompatibilityStatusResponse,
} from '../shared/message-types';
import { GROUP_NAMES } from '../shared/category-groups';
import { findConflictingPattern } from '../shared/list-conflicts';
import {
  type IdentityRecord,
  type IdentityVaultData,
  deleteRecord,
  emptyVaultData,
  loadIdentityVault,
  recordsByRecency,
  saveIdentityVault,
  updateRecord,
} from '../shared/identity-vault';
import { loadSettings, saveSettings } from '../shared/storage';
import {
  buildSystemCheckResult,
  loadSystemCheckResult,
  saveSystemCheckResult,
  SYSTEM_CHECK_STORAGE_KEY,
  type SystemCheckResult,
} from '../shared/system-check-storage';

export type ListError = string | null;

export type OptionsModel = {
  settings: Writable<Settings | null>;
  vaultData: Writable<IdentityVaultData>;
  vaultRecords: Writable<IdentityRecord[]>;
  allowlistError: Writable<ListError>;
  blocklistError: Writable<ListError>;
  systemCompatibility: Writable<SystemCompatibilityStatus | null>;
  localAiWarmupState: Writable<'idle' | 'loading' | 'ready' | 'failed'>;
  groupNames: readonly GroupName[];

  setLocalAiDetection: (enabled: boolean) => Promise<void>;
  retryLocalAi: () => Promise<void>;
  rerunSystemCheck: () => Promise<void>;
  setNerModel: (model: NerModelKey) => Promise<void>;
  setLocalAiUnloadTimeoutMs: (value: LocalAiUnloadTimeoutMs) => Promise<void>;
  setKeepLocalAiLoadedWhileActive: (enabled: boolean) => Promise<void>;
  setAutoWarmLocalAiOnActiveSupportedPage: (enabled: boolean) => Promise<void>;
  setSensitivityMode: (mode: Settings['sensitivityMode']) => Promise<void>;
  setGlobalThreshold: (value: number) => Promise<void>;
  setGroupThreshold: (group: GroupName, value: number) => Promise<void>;

  addAllowlistEntry: (pattern: string) => Promise<boolean>;
  removeAllowlistEntry: (index: number) => Promise<void>;
  clearAllowlistError: () => void;

  addBlocklistEntry: (pattern: string, scope: EntityType) => Promise<boolean>;
  removeBlocklistEntry: (index: number) => Promise<void>;
  updateBlocklistCategory: (index: number, scope: EntityType) => Promise<void>;
  clearBlocklistError: () => void;

  setVaultEnabled: (enabled: boolean) => Promise<void>;
  setDefaultReplacementMode: (mode: ReplacementModeSetting) => Promise<void>;
  updateVaultRecord: (id: string, patch: Parameters<typeof updateRecord>[2]) => Promise<void>;
  deleteVaultRecord: (id: string) => Promise<void>;
  exportVault: () => void;
  importVault: (file: File) => Promise<{ imported: number } | { error: string }>;
  clearUnpinned: () => Promise<number>;

  setCancelDetectionBehavior: (value: CancelDetectionBehavior) => Promise<void>;
  setSkipCodeBlocks: (value: boolean) => Promise<void>;

  setDebug: (value: boolean) => Promise<void>;
  applyDebugSystemCheckScenario: (scenario: DebugSystemCheckScenario) => Promise<void>;
  clearDebugSystemCheck: () => Promise<void>;
};

export type DebugSystemCheckScenario =
  | 'ok-enabled'
  | 'warning-enabled'
  | 'unknown-enabled'
  | 'critical-auto-disabled'
  | 'critical-override'
  | 'cpu-fallback'
  | 'load-failure'
  | 'user-off';

async function broadcastSettings(settings: Settings): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return;
  const message: SettingsUpdatedMessage = { type: 'SETTINGS_UPDATED', payload: settings };
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map((tab) => (tab.id ? chrome.tabs.sendMessage(tab.id, message).catch(() => undefined) : undefined)),
  );
}

export function createOptionsModel(): OptionsModel {
  const settings = writable<Settings | null>(null);
  const vaultData = writable<IdentityVaultData>(emptyVaultData());
  const vaultRecords = writable<IdentityRecord[]>([]);
  const allowlistError = writable<ListError>(null);
  const blocklistError = writable<ListError>(null);
  const systemCompatibility = writable<SystemCompatibilityStatus | null>(null);
  const localAiWarmupState = writable<'idle' | 'loading' | 'ready' | 'failed'>('idle');

  let currentSettings: Settings | null = null;
  let currentSystemCompatibility: SystemCompatibilityStatus | null = null;
  let currentVault: IdentityVaultData = emptyVaultData();

  function applySettings(next: Settings): void {
    currentSettings = next;
    settings.set(next);
  }

  function applyVault(next: IdentityVaultData): void {
    currentVault = next;
    vaultData.set(next);
    vaultRecords.set(recordsByRecency(next));
  }

  async function saveAndBroadcast(partial: Partial<Settings>): Promise<void> {
    await saveSettings(partial);
    const updated = await loadSettings();
    applySettings(updated);
    await broadcastSettings(updated);
  }

  async function persistVault(): Promise<void> {
    await saveIdentityVault(currentVault);
    applyVault(currentVault);
  }

  async function loadSystemCompatibility(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    const response: SystemCompatibilityStatusResponse = await chrome.runtime.sendMessage({ type: 'GET_SYSTEM_COMPATIBILITY_STATUS' });
    if (response?.type === 'SYSTEM_COMPATIBILITY_STATUS') {
      currentSystemCompatibility = response.payload;
      systemCompatibility.set(response.payload);
    }
  }

  async function warmUpLocalAi(): Promise<void> {
    if (!currentSettings || typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    localAiWarmupState.set('loading');
    try {
      const response: NerStatusResponse = await chrome.runtime.sendMessage({
        type: 'WARM_UP_LOCAL_AI',
        payload: { config: { ner_provider: 'transformers', ner_model: currentSettings.nerModel } },
      });
      const failed = response?.payload?.state === 'failed' || response?.payload?.state === 'unavailable';
      localAiWarmupState.set(failed ? 'failed' : 'ready');
    } catch {
      localAiWarmupState.set('failed');
    }
    // Background may have flipped nerProvider to 'off' and recorded a load
    // failure; reflect that here so the retry path becomes visible.
    await loadSystemCompatibility();
    const updated = await loadSettings();
    applySettings(updated);
  }

  async function setLocalAiDetection(enabled: boolean): Promise<void> {
    if (enabled && currentSystemCompatibility?.tier === 'critical') {
      const confirmed = window.confirm(
        'Local AI detection can consume substantial memory on systems with critical browser-reported memory. Re-enable it only if you accept the risk of browser slowdown or instability.',
      );
      if (!confirmed) return;
    }

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      const response: SystemCompatibilityStatusResponse = await chrome.runtime.sendMessage({
        type: 'SET_LOCAL_AI_DETECTION',
        payload: { enabled },
      });
      if (response?.type === 'SYSTEM_COMPATIBILITY_STATUS') {
        currentSystemCompatibility = response.payload;
        systemCompatibility.set(response.payload);
      }
      const updated = await loadSettings();
      applySettings(updated);
      await broadcastSettings(updated);
    } else {
      await saveAndBroadcast({ nerProvider: enabled ? 'transformers' : 'off' });
    }

    localAiWarmupState.set('idle');
    if (enabled) await warmUpLocalAi();
  }

  async function retryLocalAi(): Promise<void> {
    await setLocalAiDetection(true);
  }

  async function rerunSystemCheck(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    const response: ReRunSystemCheckResponse = await chrome.runtime.sendMessage({ type: 'RE_RUN_SYSTEM_CHECK' });
    if (response?.type !== 'SYSTEM_COMPATIBILITY_STATUS') return;
    currentSystemCompatibility = response.payload;
    systemCompatibility.set(response.payload);

    if (response.pendingCriticalRecommendation) {
      const confirmed = window.confirm(
        'The system check now reports critical browser-reported memory. Turning Local AI detection off keeps pattern detection active and avoids exhausting browser resources. Disable Local AI now?',
      );
      const applied: SystemCompatibilityStatusResponse = await chrome.runtime.sendMessage({
        type: 'APPLY_CRITICAL_RECOMMENDATION',
        payload: { accepted: confirmed },
      });
      if (applied?.type === 'SYSTEM_COMPATIBILITY_STATUS') {
        currentSystemCompatibility = applied.payload;
        systemCompatibility.set(applied.payload);
      }
      if (confirmed) {
        const updated = await loadSettings();
        applySettings(updated);
        await broadcastSettings(updated);
      }
    }
  }

  async function init(): Promise<void> {
    const [loaded, vault] = await Promise.all([loadSettings(), loadIdentityVault()]);
    applySettings(loaded);
    applyVault(vault);
    await loadSystemCompatibility();
  }

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes['pg_settings']?.newValue) {
        applySettings(changes['pg_settings'].newValue as Settings);
      }
      if (changes['pg_identity_vault']?.newValue) {
        const next = changes['pg_identity_vault'].newValue as IdentityVaultData;
        if (next && Array.isArray(next.records)) applyVault(next);
      }
    });
  }

  void init();

  return {
    settings,
    vaultData,
    vaultRecords,
    allowlistError,
    blocklistError,
    systemCompatibility,
    localAiWarmupState,
    groupNames: GROUP_NAMES,

    setLocalAiDetection,
    retryLocalAi,
    rerunSystemCheck,
    setNerModel: (model) => saveAndBroadcast({ nerModel: model }),
    setLocalAiUnloadTimeoutMs: (value) => saveAndBroadcast({ localAiUnloadTimeoutMs: value }),
    setKeepLocalAiLoadedWhileActive: (enabled) => saveAndBroadcast({ keepLocalAiLoadedWhileActive: enabled }),
    setAutoWarmLocalAiOnActiveSupportedPage: (enabled) => saveAndBroadcast({ autoWarmLocalAiOnActiveSupportedPage: enabled }),
    setSensitivityMode: (mode) => saveAndBroadcast({ sensitivityMode: mode }),
    setGlobalThreshold: (value) => saveAndBroadcast({ minConfidence: value }),
    setGroupThreshold: async (group, value) => {
      const base = currentSettings?.groupThresholds ?? {};
      await saveAndBroadcast({ groupThresholds: { ...base, [group]: value } });
    },

    addAllowlistEntry: async (raw) => {
      const pattern = raw.trim();
      if (!pattern || !currentSettings) return false;
      const conflict = findConflictingPattern(pattern, currentSettings.blocklist);
      if (conflict) {
        allowlistError.set(`"${conflict}" is already on the blocklist. Remove it there before adding it to the allowlist.`);
        return false;
      }
      const entry: AllowlistEntry = { pattern, scope: 'any', addedAt: Date.now(), source: 'manual' };
      await saveAndBroadcast({ allowlist: [...currentSettings.allowlist, entry] });
      allowlistError.set(null);
      return true;
    },
    removeAllowlistEntry: async (index) => {
      if (!currentSettings) return;
      const next = currentSettings.allowlist.filter((_, i) => i !== index);
      await saveAndBroadcast({ allowlist: next });
    },
    clearAllowlistError: () => allowlistError.set(null),

    addBlocklistEntry: async (raw, scope) => {
      const pattern = raw.trim();
      if (!pattern || !currentSettings) return false;
      const conflict = findConflictingPattern(pattern, currentSettings.allowlist);
      if (conflict) {
        blocklistError.set(`"${conflict}" is already on the allowlist. Remove it there before adding it to the blocklist.`);
        return false;
      }
      const entry: BlocklistEntry = { pattern, scope, addedAt: Date.now(), source: 'manual' };
      await saveAndBroadcast({ blocklist: [...currentSettings.blocklist, entry] });
      blocklistError.set(null);
      return true;
    },
    removeBlocklistEntry: async (index) => {
      if (!currentSettings) return;
      const next = currentSettings.blocklist.filter((_, i) => i !== index);
      await saveAndBroadcast({ blocklist: next });
    },
    updateBlocklistCategory: async (index, scope) => {
      if (!currentSettings) return;
      const next = currentSettings.blocklist.map((entry, i) =>
        i === index ? { ...entry, scope } : entry,
      );
      await saveAndBroadcast({ blocklist: next });
    },
    clearBlocklistError: () => blocklistError.set(null),

    setVaultEnabled: (enabled) => saveAndBroadcast({ identityVaultEnabled: enabled }),
    setDefaultReplacementMode: (mode) => saveAndBroadcast({ defaultReplacementMode: mode }),
    updateVaultRecord: async (id, patch) => {
      updateRecord(currentVault, id, patch);
      await persistVault();
    },
    deleteVaultRecord: async (id) => {
      deleteRecord(currentVault, id);
      await persistVault();
    },
    exportVault: () => {
      const blob = new Blob([JSON.stringify(currentVault, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `privacy-guardrail-vault-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    importVault: async (file) => {
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!parsed || !Array.isArray(parsed.records)) {
          return { error: 'Invalid vault file: missing records array.' };
        }
        const existingKeys = new Set(currentVault.records.map((r) => `${r.entityType}::${r.normalizedKey}`));
        let imported = 0;
        for (const r of parsed.records) {
          const key = `${r.entityType}::${r.normalizedKey}`;
          if (!existingKeys.has(key)) {
            currentVault.records.push(r);
            existingKeys.add(key);
            imported += 1;
          }
        }
        if (parsed.counters && typeof parsed.counters === 'object') {
          for (const [type, count] of Object.entries(parsed.counters)) {
            if (typeof count === 'number') {
              const current = currentVault.counters[type as EntityType] ?? 0;
              if (count > current) currentVault.counters[type as EntityType] = count;
            }
          }
        }
        await persistVault();
        return { imported };
      } catch (error) {
        return { error: `Failed to import vault: ${error}` };
      }
    },
    clearUnpinned: async () => {
      const unpinned = currentVault.records.filter((r) => !r.pinned).length;
      if (unpinned === 0) return 0;
      currentVault.records = currentVault.records.filter((r) => r.pinned);
      await persistVault();
      return unpinned;
    },

    setCancelDetectionBehavior: (value) => saveAndBroadcast({ cancelDetectionBehavior: value }),
    setSkipCodeBlocks: (value) => saveAndBroadcast({ skipCodeBlocks: value }),

    setDebug: (value) => saveAndBroadcast({ debug: value }),
    applyDebugSystemCheckScenario: async (scenario) => {
      const result = buildDebugSystemCheckResult(scenario, await loadSystemCheckResult());
      await saveSystemCheckResult(result);
      currentSystemCompatibility = result;
      systemCompatibility.set(result);
      const partial = debugScenarioSettingsPatch(scenario);
      if (partial) {
        await saveSettings(partial);
        const updated = await loadSettings();
        applySettings(updated);
        await broadcastSettings(updated);
      }
    },
    clearDebugSystemCheck: async () => {
      if (typeof chrome === 'undefined' || !chrome.storage?.local?.remove) return;
      await chrome.storage.local.remove(SYSTEM_CHECK_STORAGE_KEY);
      currentSystemCompatibility = null;
      systemCompatibility.set(null);
      await loadSystemCompatibility();
    },
  };
}

function buildDebugSystemCheckResult(
  scenario: DebugSystemCheckScenario,
  previous: SystemCheckResult | null,
): SystemCheckResult {
  const now = Date.now();
  switch (scenario) {
    case 'ok-enabled':
      return {
        ...buildSystemCheckResult({ browserMemoryGb: 32, webGpu: 'available' }, now, previous),
        localAiState: 'enabled',
        runtimeState: previous?.runtimeState ?? 'not-loaded',
        criticalModal: 'none',
        lowMemoryOverride: false,
        recommendationDeclinedAt: undefined,
        loadFailure: undefined,
      };
    case 'warning-enabled':
      return {
        ...buildSystemCheckResult({ browserMemoryGb: 12, webGpu: 'available' }, now, previous),
        localAiState: 'enabled',
        criticalModal: 'none',
        lowMemoryOverride: false,
        recommendationDeclinedAt: undefined,
        loadFailure: undefined,
      };
    case 'unknown-enabled':
      return {
        ...buildSystemCheckResult({ browserMemoryGb: undefined, webGpu: 'unknown' }, now, previous),
        localAiState: 'enabled',
        criticalModal: 'none',
        lowMemoryOverride: false,
        recommendationDeclinedAt: undefined,
        loadFailure: undefined,
      };
    case 'critical-auto-disabled':
      return {
        ...buildSystemCheckResult({ browserMemoryGb: 8, webGpu: 'available' }, now, previous),
        localAiState: 'off-low-memory-auto',
        criticalModal: 'pending',
        lowMemoryOverride: false,
        loadFailure: undefined,
      };
    case 'critical-override':
      return {
        ...buildSystemCheckResult({ browserMemoryGb: 8, webGpu: 'available' }, now, previous),
        localAiState: 'enabled-low-memory-override',
        criticalModal: 'dismissed',
        lowMemoryOverride: true,
        loadFailure: undefined,
      };
    case 'cpu-fallback':
      return {
        ...buildSystemCheckResult({ browserMemoryGb: 32, webGpu: 'unavailable' }, now, previous),
        localAiState: 'enabled',
        criticalModal: 'none',
        lowMemoryOverride: false,
        loadFailure: undefined,
      };
    case 'load-failure':
      return {
        ...buildSystemCheckResult({ browserMemoryGb: 32, webGpu: 'available' }, now, previous),
        localAiState: 'off-load-failure',
        runtimeState: 'failed',
        criticalModal: 'none',
        lowMemoryOverride: false,
        loadFailure: { message: 'Debug-injected load failure', at: now },
      };
    case 'user-off':
      return {
        ...buildSystemCheckResult({ browserMemoryGb: 32, webGpu: 'available' }, now, previous),
        localAiState: 'off-user-choice',
        criticalModal: 'none',
        lowMemoryOverride: false,
        loadFailure: undefined,
      };
  }
}

function debugScenarioSettingsPatch(scenario: DebugSystemCheckScenario): Partial<Settings> | null {
  switch (scenario) {
    case 'critical-auto-disabled':
    case 'load-failure':
    case 'user-off':
      return { nerProvider: 'off' };
    case 'ok-enabled':
    case 'warning-enabled':
    case 'unknown-enabled':
    case 'critical-override':
    case 'cpu-fallback':
      return { nerProvider: 'transformers' };
    default:
      return null;
  }
}
