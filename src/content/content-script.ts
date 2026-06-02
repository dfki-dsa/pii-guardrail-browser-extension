/**
 * Privacy Guardrail — Content Script
 *
 * Injected into curated LLM chat pages. Orchestrates:
 * 1. Paste interception → WASM detection → review overlay → anonymized insert
 * 2. Response observation → de-anonymization banner → reveal/hide toggle
 * 3. Feedback logging → adaptive threshold computation
 */

import type { SiteAdapter } from './site-adapters/adapter-interface';
import { ChatGptAdapter } from './site-adapters/chatgpt-adapter';
import { ClaudeAdapter } from './site-adapters/claude-adapter';
import { GeminiAdapter } from './site-adapters/gemini-adapter';
import { GenericAdapter } from './site-adapters/generic-adapter';
import { PasteInterceptor } from './paste-interceptor';
import { shouldShowCriticalLocalAiModal } from './critical-local-ai-modal-status';
import { ResponseObserver } from './response-observer';
import { ClipboardInterceptor } from './clipboard-interceptor';
import { resolveText } from '../shared/placeholder-resolver';
import { ReviewOverlay } from '../ui/overlay/overlay';
import { ScanningIndicator } from '../ui/scanning-indicator/scanning-indicator';
import { CancelDecisionDialog } from '../ui/cancel-decision-dialog/cancel-decision-dialog';
import { CriticalLocalAiModal } from '../ui/critical-local-ai-modal/critical-local-ai-modal';
import { PageStatusChip } from '../ui/page-status-chip/page-status-chip';
import { deriveChipReason } from '../shared/page-status-chip-reason';
import { SYSTEM_CHECK_STORAGE_KEY } from '../shared/system-check-storage';
import { attachDeAnonBanner } from '../ui/banner/de-anon-banner';
import { anonymize, anonymizeWithVault } from '../shared/anonymizer';
import { EntityMap } from '../shared/entity-map';
import { augmentEntityMap } from '../shared/entity-map-augment';
import {
  loadSettings,
  saveSettings,
  loadEntityMap,
  saveEntityMap,
  logFeedback,
} from '../shared/storage';
import { findConflictingPattern } from '../shared/list-conflicts';
import {
  type IdentityVaultData,
  type ReplacementMode,
  emptyVaultData,
  loadIdentityVault,
  saveIdentityVault,
  findRecord,
  activeReplacement,
  normalizeKey,
} from '../shared/identity-vault';
import { placeholder as makePlaceholder } from '../shared/constants';
import {
  generateSyntheticValue,
  supportsSynthetic,
} from '../shared/synthetic-pool';
import type { PreviewResolverFactory } from '../ui/overlay/overlay';
import {
  computeAdaptiveThresholds,
} from '../shared/feedback';
import { prepareReviewSpans } from './review-spans';
import { resolveThreshold } from '../shared/sensitivity-resolver';
import { LOCAL_AI_ACTIVITY_HEARTBEAT_MS, NO_PII_INDICATOR_MS, CHIP_FADE_MS } from '../shared/constants';
import type { PiiSpan, FeedbackEntry, Settings, AllowlistEntry, CancelDetectionBehavior, NerStatus, NerStatusResponse, SystemCompatibilityStatus, SystemCompatibilityStatusResponse } from '../shared/message-types';

// --- Adapter selection ---

function selectAdapter(): SiteAdapter {
  const host = window.location.hostname;
  if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) {
    return new ChatGptAdapter();
  }
  if (host.includes('claude.ai')) {
    return new ClaudeAdapter();
  }
  if (host.includes('gemini.google.com')) {
    return new GeminiAdapter();
  }
  return new GenericAdapter();
}

// --- State ---

const adapter = selectAdapter();
let entityMap = new EntityMap();
let settings: Settings;
let adaptiveThresholds: Record<string, number> = {};
const conversationUrl = window.location.href.split('?')[0];
let scanningIndicator: ScanningIndicator | null = null;
let pageStatusChip: PageStatusChip | null = null;
let lastSystemStatus: SystemCompatibilityStatus | null = null;
let lastNerStatus: NerStatus | null = null;
let activityListenersStarted = false;
let lastActivityHeartbeatAt = 0;
/**
 * In-memory copy of the identity vault. Loaded once at init, kept up to
 * date by listening for chrome.storage changes (so an edit made in the
 * options page or another tab is visible here without a reload).
 */
let identityVault: IdentityVaultData = emptyVaultData();

function reportSupportedPageActivity(visible: boolean, force = false): void {
  if (visible && !settings?.enabled) return;
  const now = Date.now();
  if (visible && !force && now - lastActivityHeartbeatAt < LOCAL_AI_ACTIVITY_HEARTBEAT_MS) return;
  lastActivityHeartbeatAt = now;
  chrome.runtime.sendMessage({
    type: 'SUPPORTED_PAGE_ACTIVITY',
    payload: { visible },
  }).catch(() => undefined);
}

function reportUserActivity(): void {
  if (document.visibilityState !== 'visible') return;
  reportSupportedPageActivity(true);
}

function reportVisibility(): void {
  reportSupportedPageActivity(document.visibilityState === 'visible', true);
}

function startSupportedPageActivityHeartbeat(): void {
  if (activityListenersStarted) return;
  activityListenersStarted = true;
  const options: AddEventListenerOptions = { passive: true };
  window.addEventListener('pointermove', reportUserActivity, options);
  window.addEventListener('pointerdown', reportUserActivity, options);
  window.addEventListener('keydown', reportUserActivity, options);
  window.addEventListener('scroll', reportUserActivity, options);
  window.addEventListener('touchstart', reportUserActivity, options);
  window.addEventListener('paste', reportUserActivity, options);
  window.addEventListener('focus', reportVisibility, options);
  window.addEventListener('blur', () => reportSupportedPageActivity(false, true), options);
  window.addEventListener('pagehide', () => reportSupportedPageActivity(false, true), options);
  document.addEventListener('visibilitychange', reportVisibility);
  reportVisibility();
}

// --- UI indicator ---

async function maybeShowCriticalLocalAiModal(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_SYSTEM_COMPATIBILITY_STATUS' }) as SystemCompatibilityStatusResponse;
    const status = response?.payload;
    if (!shouldShowCriticalLocalAiModal(status)) {
      return;
    }

    const modal = new CriticalLocalAiModal(settings.theme, {
      onDismiss: async () => {
        await chrome.runtime.sendMessage({ type: 'DISMISS_CRITICAL_LOCAL_AI_MODAL' });
      },
      onOpenSettings: async () => {
        const url = chrome.runtime.getURL('options/options.html');
        await chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS_PAGE', payload: { url } });
      },
    });
    modal.show();
  } catch (err) {
    if (settings?.debug) {
      console.warn('[PG:content] Failed to show Local AI resource modal', err);
    }
  }
}

/**
 * Refresh the chip from the latest cached system-compatibility + NER state.
 * This must never trigger model loading or any other heavy probe — callers
 * pass status they already received from background broadcasts/storage
 * events or from the lightweight GET_SYSTEM_COMPATIBILITY_STATUS read.
 */
function refreshPageStatusChip(): void {
  if (!pageStatusChip) return;
  const reason = deriveChipReason({ status: lastSystemStatus, nerStatus: lastNerStatus });
  pageStatusChip.update(reason);
}

async function probeNerStatusIfSafe(): Promise<void> {
  // Probe only when the model is already loaded so we can read its device
  // (WebGPU vs CPU/WASM). When Local AI is off or the model has not been
  // initialized, skip the probe — the chip should not cause an offscreen
  // boot or a model load just to render a status string.
  const safeToProbe = lastSystemStatus?.localAiState !== 'off-user-choice'
    && lastSystemStatus?.localAiState !== 'off-low-memory-auto'
    && lastSystemStatus?.localAiState !== 'off-load-failure'
    && lastSystemStatus?.runtimeState === 'ready';
  if (!safeToProbe) return;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_NER_STATUS' }) as NerStatusResponse;
    lastNerStatus = response?.payload ?? null;
    refreshPageStatusChip();
  } catch {
    // Ignore probe failures — the chip continues to render whatever
    // SystemCompatibilityStatus already justifies.
  }
}

async function refreshSystemStatusFromBackground(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_SYSTEM_COMPATIBILITY_STATUS' }) as SystemCompatibilityStatusResponse;
    lastSystemStatus = response?.payload ?? null;
    refreshPageStatusChip();
    void probeNerStatusIfSafe();
  } catch {
    // Background unavailable; chip will appear on the next storage update.
  }
}

function showIndicator(text: string, durationMs: number): void {
  const existing = document.getElementById('pg-indicator');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.id = 'pg-indicator';
  el.textContent = text;
  // Theme-aware palette: dark uses the deep navy pill, light uses a flat
  // white pill with a subtle border. Falls back to the dark style when
  // settings haven't been loaded yet (very first paste at init time).
  const isLight = settings?.theme === 'light';
  const background = isLight ? '#ffffff' : '#1a1a2e';
  const color = isLight ? '#1f2933' : '#e0e0e0';
  const border = isLight ? '1px solid #e4e6eb' : 'none';
  const shadow = isLight
    ? '0 1px 4px rgba(15, 23, 42, 0.08)'
    : '0 2px 12px rgba(0,0,0,0.3)';
  el.style.cssText = `
    position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
    background: ${background}; color: ${color}; padding: 8px 16px;
    border: ${border};
    border-radius: 8px; font-size: 13px; z-index: 2147483646;
    box-shadow: ${shadow}; font-family: system-ui, sans-serif;
    transition: opacity 0.3s; pointer-events: none;
  `;
  document.body.appendChild(el);

  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, durationMs);
}

// --- Review overlay integration ---

/**
 * Build a preview-only resolver that mirrors what `anonymizeWithVault`
 * would emit, without mutating the live vault. Records already in the
 * vault use their stored replacementMode; new identities follow the
 * current global default. The factory returns a fresh resolver with per-
 * pass dedup state, so each call to `buildPreview` starts clean.
 */
function makePreviewResolverFactory(
  vault: IdentityVaultData,
  defaultMode: ReplacementMode,
): PreviewResolverFactory {
  return () => {
    const seen = new Map<string, string>();
    const pendingByType = new Map<string, number>();
    return (span) => {
      const existing = findRecord(vault, span.text, span.entity_type);
      if (existing) return activeReplacement(existing, defaultMode);
      const key = `${span.entity_type}|${normalizeKey(span.text)}`;
      const cached = seen.get(key);
      if (cached) return cached;
      const baseCounter = vault.counters[span.entity_type] ?? 0;
      const offset = pendingByType.get(span.entity_type) ?? 0;
      pendingByType.set(span.entity_type, offset + 1);
      const idx = baseCounter + offset + 1;
      const ph = makePlaceholder(span.entity_type, idx);
      const synth = supportsSynthetic(span.entity_type)
        ? generateSyntheticValue(span.entity_type, baseCounter + offset)
        : null;
      const rendered = defaultMode === 'synthetic' && synth ? synth : ph;
      seen.set(key, rendered);
      return rendered;
    };
  };
}

function showReviewOverlay(
  originalText: string,
  rawSpans: PiiSpan[],
  timings?: { totalMs: number },
): void {
  const spans = prepareReviewSpans(originalText, rawSpans, settings, adaptiveThresholds);

  if (spans.length === 0) {
    // After filtering, nothing left — paste original
    showIndicator('\u2713 No actionable personal data found', NO_PII_INDICATOR_MS);
    interceptor.pasteOriginal(originalText);
    return;
  }

  const overlay = new ReviewOverlay(
    originalText,
    spans,
    {
      onConfirm: (approvedSpans: PiiSpan[]) => {
        if (approvedSpans.length === 0) {
          interceptor.pasteOriginal(originalText);
          return;
        }

        let anonymizedText: string;

        if (settings.identityVaultEnabled) {
          // Vault path — looks up existing identities, creates new
          // records for first-time PII, writes back to storage so
          // subsequent pastes (in any provider, any session) see the
          // same canonical replacements.
          const result = anonymizeWithVault(
            originalText,
            approvedSpans,
            identityVault,
            settings.defaultReplacementMode,
            entityMap,
          );
          entityMap = result.entityMap;
          anonymizedText = result.text;
          identityVault = result.vaultData;
          // Persist vault asynchronously — paste should not block on it.
          saveIdentityVault(identityVault).catch((err) =>
            console.error('[PG:content] vault save failed', err),
          );
        } else {
          // Legacy path: per-conversation EntityMap only.
          const result = anonymize(originalText, approvedSpans, entityMap);
          entityMap = result.entityMap;
          anonymizedText = result.text;
        }

        interceptor.pasteAnonymized(anonymizedText);

        // Persist conversation-scoped map (still used by the de-anon banner
        // for the current view, regardless of vault state).
        saveEntityMap(conversationUrl, entityMap.toStored());

        showIndicator(
          `\u{1F512} ${approvedSpans.length} item(s) anonymized`,
          CHIP_FADE_MS,
        );

        if (settings.debug && timings) {
          console.log(`[PG:content] Detection: ${timings.totalMs}ms, anonymized ${approvedSpans.length} spans`);
        }
      },

      onPasteOriginal: () => {
        interceptor.pasteOriginal(originalText);
      },

      onCancel: () => {
        void chooseAfterExplicitScanCancel().then((decision) => {
          if (decision === 'paste-original') {
            interceptor.pasteOriginal(originalText);
          }
          if (settings.debug) {
            console.log(`[PG:content] Overlay cancelled, ${decision === 'paste-original' ? 'original pasted' : 'nothing pasted'}`);
          }
        });
      },

      onFeedback: (entry: FeedbackEntry) => {
        logFeedback(entry);
        // Recompute adaptive thresholds in background
        computeAdaptiveThresholds(settings.minConfidence).then((t) => {
          adaptiveThresholds = t;
        });

        if (settings.debug) {
          console.log('[PG:content] Feedback logged:', entry.correctedType, entry.text);
        }
      },

      onAddToAllowlist: (text: string) => {
        const conflict = findConflictingPattern(text, settings.blocklist);
        if (conflict) {
          showIndicator(
            `\u26A0 "${conflict}" is on the blocklist. Remove it there before allowlisting.`,
            3000,
          );
          return;
        }

        const entry: AllowlistEntry = {
          pattern: text,
          scope: 'any',
          addedAt: Date.now(),
          source: 'detection',
        };
        const updated = [...settings.allowlist, entry];
        settings = { ...settings, allowlist: updated };
        saveSettings({ allowlist: updated });
      },

      onEditDetails: (text: string) => {
        const url = chrome.runtime.getURL(`options/options.html?allowlist=${encodeURIComponent(text)}`);
        chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS_PAGE', payload: { url } });
      },
    },
    (span: PiiSpan) => resolveThreshold(settings, span.entity_type),
    timings,
    settings.theme,
    settings.identityVaultEnabled
      ? makePreviewResolverFactory(identityVault, settings.defaultReplacementMode)
      : undefined,
  );

  overlay.show();
}

// --- Paste interceptor ---

async function chooseAfterExplicitScanCancel(): Promise<'paste-original' | 'drop'> {
  const behavior: CancelDetectionBehavior = settings?.cancelDetectionBehavior ?? 'ask';

  if (behavior === 'paste-original') {
    showIndicator('⚠ Pasted without checking', NO_PII_INDICATOR_MS);
    return 'paste-original';
  }

  if (behavior === 'drop') {
    showIndicator('Detection canceled — nothing pasted', NO_PII_INDICATOR_MS);
    return 'drop';
  }

  const result = await new CancelDecisionDialog(settings?.theme ?? 'dark').show();
  if (result.remember && !result.dismissed) {
    const nextBehavior: CancelDetectionBehavior = result.decision === 'paste-original'
      ? 'paste-original'
      : 'drop';
    await saveSettings({ cancelDetectionBehavior: nextBehavior });
    settings = { ...settings, cancelDetectionBehavior: nextBehavior };
  }

  if (result.decision === 'paste-original') {
    showIndicator('⚠ Pasted without checking', NO_PII_INDICATOR_MS);
  } else {
    showIndicator('Detection canceled — nothing pasted', NO_PII_INDICATOR_MS);
  }

  return result.decision;
}

const interceptor = new PasteInterceptor(adapter, {
  onAnalyzing: () => {
    scanningIndicator?.stop();
    scanningIndicator = new ScanningIndicator(settings.theme, () => {
      interceptor.cancelActiveDetection();
    });
    scanningIndicator.start();
  },

  onNoPii: (text) => {
    scanningIndicator?.stop();
    scanningIndicator = null;
    showIndicator('\u2713 No personal data found', NO_PII_INDICATOR_MS);
    interceptor.pasteOriginal(text);
  },

  onPiiDetected: (text, spans, timings) => {
    scanningIndicator?.stop();
    scanningIndicator = null;
    showReviewOverlay(text, spans, timings);
  },

  onError: (error) => {
    scanningIndicator?.stop();
    scanningIndicator = null;
    showIndicator(`\u26A0 Privacy Guardrail error: ${error}`, 3000);
  },

  onCanceled: (explicitUserCancel) => {
    scanningIndicator?.stop();
    scanningIndicator = null;
    if (!explicitUserCancel) {
      showIndicator('Detection canceled', NO_PII_INDICATOR_MS);
    }
  },

  onExplicitCancelDecision: async () => chooseAfterExplicitScanCancel(),
});

// --- Response observer with de-anonymization banners ---

const responseObserver = new ResponseObserver(adapter, {
  onResponseWithPlaceholders: async (element, _text) => {
    // The conversation entity map covers placeholder-mode replacements
    // (the legacy and most-common case). When synthetic mode is active
    // for a record, that entry is also present in the conversation map
    // because anonymizeWithVault calls addExternal — so a single map
    // suffices for all the LLM might emit verbatim from the prompt.
    const stored = await loadEntityMap(conversationUrl);
    const map = augmentEntityMap(
      stored,
      identityVault,
      settings.identityVaultEnabled,
    );

    if (map.size === 0) return;

    attachDeAnonBanner(element, map, settings.theme);

    if (settings.debug) {
      console.log('[PG:content] De-anonymization banner attached to response');
    }
  },
  hasKnownSynthetic: (text) => {
    if (!settings.identityVaultEnabled) return false;
    for (const record of identityVault.records) {
      if (record.syntheticValue && text.includes(record.syntheticValue)) {
        return true;
      }
    }
    return false;
  },
});

// --- Clipboard interceptor (toast-based de-anonymization) ---

const clipboardInterceptor = new ClipboardInterceptor({
  resolve: async (text: string) => {
    const stored = await loadEntityMap(conversationUrl);
    const map = augmentEntityMap(
      stored,
      identityVault,
      settings.identityVaultEnabled,
    );
    if (map.size === 0) return { matches: [], deAnonText: text };
    return resolveText(text, map);
  },
});

// --- Settings listener ---

chrome.runtime.onMessage.addListener((message, _sender, _sendResponse): undefined => {
  if (message.type === 'SETTINGS_UPDATED') {
    settings = message.payload;
    interceptor.setEnabled(settings.enabled);
    clipboardInterceptor.setTheme(settings.theme);
    clipboardInterceptor.setEnabled(
      settings.enabled && settings.clipboardInterceptEnabled,
    );
    if (!settings.enabled || settings.nerProvider === 'off') {
      reportSupportedPageActivity(false, true);
    } else {
      reportVisibility();
    }

    if (settings.debug) {
      console.log('[PG:content] Settings updated:', settings);
    }
  }
  return undefined;
});

// --- Initialize ---

async function init(): Promise<void> {
  // Load settings and adaptive thresholds
  settings = await loadSettings();

  if (!settings.enabled) {
    if (settings.debug) {
      console.log('[PG:content] Extension disabled, not activating');
    }
    return;
  }

  await maybeShowCriticalLocalAiModal();

  pageStatusChip = new PageStatusChip(settings.theme);
  await refreshSystemStatusFromBackground();

  adaptiveThresholds = await computeAdaptiveThresholds(settings.minConfidence);

  // Restore entity map for this conversation
  const stored = await loadEntityMap(conversationUrl);
  entityMap = new EntityMap(stored);

  // Restore identity vault (cross-session, cross-provider)
  if (settings.identityVaultEnabled) {
    identityVault = await loadIdentityVault();
  }

  // React to vault edits made elsewhere (options page, other tabs).
  // Without this, a user editing the synthetic value of "John Doe" in the
  // options page would still see the old value applied to subsequent
  // pastes in this tab until reload.
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes['pg_identity_vault']) {
        const next = changes['pg_identity_vault'].newValue;
        if (next && Array.isArray(next.records)) {
          identityVault = next;
          if (settings.debug) {
            console.log('[PG:content] Vault reloaded from storage event');
          }
        }
      }
      if (changes['pg_settings']) {
        const next = changes['pg_settings'].newValue as Settings | undefined;
        if (next) {
          settings = next;
          interceptor.setEnabled(settings.enabled);
          clipboardInterceptor.setTheme(settings.theme);
          clipboardInterceptor.setEnabled(
            settings.enabled && settings.clipboardInterceptEnabled,
          );
          pageStatusChip?.setTheme(settings.theme);
          if (!settings.enabled || settings.nerProvider === 'off') {
            reportSupportedPageActivity(false, true);
          } else {
            reportVisibility();
          }
          if (settings.debug) {
            console.log('[PG:content] Settings reloaded from storage event');
          }
        }
      }
      if (changes[SYSTEM_CHECK_STORAGE_KEY]) {
        // System-check storage updates carry the freshest tier, localAiState,
        // and modal pending/dismissed flags. Re-derive the chip without
        // sending another message to the background.
        const next = changes[SYSTEM_CHECK_STORAGE_KEY].newValue as SystemCompatibilityStatus | undefined;
        lastSystemStatus = next ?? null;
        refreshPageStatusChip();
      }
    });
  }

  // Start interception and observation
  interceptor.start();
  startSupportedPageActivityHeartbeat();
  responseObserver.start();
  clipboardInterceptor.setTheme(settings.theme);
  clipboardInterceptor.setEnabled(settings.clipboardInterceptEnabled);
  clipboardInterceptor.start();

  if (settings.debug) {
    console.log(`[PG:content] Privacy Guardrail active on ${adapter.name} (${window.location.hostname})`);
    console.log(`[PG:content] Adaptive thresholds:`, adaptiveThresholds);
    console.log(`[PG:content] Entity map size: ${entityMap.size}`);
    console.log(`[PG:content] Vault size: ${identityVault.records.length}`);
  }
}

init();
