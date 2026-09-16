import { writable, derived } from 'svelte/store';
import type { Settings, SettingsUpdatedMessage } from '../shared/message-types';
import { loadSettings, saveSettings } from '../shared/storage';
import { dismissOnboarding } from '../shared/onboarding-storage';

/**
 * onboarding answers, in the order a new user hits them: size first, then privacy, vault, speed.
 */
export const STEPS = [
  { label: 'Download', question: 'Lightweight browser extension' },
  { label: 'Privacy', question: 'Everything stays private' },
  { label: 'Vault', question: 'Private memory stored locally in your browser' },
  { label: 'Speed', question: 'Fast, local AI detection' },
] as const;

export function createOnboardingModel() {
  const settings = writable<Settings | null>(null);

  const localAiEnabled = derived(settings, ($settings) => $settings?.nerProvider !== 'off');
  const vaultEnabled = derived(settings, ($settings) => $settings?.identityVaultEnabled ?? true);

  /**
   * `saveSettings` only writes storage. Content scripts re-read settings from
   * the SETTINGS_UPDATED broadcast alone, so without this an open ChatGPT tab
   * keeps the old vault and Local AI behaviour until it is reloaded.
   */
  async function applySettings(patch: Partial<Settings>): Promise<void> {
    await saveSettings(patch);
    const updated = await loadSettings();
    settings.set(updated);
    await broadcast(updated);
  }

  async function broadcast(updated: Settings): Promise<void> {
    const message: SettingsUpdatedMessage = { type: 'SETTINGS_UPDATED', payload: updated };
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs.map((tab) => (tab.id ? chrome.tabs.sendMessage(tab.id, message).catch(() => undefined) : undefined)),
    );
  }

  void loadSettings().then((loaded) => settings.set(loaded));

  return {
    settings,
    localAiEnabled,
    vaultEnabled,
    setLocalAiEnabled: async (enabled: boolean) => {
      // Routed through the background rather than written directly, so the
      // resource guard's bookkeeping runs: a low-memory override is recorded
      // when the system is critical, the offscreen runtime is closed on
      // disable, and localAiState stays consistent with what the popup and
      // options page report.
      await chrome.runtime.sendMessage({
        type: 'SET_LOCAL_AI_DETECTION',
        payload: { enabled },
      });
      const updated = await loadSettings();
      settings.set(updated);
      await broadcast(updated);
    },
    setVaultEnabled: (enabled: boolean) => applySettings({ identityVaultEnabled: enabled }),
     finish: async () => {
      const saved = await dismissOnboarding();
      if (!saved) return;
      // window.close() is a no-op on a tab the script did not open.
      const tab = await chrome.tabs.getCurrent();
      if (tab?.id !== undefined) await chrome.tabs.remove(tab.id);
      else window.close();
    },
  };
}
