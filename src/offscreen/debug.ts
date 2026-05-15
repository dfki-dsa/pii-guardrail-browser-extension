const SETTINGS_KEY = 'pg_settings';

let debugEnabled = false;

function readDebugFromSettings(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && (value as { debug?: unknown }).debug);
}

export function initDebugFlag(): void {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

  chrome.storage.local.get(SETTINGS_KEY).then((result) => {
    debugEnabled = readDebugFromSettings(result[SETTINGS_KEY]);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[SETTINGS_KEY]) return;
    debugEnabled = readDebugFromSettings(changes[SETTINGS_KEY].newValue);
  });
}

export function isDebugEnabled(): boolean {
  return debugEnabled;
}

export function debugLog(...args: unknown[]): void {
  if (debugEnabled) console.log(...args);
}
