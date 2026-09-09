import { writable, derived } from 'svelte/store';
import type { Settings } from '../shared/message-types';
import { loadSettings, saveSettings } from '../shared/storage';
import { dismissOnboarding } from '../shared/onboarding-storage';

/**
 * onboarding answers, in the order a new user hits them: size first, then privacy, vault, speed.
 */
export const STEPS = [
  { label: 'Download', question: 'Lightweight browser extension' },
  { label: 'Privacy', question: 'Everything stays private' },
  { label: 'Vault', question: 'Private memory stored securely on your browser' },
  { label: 'Speed', question: 'Fast, local AI responses' },
] as const;

export function createOnboardingModel() {
  const settings = writable<Settings | null>(null);

  const localAiEnabled = derived(settings, ($settings) => $settings?.nerProvider !== 'off');
  const vaultEnabled = derived(settings, ($settings) => $settings?.identityVaultEnabled ?? true);

  async function applySettings(patch: Partial<Settings>): Promise<void> {
    await saveSettings(patch);
    settings.set(await loadSettings());
  }

  void loadSettings().then((loaded) => settings.set(loaded));

  return {
    settings,
    localAiEnabled,
    vaultEnabled,
    setLocalAiEnabled: async (enabled: boolean) => {
      // Mirrors the options page: 'off' unloads the runtime, 'transformers'
      // allows it to load again. The service worker owns the actual unload.
      await applySettings({ nerProvider: enabled ? 'transformers' : 'off' });
    },
    setVaultEnabled: (enabled: boolean) => applySettings({ identityVaultEnabled: enabled }),
    finish: async () => {
      await dismissOnboarding();
      // window.close() is a no-op on a tab the script did not open.
      const tab = await chrome.tabs.getCurrent();
      if (tab?.id !== undefined) await chrome.tabs.remove(tab.id);
      else window.close();
    },
  };
}
