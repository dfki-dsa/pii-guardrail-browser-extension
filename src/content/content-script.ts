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
import { PasteInterceptor, type ComposerMatch } from './paste-interceptor';
import { sendRuntimeMessageBestEffort } from './runtime-messaging';
import { shouldShowCriticalLocalAiModal } from './critical-local-ai-modal-status';
import { ResponseObserver } from './response-observer';
import { ConversationFiler } from './conversation-filing';
import { findLooseTokenAnchors } from './banner-anchor';
import {
  observedTokens,
  readTranscriptText,
  visibleTokens,
} from './transcript-scan';
import { isInEditableRegion } from '../ui/shared/editable-region';
import { ClipboardInterceptor } from './clipboard-interceptor';
import { ReviewOverlay } from '../ui/overlay/overlay';
import { ScanningIndicator } from '../ui/scanning-indicator/scanning-indicator';
import { CancelDecisionDialog } from '../ui/cancel-decision-dialog/cancel-decision-dialog';
import { CriticalLocalAiModal } from '../ui/critical-local-ai-modal/critical-local-ai-modal';
import { PageStatusChip } from '../ui/page-status-chip/page-status-chip';
import { chipReasonMessageForStatus, deriveChipReason } from '../shared/page-status-chip-reason';
import { SYSTEM_CHECK_STORAGE_KEY } from '../shared/system-check-storage';
import { attachDeAnonBanner, type AttachedBanner } from '../ui/banner/de-anon-banner';
import { anonymize, anonymizeWithVault } from '../shared/anonymizer';
import { EntityMap } from '../shared/entity-map';
import {
  buildConversationScope,
  emptyScope,
  type ConversationScope,
} from '../shared/conversation-scope';
import {
  loadSettings,
  saveSettings,
  loadConversationRecord,
  saveConversationTokens,
  saveSessionConversationPairs,
  moveConversationTokens,
  conversationRecordExists,
  ownedEntries,
  logFeedback,
  type ConversationRecord,
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
import { CONVERSATION_URL_POLL_MS, LOCAL_AI_ACTIVITY_HEARTBEAT_MS, NO_PII_INDICATOR_MS, RESPONSE_DEBOUNCE_MS, CHIP_FADE_MS } from '../shared/constants';
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
/**
 * Storage key for the conversation on screen.
 *
 * Not a constant: chat sites create the conversation on the first send and
 * rewrite the URL in place, and users switch conversations without a page
 * load. `watchConversationUrl` keeps it current. Nothing reads meaning into
 * how a URL is shaped — what a change meant is never asked.
 */
let conversationUrl = normalizeConversationUrl(window.location.href);

/**
 * The tab ledger: replacement tokens this page session emitted into a
 * composer.
 *
 * The in-memory map can hold entries restored from storage, and on the "new
 * chat" screen that key is shared with every other tab composing its own
 * first message. Only what this session used is ever filed or persisted —
 * see `ownedEntries`.
 */
const sessionPlaceholders = new Set<string>();

/** What storage knows about the conversation on screen. */
let conversationRecord: ConversationRecord = { tokens: [], originals: {} };

/** Unaltered, vault-known tokens last seen on the page. */
let observedOnPage: string[] = [];

/**
 * What may be resolved on this page, rebuilt whenever any of its three
 * sources moves. Never captured by the surfaces that use it: they hold the
 * resolver and ask again, so a banner attached early is not wrong for the
 * life of the page.
 */
let scope: ConversationScope = emptyScope();

/** Banners currently on the page, so their counts can follow the scope. */
const attachedBanners: AttachedBanner[] = [];

/** Tokens already reported as present but unresolvable; reported once each. */
const unresolvableReported = new Set<string>();

function normalizeConversationUrl(href: string): string {
  return href.split('?')[0].split('#')[0];
}
let scanningIndicator: ScanningIndicator | null = null;
let pageStatusChip: PageStatusChip | null = null;
let lastSystemStatus: SystemCompatibilityStatus | null = null;
let lastNerStatus: NerStatus | null = null;
/**
 * How this page's message box was last found, or null before any paste has
 * asked. Set from the paste interceptor, which is the only place that finds
 * out — and only at the moment it matters. See `reportComposerLookup`.
 */
let composerMatch: ComposerMatch | null = null;
let activityListenersStarted = false;
let lastActivityHeartbeatAt = 0;
let releasePasteInterceptor: (() => void) | null = null;
const pasteInterceptorReady = new Promise<void>((resolve) => {
  releasePasteInterceptor = resolve;
});
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
  sendRuntimeMessageBestEffort({
    type: 'SUPPORTED_PAGE_ACTIVITY',
    payload: { visible },
  });
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
  const reason = deriveChipReason({
    status: lastSystemStatus,
    nerStatus: lastNerStatus,
    composerMissing: composerMatch === 'none',
  });
  pageStatusChip.update(reason, reason ? chipReasonMessageForStatus(reason, lastSystemStatus) : undefined);
}

/**
 * Record how this page's message box was found.
 *
 * A site can change its DOM at any time, and the worst failure mode available
 * to a privacy tool is the silent one: initialization succeeds, the chip
 * stays green, and every paste goes through unreviewed with nothing said.
 * Three outcomes are distinguished because they mean three different things
 * to the user — protected, protected on a guess, and not protected — and the
 * strongest warning keeps its meaning only if the middle case has its own.
 */
function reportComposerLookup(match: ComposerMatch): void {
  if (match === 'none') {
    // Unconditional, NOT behind `settings.debug`: reaching here means text
    // reached the page without review, or reviewed text never landed. The
    // page's own UI shows nothing either way.
    console.warn(
      '[PG:content] No message box found on this page — neither the one this '
        + 'site adapter knows nor the target of the paste. Text here is not '
        + 'reviewed, and reviewed text has nowhere to be inserted.',
    );

    // The chip owns this surface: it appears on this same paste and says the
    // same thing, and a centred indicator on top of it only covers the text
    // it duplicates. Fall back to the indicator when there is no chip to
    // speak through — a paste that beats `init()` to the chip, or an `init()`
    // that failed before building one.
    if (!pageStatusChip) {
      showIndicator(
        '⚠ Privacy Guardrail could not find this page’s message box',
        INIT_FAILURE_INDICATOR_MS,
      );
    }
  }

  if (composerMatch === match) return;
  composerMatch = match;
  refreshPageStatusChip();
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

/**
 * Longer than the routine indicators: this one reports that protection is
 * off, so it must survive a glance away from the screen.
 */
const INIT_FAILURE_INDICATOR_MS = 8000;

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

/**
 * Keep `conversationUrl` in step with same-document navigation.
 *
 * Content scripts run in an isolated world, so patching `history.pushState`
 * here would never observe the page's own calls. Polling the URL is the
 * dependable option; `popstate` is added so back/forward registers at once.
 */
function watchConversationUrl(): void {
  const check = (): void => {
    const next = normalizeConversationUrl(window.location.href);
    if (next === conversationUrl) return;
    conversationUrl = next;
    void adoptConversation(next);
  };

  window.addEventListener('popstate', check);
  window.setInterval(check, CONVERSATION_URL_POLL_MS);
}

/**
 * Pick up whatever is known about the conversation now on screen.
 *
 * Nothing here decides what the URL change meant. The one question asked is
 * whether a record already exists under the incoming URL, and it is asked for
 * a single purpose: a key that has been on screen as its own conversation
 * before is positive proof that this is a switch, and that is the only thing
 * that clears the tab ledger. Every other URL change leaves the ledger
 * standing, so a conversation the site has just named keeps the tokens
 * composed into it.
 */
async function adoptConversation(next: string): Promise<void> {
  if (await conversationRecordExists(next)) {
    sessionPlaceholders.clear();
    filer.reset();
    if (settings?.debug) {
      console.log(`[PG:content] ${next} is a conversation on record; tab ledger cleared`);
    }
  }
  await loadConversationScope();
  scanPage();
}

/**
 * Read the record for the conversation on screen and rebuild the scope.
 *
 * A read that finishes after the page has moved on is discarded. It could
 * only misdirect what resolves — records hold tokens, not originals — but
 * nothing would come along to correct it.
 */
async function loadConversationScope(): Promise<void> {
  const url = conversationUrl;
  const loaded = await loadConversationRecord(url);
  if (url !== conversationUrl) return;

  conversationRecord = loaded;
  if (!settings?.identityVaultEnabled) {
    // With cross-session memory off the record is the only copy of these
    // originals, and it also carries the numbering the anonymizer continues
    // from. With it on, the vault owns both.
    entityMap = new EntityMap({
      ...loaded.originals,
      ...ownedEntries(entityMap.toStored(), sessionPlaceholders),
    });
  }
  rebuildScope();
}

/** This page session's ledger as `token -> original` pairs. */
function ledgerEntries(): Record<string, string> {
  return ownedEntries(entityMap.toStored(), sessionPlaceholders);
}

/**
 * Recompose what may be resolved, and let every surface that shows it catch
 * up. Cheap and pure, so it runs on every change rather than being kept in
 * step by hand.
 */
function rebuildScope(): void {
  scope = buildConversationScope({
    recordTokens: conversationRecord.tokens,
    recordOriginals: conversationRecord.originals,
    ledger: ledgerEntries(),
    observed: observedOnPage,
    vault: identityVault,
    vaultEnabled: settings?.identityVaultEnabled ?? false,
  });
  refreshBanners();
}

/**
 * Files this tab's tokens under whichever conversation they turn up in.
 *
 * The transcript is re-read here rather than reused from the last scan: the
 * filer runs after a paste and after a URL change as well as from the scan,
 * and a move is worth being sure about.
 */
const filer = new ConversationFiler({
  ledger: () => sessionPlaceholders,
  observe: (tokens) =>
    visibleTokens(tokens, readTranscriptText(document.body, adapter.getInputElement())),
  currentUrl: () => conversationUrl,
  move: (from, to, tokens) => moveConversationTokens(from, to, tokens),
  onMoved: (from, to, tokens) => {
    if (settings?.debug) {
      console.log(
        `[PG:content] ${tokens.length} token(s) seen at ${to}; moved there from ${from}`,
      );
    }
  },
});

/**
 * Read the page and act on what is there: admit unaltered tokens the vault
 * knows, file this tab's tokens under the conversation they are rendered in,
 * and offer a banner wherever something resolves.
 *
 * Runs on debounced transcript mutation, on URL change and after a paste.
 * Every part of it is idempotent, so no single run has to be the right one.
 */
function scanPage(): void {
  if (!document.body) return;
  // A profile that has never replaced anything has nothing to observe, file
  // or reveal, and this runs on every page mutation. Leave before the walk.
  if (
    sessionPlaceholders.size === 0
    && identityVault.records.length === 0
    && scope.size === 0
  ) {
    return;
  }

  const composer = adapter.getInputElement();
  const transcript = readTranscriptText(document.body, composer);

  const seen = observedTokens(transcript);
  const admitted = seen.filter((token) => vaultKnows(token));
  if (!sameTokens(admitted, observedOnPage)) {
    observedOnPage = admitted;
    rebuildScope();
  }
  reportUnresolvableTokens(seen);

  void filer.run();

  attachLooseBanners(composer, transcript);
}

/** Whether the identity vault can supply an original for `token`. */
function vaultKnows(token: string): boolean {
  if (!settings?.identityVaultEnabled) return false;
  return identityVault.records.some(
    (record) => record.placeholder === token || record.syntheticValue === token,
  );
}

function sameTokens(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const known = new Set(b);
  return a.every((token) => known.has(token));
}

/**
 * Note a token the user can see that this extension will not resolve.
 *
 * Deliberately a `console.debug` and nothing else. It is the one signal that
 * a conversation has drifted out of scope, and it belongs to whoever is
 * debugging that — telling the user about a token nothing can be done with
 * would be noise where the extension is already doing its best.
 */
function reportUnresolvableTokens(seen: readonly string[]): void {
  for (const token of seen) {
    if (scope.has(token) || unresolvableReported.has(token)) continue;
    unresolvableReported.add(token);
    console.debug(
      `[PG:content] ${token} is on this page but no original is known for it.`,
    );
  }
}

/**
 * Offer a banner on any region holding a resolvable token that the adapter's
 * reply selectors do not cover.
 *
 * This is what a rotted selector costs: precision. The banner lands on a
 * block the token sits in rather than on the reply the site knows it to be
 * part of, and it reads inert text only — but it appears, which is the whole
 * difference between a redesign costing polish and costing the feature.
 */
function attachLooseBanners(composer: HTMLElement | null, transcript: string): void {
  // One check over the text already in hand, rather than a walk that asks the
  // same question of every node on the page and finds nothing.
  if (scope.size === 0 || !scope.mightResolve(transcript)) return;

  const turns = adapter.getResponseElements();
  const anchors = findLooseTokenAnchors(
    document.body,
    turns,
    composer,
    (text) => scope.mightResolve(text) && scope.resolve(text).matches.length > 0,
  );
  for (const anchor of anchors) {
    attachBanner(anchor, false);
  }
}

/**
 * Attach a banner, remembering it so its count can follow the scope.
 *
 * The composer is refused here as well as inside the banner. The banner knows
 * what an editable element looks like; only the adapter knows which element
 * this site's message box is, and a turn selector that has rotted onto it
 * must not end up with a reveal control over text the user is about to send.
 */
function attachBanner(element: HTMLElement, readFormControls: boolean): boolean {
  if (isInEditableRegion(element, adapter.getInputElement())) return false;

  const banner = attachDeAnonBanner(element, (text) => scope.resolve(text), {
    theme: settings?.theme,
    readFormControls,
  });
  if (!banner) return false;
  attachedBanners.push(banner);
  return true;
}

/**
 * Bring every banner up to date with the current scope, and offer one to
 * replies that had nothing resolvable when they arrived.
 *
 * The second half matters as much as the first: a reply that streamed in
 * before its conversation's record finished loading was passed over, and
 * without this it would stay passed over until the next mutation.
 */
function refreshBanners(): void {
  for (let i = attachedBanners.length - 1; i >= 0; i--) {
    const banner = attachedBanners[i];
    if (!banner.element.isConnected) {
      attachedBanners.splice(i, 1);
      continue;
    }
    banner.refresh();
  }

  if (scope.size === 0) return;
  for (const element of adapter.getResponseElements()) {
    attachBanner(element, true);
  }
}

/**
 * Write this session's tokens under the conversation they were emitted in,
 * then let filing move them if the site renames it.
 *
 * With cross-session memory on, only the tokens are written: the identity
 * vault holds the originals, and a record filed against the wrong
 * conversation then costs precision rather than disclosure. With it off the
 * vault is holding nothing, so the pairs go to session storage — enough to
 * survive a reload and a conversation switch, and gone when the browser
 * closes, which is what the setting's name promises.
 */
async function recordEmittedTokens(): Promise<void> {
  const url = conversationUrl;
  const entries = ledgerEntries();
  const tokens = Object.keys(entries);
  if (tokens.length === 0) return;

  if (settings?.identityVaultEnabled) {
    await saveConversationTokens(url, tokens);
  } else {
    await saveSessionConversationPairs(url, entries);
  }
  filer.noteFiled(url, tokens);

  // The send that follows a paste is what renames the conversation, so this
  // is the moment filing most often has work to do.
  await filer.run();
}

/**
 * Follow a change to the cross-session memory setting.
 *
 * Turning it on brings originals back into reach for every token already
 * filed; turning it off takes them out of reach again. Either way what may be
 * resolved on this page changes, and the surfaces showing it have to be told.
 */
async function reloadVaultAndScope(): Promise<void> {
  identityVault = settings?.identityVaultEnabled
    ? await loadIdentityVault()
    : emptyVaultData();
  await loadConversationScope();
  scanPage();
}

/**
 * Watch the whole page rather than the adapter's reply elements.
 *
 * Filing and observation must keep working when the reply selectors rot, so
 * neither may be driven by them. `document.body` is coarse; the debounce and
 * the early exits in `scanPage` are what make it affordable.
 */
function watchTranscript(): void {
  let timer: number | null = null;
  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      scanPage();
    }, RESPONSE_DEBOUNCE_MS);
  };

  new MutationObserver(schedule).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  schedule();
}

function waitForDocumentBody(): Promise<void> {
  if (document.body) return Promise.resolve();
  return new Promise((resolve) => {
    document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
  });
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

        // Record what this session put into the page. The map may also hold
        // entries restored from storage — on the shared "new chat" key those
        // can belong to another tab's draft — and those are not ours to
        // persist or file.
        for (const [replacement] of entityMap.entries()) {
          if (anonymizedText.includes(replacement)) {
            sessionPlaceholders.add(replacement);
          }
        }

        // The ledger just grew, so what may be resolved on this page grew
        // with it — before anything has been written anywhere.
        rebuildScope();
        void recordEmittedTokens();

        showIndicator(
          `\u{1F512} ${approvedSpans.length} item(s) replaced`,
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
        sendRuntimeMessageBestEffort({ type: 'OPEN_OPTIONS_PAGE', payload: { url } });
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

  onComposerLookup: reportComposerLookup,
}, {
  waitForReady: () => pasteInterceptorReady,
});

// Register synchronously at document_start so page scripts cannot win the
// capture-phase race while this content script restores local state.
interceptor.start();

// --- Response observer with de-anonymization banners ---

const responseObserver = new ResponseObserver(adapter, {
  onResponseWithPlaceholders: (element) => {
    // Resolved against the scope in memory rather than a fresh storage read:
    // the banner holds the resolver and asks again, so there is nothing to
    // wait for here and nothing to go stale.
    if (attachBanner(element, true) && settings.debug) {
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
  resolve: async (text: string) => scope.resolve(text),
});

// --- Settings listener ---

chrome.runtime.onMessage.addListener((message, _sender, sendResponse): undefined => {
  if (message.type === 'GET_PAGE_PROTECTION_STATE') {
    // Answered synchronously: the popup asks the active tab when it opens,
    // and a page that has not been pasted into yet answers `null` rather than
    // claiming anything about a lookup that never happened.
    sendResponse({
      type: 'PAGE_PROTECTION_STATE',
      payload: { composerMatch },
    });
    return undefined;
  }

  if (message.type === 'SETTINGS_UPDATED') {
    const vaultToggled = settings?.identityVaultEnabled !== message.payload.identityVaultEnabled;
    settings = message.payload;
    interceptor.setEnabled(settings.enabled);
    if (vaultToggled) void reloadVaultAndScope();
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
  interceptor.setEnabled(settings.enabled);

  if (!settings.enabled) {
    releasePasteInterceptor?.();
    releasePasteInterceptor = null;
    if (settings.debug) {
      console.log('[PG:content] Extension disabled, not activating');
    }
    return;
  }

  await waitForDocumentBody();
  await maybeShowCriticalLocalAiModal();

  pageStatusChip = new PageStatusChip(settings.theme);
  await refreshSystemStatusFromBackground();

  adaptiveThresholds = await computeAdaptiveThresholds(settings.minConfidence);

  // Restore identity vault (cross-session, cross-provider) before the
  // conversation record: the record's tokens resolve through it.
  if (settings.identityVaultEnabled) {
    identityVault = await loadIdentityVault();
  }

  await loadConversationScope();

  releasePasteInterceptor?.();
  releasePasteInterceptor = null;

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
          rebuildScope();
          if (settings.debug) {
            console.log('[PG:content] Vault reloaded from storage event');
          }
        }
      }
      if (changes['pg_settings']) {
        const next = changes['pg_settings'].newValue as Settings | undefined;
        if (next) {
          const vaultToggled = settings?.identityVaultEnabled !== next.identityVaultEnabled;
          settings = next;
          interceptor.setEnabled(settings.enabled);
          if (vaultToggled) void reloadVaultAndScope();
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

  // Start observation and clipboard restoration after the DOM is available.
  startSupportedPageActivityHeartbeat();
  watchConversationUrl();
  watchTranscript();
  responseObserver.start();
  clipboardInterceptor.setTheme(settings.theme);
  clipboardInterceptor.setEnabled(settings.clipboardInterceptEnabled);
  clipboardInterceptor.start();

  if (settings.debug) {
    console.log(`[PG:content] Privacy Guardrail active on ${adapter.name} (${window.location.hostname})`);
    console.log(`[PG:content] Adaptive thresholds:`, adaptiveThresholds);
    console.log(`[PG:content] Conversation scope size: ${scope.size}`);
    console.log(`[PG:content] Vault size: ${identityVault.records.length}`);
  }
}

void init().catch((error) => {
  // Do not leave an initial paste held if local state restoration fails.
  // Disabling the interceptor restores the user's original paste through the
  // guarded handoff rather than silently dropping it.
  interceptor.setEnabled(false);
  releasePasteInterceptor?.();
  releasePasteInterceptor = null;

  // Report unconditionally — NOT behind `settings.debug`. Reaching here means
  // paste review is off for the rest of this page's lifetime: there is no
  // retry, and neither recovery listener can help (`chrome.storage.onChanged`
  // is registered further down `init` and so was never reached, and a
  // `SETTINGS_UPDATED` message cannot arrive if the runtime context is what
  // failed). A privacy tool that has stopped reviewing pastes must say so
  // rather than let the user keep pasting while believing they are covered.
  console.error(
    '[PG:content] Initialization failed — paste review is OFF for this page. '
      + 'Reload the page to retry.',
    error,
  );

  void waitForDocumentBody().then(() => {
    showIndicator(
      '\u26A0 Privacy Guardrail is off for this page \u2014 reload to retry',
      INIT_FAILURE_INDICATOR_MS,
    );
  });
});
