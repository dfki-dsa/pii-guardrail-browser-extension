import type {
  CancelDetectionRequest,
  DetectPiiRequest,
  DetectionCanceledResponse,
  GetNerStatusRequest,
  Message,
  NerStatusResponse,
  OpenOptionsPageRequest,
  PiiResultResponse,
  SystemCompatibilityStatusResponse,
  SystemSignalsResponse,
} from "../shared/message-types";
import { loadSettings, saveSettings, logFeedback } from "../shared/storage";
import { detectionOptionsFromSettings, fallbackNerStatus } from "../shared/detection-config";
import { LOCAL_AI_ACTIVITY_WINDOW_MS } from "../shared/constants";
import { shouldAutoWarmLocalAi } from "../shared/local-ai-warmup-gate";
import {
  buildSystemCheckResult,
  loadSystemCheckResult,
  markCriticalModalDismissed,
  recordLoadFailure,
  recordLocalAiEnabled,
  recordLowMemoryAutoDisable,
  recordLowMemoryOverride,
  recordRecommendationDeclined,
  recordRuntimeState,
  recordUserLocalAiOff,
  saveSystemCheckResult,
  type SystemCheckResult,
} from "../shared/system-check-storage";

const OFFSCREEN_URL = "offscreen/offscreen.html";
const SYSTEM_CHECK_OFFSCREEN_URL = "system-check/system-check-offscreen.html";
const SETTINGS_KEY = "pg_settings";
const ACTIVE_ICON_PATHS = {
  16: "/assets/icons/active-16.png",
  32: "/assets/icons/active-32.png",
  48: "/assets/icons/active-48.png",
  128: "/assets/icons/active-128.png",
};
const INACTIVE_ICON_PATHS = {
  16: "/assets/icons/inactive-16.png",
  32: "/assets/icons/inactive-32.png",
  48: "/assets/icons/inactive-48.png",
  128: "/assets/icons/inactive-128.png",
};
let offscreenCreating: Promise<void> | null = null;
/**
 * Cached handshake confirming the current offscreen document's onMessage
 * listener is attached. Cleared when the offscreen is closed so the next
 * ensureOffscreen re-handshakes the freshly created document.
 */
let offscreenReady: Promise<void> | null = null;
const canceledDetectionIds = new Set<string>();
let offscreenBusyCount = 0;
let offscreenIdleTimer: ReturnType<typeof setTimeout> | null = null;
let lastOffscreenActivityAt = 0;
let lastSupportedPageActivityAt = 0;
let lastSupportedPageActivityTabId: number | null = null;
let activityWarmupInFlight: Promise<void> | null = null;

function invalidateOffscreenReady(): void {
  offscreenReady = null;
}

function clearOffscreenIdleTimer(): void {
  if (!offscreenIdleTimer) return;
  clearTimeout(offscreenIdleTimer);
  offscreenIdleTimer = null;
}

function canceledResponse(requestId: string): DetectionCanceledResponse {
  return {
    type: "DETECTION_CANCELED",
    payload: { requestId },
  };
}

function rememberCanceledDetection(requestId: string): void {
  canceledDetectionIds.add(requestId);
  setTimeout(() => canceledDetectionIds.delete(requestId), 300000);
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error("Timed out waiting for offscreen cancellation")), ms);
  });
}

async function closeOffscreenBestEffort(): Promise<void> {
  clearOffscreenIdleTimer();
  try {
    const existing = await (chrome.offscreen as any).hasDocument();
    if (existing) {
      await (chrome.offscreen as any).closeDocument();
    }
  } catch {
    // Best effort: Chrome may already have torn down the document.
  } finally {
    invalidateOffscreenReady();
  }
}

function isSupportedPageUrl(url: string | undefined, settings: Awaited<ReturnType<typeof loadSettings>>): boolean {
  return Boolean(url && settings.curatedUrls.some((curatedUrl) => url.startsWith(curatedUrl)));
}

async function hasRecentForegroundSupportedPageActivity(settings: Awaited<ReturnType<typeof loadSettings>>): Promise<boolean> {
  if (!settings.keepLocalAiLoadedWhileActive) return false;
  if (!lastSupportedPageActivityTabId) return false;
  if (Date.now() - lastSupportedPageActivityAt > LOCAL_AI_ACTIVITY_WINDOW_MS) return false;

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return Boolean(
    activeTab?.id === lastSupportedPageActivityTabId
    && isSupportedPageUrl(activeTab.url, settings),
  );
}

async function scheduleOffscreenIdleUnload(): Promise<void> {
  clearOffscreenIdleTimer();
  if (offscreenBusyCount > 0) return;

  const settings = await loadSettings();
  if (settings.localAiUnloadTimeoutMs === null) return;

  const existing = await (chrome.offscreen as any).hasDocument();
  if (!existing) return;

  const activePageKeepsRuntime = await hasRecentForegroundSupportedPageActivity(settings);
  const lastRelevantActivityAt = Math.max(
    lastOffscreenActivityAt,
    activePageKeepsRuntime ? lastSupportedPageActivityAt : 0,
  );
  const elapsedMs = Date.now() - lastRelevantActivityAt;
  const remainingMs = Math.max(0, settings.localAiUnloadTimeoutMs - elapsedMs);

  if (remainingMs === 0) {
    await closeOffscreenBestEffort();
    return;
  }

  offscreenIdleTimer = setTimeout(() => {
    void scheduleOffscreenIdleUnload();
  }, remainingMs);
}

async function withOffscreenOperation<T>(operation: () => Promise<T>): Promise<T> {
  clearOffscreenIdleTimer();
  offscreenBusyCount += 1;
  try {
    await ensureOffscreen();
    return await operation();
  } finally {
    offscreenBusyCount = Math.max(0, offscreenBusyCount - 1);
    lastOffscreenActivityAt = Date.now();
    void scheduleOffscreenIdleUnload();
  }
}

async function persistWarmupOutcome(status: NerStatusResponse["payload"]): Promise<void> {
  if (status.state === "failed" || status.state === "unavailable") {
    const reason = status.message ?? "Local AI failed to load.";
    const settings = await loadSettings();
    if (settings.nerProvider === "transformers") {
      await saveSettings({ nerProvider: "off" });
    }
    await recordLoadFailure(reason);
    return;
  }
  await recordRuntimeState(status.state);
}

async function applyCriticalLocalAiRecommendation(result: SystemCheckResult): Promise<SystemCheckResult> {
  if (result.recommendation !== "auto-disable-local-ai" || result.lowMemoryOverride) {
    return result;
  }

  const settings = await loadSettings();
  if (settings.nerProvider === "transformers") {
    await saveSettings({ nerProvider: "off" });
    await closeOffscreenBestEffort();
    return recordLowMemoryAutoDisable(result);
  }

  if (settings.nerProvider === "off" && result.localAiState === "enabled") {
    return recordUserLocalAiOff(result);
  }

  return result;
}

async function collectPassiveSignals(): Promise<SystemSignalsResponse["payload"]> {
  await closeOffscreenBestEffort();
  try {
    await (chrome.offscreen as any).createDocument({
      url: SYSTEM_CHECK_OFFSCREEN_URL,
      reasons: ["WORKERS"],
      justification: "Passive browser memory and WebGPU compatibility check",
    });
    const signalsResponse: SystemSignalsResponse = await chrome.runtime.sendMessage({ type: "COLLECT_SYSTEM_SIGNALS" });
    return signalsResponse.payload;
  } finally {
    await closeOffscreenBestEffort();
  }
}

async function runPassiveSystemCheck(): Promise<SystemCompatibilityStatusResponse> {
  const previous = await loadSystemCheckResult();
  if (previous) return { type: "SYSTEM_COMPATIBILITY_STATUS", payload: previous };

  const signals = await collectPassiveSignals();
  const result = await applyCriticalLocalAiRecommendation(buildSystemCheckResult(signals));
  await saveSystemCheckResult(result);
  return { type: "SYSTEM_COMPATIBILITY_STATUS", payload: result };
}

async function ensureSystemCheckResult(): Promise<SystemCompatibilityStatusResponse> {
  const existing = await loadSystemCheckResult();
  if (existing) return { type: "SYSTEM_COMPATIBILITY_STATUS", payload: existing };
  return runPassiveSystemCheck();
}

async function cancelOffscreenBestEffort(requestId: string): Promise<void> {
  try {
    await ensureOffscreen();
    const request: CancelDetectionRequest = {
      type: "CANCEL_DETECTION",
      payload: { requestId },
    };
    await Promise.race([
      chrome.runtime.sendMessage(request),
      timeout(500),
    ]);
  } catch {
    // If the offscreen document is busy in a long model/WASM call, it may not
    // process CANCEL_DETECTION promptly. Tear it down so extension UI (popup,
    // options) remains responsive; the next detection recreates it.
    await closeOffscreenBestEffort();
  }
}

async function persistResolvedNerModel(config: DetectPiiRequest["payload"]["config"]): Promise<void> {
  if (config?.ner_provider !== "transformers" || !config.ner_model) return;

  try {
    const request: GetNerStatusRequest = {
      type: "GET_NER_STATUS",
      payload: { config },
    };
    const response: NerStatusResponse = await chrome.runtime.sendMessage(request);
    const resolvedModel = response?.payload?.model;
    if (response?.payload?.state === "ready" && resolvedModel && resolvedModel !== config.ner_model) {
      await saveSettings({ nerModel: resolvedModel });
    }
  } catch {
    // Best effort only. Detection already succeeded; a future popup/status
    // refresh can still display the resolved offscreen status.
  }
}

async function warmUpLocalAiFromActivity(settings: Awaited<ReturnType<typeof loadSettings>>): Promise<void> {
  if (!settings.autoWarmLocalAiOnActiveSupportedPage || activityWarmupInFlight) return;

  const systemStatus = (await ensureSystemCheckResult()).payload;
  if (!shouldAutoWarmLocalAi(settings, systemStatus, null)) return;

  activityWarmupInFlight = (async () => {
    const config = detectionOptionsFromSettings(settings);
    try {
      await withOffscreenOperation(async () => {
        await chrome.runtime.sendMessage({
          type: "DETECT_PII",
          payload: {
            requestId: `local-ai-active-page-warmup-${Date.now()}`,
            text: "Alice from Acme visited Berlin.",
            config,
          },
        } satisfies DetectPiiRequest);
        const status: NerStatusResponse = await chrome.runtime.sendMessage({ type: "GET_NER_STATUS", payload: { config } });
        await persistWarmupOutcome(status.payload);
      });
    } catch (err) {
      const fallback = fallbackNerStatus(
        config.ner_provider ?? settings.nerProvider,
        err instanceof Error ? err.message : String(err),
      );
      await persistWarmupOutcome(fallback);
    } finally {
      activityWarmupInFlight = null;
    }
  })();

  await activityWarmupInFlight;
}

async function recordSupportedPageActivity(
  sender: chrome.runtime.MessageSender,
  visible: boolean,
): Promise<void> {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") return;

  if (!visible) {
    if (lastSupportedPageActivityTabId === tabId) {
      lastSupportedPageActivityTabId = null;
    }
    void scheduleOffscreenIdleUnload();
    return;
  }

  const settings = await loadSettings();
  if (!settings.enabled || settings.nerProvider === "off") return;
  if (!isSupportedPageUrl(sender.tab?.url, settings)) return;

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id !== tabId) return;

  lastSupportedPageActivityAt = Date.now();
  lastSupportedPageActivityTabId = tabId;
  void scheduleOffscreenIdleUnload();
  void warmUpLocalAiFromActivity(settings);
}

/**
 * Wait until the offscreen document's `onMessage` listener is attached. After
 * `chrome.offscreen.createDocument` resolves the page exists, but its bundle
 * loads asynchronously, so forwarded messages can throw "Receiving end does
 * not exist" until the listener registers. Ping with a short backoff until we
 * get a pong (or give up after ~1s — at which point any forwarded call will
 * surface its own error).
 */
async function waitForOffscreenReady(attempts = 20, delayMs = 50): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const pong = await chrome.runtime.sendMessage({ type: "OFFSCREEN_PING" });
      if ((pong as { type?: string } | undefined)?.type === "OFFSCREEN_PONG") return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/Receiving end does not exist|message channel closed/i.test(message)) {
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

/**
 * Ensure the offscreen document exists AND its message listener is attached.
 * Concurrent callers serialise on a single creation promise and a single
 * handshake promise so a second caller can't slip through with hasDocument
 * returning true before the listener has registered.
 */
async function ensureOffscreen(): Promise<void> {
  const existing = await (chrome.offscreen as any).hasDocument();
  if (!existing) {
    invalidateOffscreenReady();
    if (offscreenCreating) {
      await offscreenCreating;
    } else {
      offscreenCreating = (chrome.offscreen as any).createDocument({
        url: OFFSCREEN_URL,
        reasons: ["WORKERS"],
        justification: "WASM PII detection pipeline",
      });
      try {
        await offscreenCreating;
      } finally {
        offscreenCreating = null;
      }
    }
  }

  if (!offscreenReady) {
    offscreenReady = waitForOffscreenReady();
  }
  await offscreenReady;
}

/** Handle messages from content scripts and popup. */
chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  if (!isBackgroundRequest(message)) {
    return false;
  }

  let responded = false;
  const safeSendResponse = (response: unknown): void => {
    responded = true;
    sendResponse(response);
  };

  handleMessage(message, sender, safeSendResponse).catch((err) => {
    console.error('[PG:background] Message handling failed:', err);
    if (!responded) {
      safeSendResponse({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
  return true; // keep channel open for async response
});

function isBackgroundRequest(message: Message): boolean {
  return message.type === "DETECT_PII"
    || message.type === "CANCEL_DETECTION"
    || message.type === "GET_NER_STATUS"
    || message.type === "LOG_FEEDBACK"
    || message.type === "OPEN_OPTIONS_PAGE"
    || message.type === "GET_SYSTEM_COMPATIBILITY_STATUS"
    || message.type === "SET_LOCAL_AI_DETECTION"
    || message.type === "WARM_UP_LOCAL_AI"
    || message.type === "SUPPORTED_PAGE_ACTIVITY"
    || message.type === "DISMISS_CRITICAL_LOCAL_AI_MODAL"
    || message.type === "RE_RUN_SYSTEM_CHECK"
    || message.type === "APPLY_CRITICAL_RECOMMENDATION";
}

async function handleMessage(
  message: Message,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
): Promise<void> {
  switch (message.type) {
    case "DETECT_PII": {
      const settings = await loadSettings();
      const config = detectionOptionsFromSettings(settings, message.payload.config);
      const request: DetectPiiRequest = {
        ...message,
        payload: { ...message.payload, config },
      };
      // Forward to offscreen document and relay response back. If explicit
      // cancellation force-closes the offscreen document, translate the broken
      // message channel back into a normal cancellation response.
      try {
        const response = await withOffscreenOperation(async () => {
          const forwardedResponse = await chrome.runtime.sendMessage(request);
          if ((forwardedResponse as PiiResultResponse | undefined)?.type === "PII_RESULT") {
            await persistResolvedNerModel(config);
          }
          return forwardedResponse;
        });
        sendResponse(response);
      } catch (err) {
        if (canceledDetectionIds.delete(message.payload.requestId)) {
          sendResponse(canceledResponse(message.payload.requestId));
          break;
        }
        sendResponse({
          type: "PII_RESULT",
          payload: { requestId: message.payload.requestId, spans: [], timings: { totalMs: 0 } },
          error: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case "CANCEL_DETECTION": {
      const { requestId } = message.payload;
      rememberCanceledDetection(requestId);
      sendResponse(canceledResponse(requestId));
      void cancelOffscreenBestEffort(requestId);
      break;
    }

    case "GET_NER_STATUS": {
      const settings = await loadSettings();
      const config = detectionOptionsFromSettings(settings, message.payload?.config);
      if (config.ner_provider === "off") {
        sendResponse({
          type: "NER_STATUS",
          payload: fallbackNerStatus("off", "Local AI detection is turned off."),
        } satisfies NerStatusResponse);
        break;
      }

      const request: GetNerStatusRequest = {
        type: "GET_NER_STATUS",
        payload: { config },
      };
      try {
        const response: NerStatusResponse = await withOffscreenOperation(() => chrome.runtime.sendMessage(request));
        sendResponse(response);
      } catch (err) {
        sendResponse({
          type: "NER_STATUS",
          payload: fallbackNerStatus(
            config.ner_provider ?? settings.nerProvider,
            err instanceof Error ? err.message : String(err),
          ),
        } satisfies NerStatusResponse);
      }
      break;
    }

    case "LOG_FEEDBACK": {
      await logFeedback(message.payload);
      sendResponse({ ok: true });
      break;
    }

    case "PII_RESULT": {
      // This comes from the offscreen document — forward to the requesting tab
      // The content script will receive this via its own message listener
      sendResponse({ ok: true });
      break;
    }

    case "OPEN_OPTIONS_PAGE": {
      const req = message as OpenOptionsPageRequest;
      await chrome.tabs.create({ url: req.payload.url });
      sendResponse({ ok: true });
      break;
    }

    case "GET_SYSTEM_COMPATIBILITY_STATUS": {
      const response = await ensureSystemCheckResult();
      sendResponse(response);
      break;
    }

    case "WARM_UP_LOCAL_AI": {
      const settings = await loadSettings();
      const config = detectionOptionsFromSettings(settings, message.payload?.config);
      if (config.ner_provider === "off") {
        sendResponse({
          type: "NER_STATUS",
          payload: fallbackNerStatus("off", "Local AI detection is turned off."),
        } satisfies NerStatusResponse);
        break;
      }

      try {
        const status: NerStatusResponse = await withOffscreenOperation(async () => {
          await chrome.runtime.sendMessage({
            type: "DETECT_PII",
            payload: {
              requestId: `local-ai-warmup-${Date.now()}`,
              text: "Alice from Acme visited Berlin.",
              config,
            },
          } satisfies DetectPiiRequest);
          return chrome.runtime.sendMessage({ type: "GET_NER_STATUS", payload: { config } });
        });
        await persistWarmupOutcome(status.payload);
        sendResponse(status);
      } catch (err) {
        const fallback = fallbackNerStatus(
          config.ner_provider ?? settings.nerProvider,
          err instanceof Error ? err.message : String(err),
        );
        await persistWarmupOutcome(fallback);
        sendResponse({ type: "NER_STATUS", payload: fallback } satisfies NerStatusResponse);
      }
      break;
    }

    case "SUPPORTED_PAGE_ACTIVITY": {
      await recordSupportedPageActivity(sender, message.payload.visible);
      sendResponse({ ok: true });
      break;
    }

    case "RE_RUN_SYSTEM_CHECK": {
      const signals = await collectPassiveSignals();
      const previous = await loadSystemCheckResult();
      const rebuilt = buildSystemCheckResult(signals, Date.now(), previous);
      await saveSystemCheckResult(rebuilt);

      const settings = await loadSettings();
      const pendingCriticalRecommendation =
        rebuilt.recommendation === "auto-disable-local-ai"
        && settings.nerProvider === "transformers"
        && !rebuilt.lowMemoryOverride;

      sendResponse({
        type: "SYSTEM_COMPATIBILITY_STATUS",
        payload: rebuilt,
        pendingCriticalRecommendation,
      });
      break;
    }

    case "APPLY_CRITICAL_RECOMMENDATION": {
      const current = await loadSystemCheckResult();
      if (!current) {
        sendResponse({ error: "No stored system check result" });
        break;
      }
      if (message.payload.accepted) {
        const settings = await loadSettings();
        if (settings.nerProvider === "transformers") {
          await saveSettings({ nerProvider: "off" });
        }
        await closeOffscreenBestEffort();
        const updated = await recordLowMemoryAutoDisable(current);
        sendResponse({ type: "SYSTEM_COMPATIBILITY_STATUS", payload: updated } satisfies SystemCompatibilityStatusResponse);
      } else {
        const updated = await recordRecommendationDeclined();
        sendResponse({
          type: "SYSTEM_COMPATIBILITY_STATUS",
          payload: updated ?? current,
        } satisfies SystemCompatibilityStatusResponse);
      }
      break;
    }

    case "DISMISS_CRITICAL_LOCAL_AI_MODAL": {
      const updated = await markCriticalModalDismissed();
      sendResponse({ ok: true, payload: updated });
      break;
    }

    case "SET_LOCAL_AI_DETECTION": {
      const response = await ensureSystemCheckResult();
      if (message.payload.enabled) {
        await saveSettings({ nerProvider: "transformers" });
        const updated = response.payload.tier === "critical"
          ? await recordLowMemoryOverride()
          : await recordLocalAiEnabled();
        sendResponse({ type: "SYSTEM_COMPATIBILITY_STATUS", payload: updated ?? response.payload } satisfies SystemCompatibilityStatusResponse);
      } else {
        await saveSettings({ nerProvider: "off" });
        await closeOffscreenBestEffort();
        const current = await loadSystemCheckResult();
        const updated = current ? await recordUserLocalAiOff(current) : response.payload;
        sendResponse({ type: "SYSTEM_COMPATIBILITY_STATUS", payload: updated } satisfies SystemCompatibilityStatusResponse);
      }
      break;
    }

    default:
      sendResponse({ error: "Unknown message type" });
  }
}

/** Initialize default settings on install. */
chrome.runtime.onInstalled.addListener(async () => {
  const settings = await loadSettings();
  await saveSettings(settings);
  await ensureSystemCheckResult();

  await updateActiveTabIcon();
});

chrome.runtime.onStartup.addListener(() => {
  void updateActiveTabIcon();
});

/** Update icon based on active tab URL. */
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    if (lastSupportedPageActivityTabId !== activeInfo.tabId) {
      lastSupportedPageActivityTabId = null;
      void scheduleOffscreenIdleUnload();
    }
    const tab = await chrome.tabs.get(activeInfo.tabId);
    await updateIcon(tab);
  } catch {
    // Tab may not exist.
  }
});

chrome.tabs.onUpdated.addListener(async (_tabId, _changeInfo, tab) => {
  if (typeof tab.id === "number" && tab.id === lastSupportedPageActivityTabId) {
    const settings = await loadSettings();
    if (!isSupportedPageUrl(tab.url, settings)) {
      lastSupportedPageActivityTabId = null;
      void scheduleOffscreenIdleUnload();
    }
  }
  await updateIcon(tab);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[SETTINGS_KEY]) {
    const nextSettings = changes[SETTINGS_KEY].newValue;
    if (nextSettings?.nerProvider === "off") {
      void closeOffscreenBestEffort();
    } else {
      void scheduleOffscreenIdleUnload();
    }
    void updateActiveTabIcon();
  }
});

async function updateActiveTabIcon(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    await updateIcon(tab);
  }
}

async function updateIcon(tab: chrome.tabs.Tab): Promise<void> {
  if (typeof tab.id !== "number") return;

  const settings = await loadSettings();
  const isMonitored = Boolean(
    tab.url && settings.curatedUrls.some((url) => tab.url!.startsWith(url)),
  );
  const iconPath = settings.enabled && isMonitored ? ACTIVE_ICON_PATHS : INACTIVE_ICON_PATHS;

  await chrome.action.setIcon({ path: iconPath, tabId: tab.id });
  await chrome.action.setBadgeText({ text: "", tabId: tab.id });
}
