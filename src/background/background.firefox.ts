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
} from "../shared/message-types";
import { loadSettings, saveSettings, logFeedback } from "../shared/storage";
import { detectionOptionsFromSettings, fallbackNerStatus } from "../shared/detection-config";
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
import { detectWithExternalNer, getNerStatus } from "../offscreen/detection";
import { collectPassiveSystemSignals } from "../system-check/passive-signals";

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

// Active detections tracked here since we run detection in-process (no offscreen relay).
const activeDetections = new Map<string, AbortController>();
const canceledDetectionIds = new Set<string>();

function canceledResponse(requestId: string): DetectionCanceledResponse {
  return { type: "DETECTION_CANCELED", payload: { requestId } };
}

function rememberCanceledDetection(requestId: string): void {
  canceledDetectionIds.add(requestId);
  setTimeout(() => canceledDetectionIds.delete(requestId), 300000);
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
    return recordLowMemoryAutoDisable(result);
  }
  if (settings.nerProvider === "off" && result.localAiState === "enabled") {
    return recordUserLocalAiOff(result);
  }
  return result;
}

// Firefox background page is persistent — collect signals directly without offscreen.
async function collectPassiveSignals() {
  return collectPassiveSystemSignals();
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

async function persistResolvedNerModel(config: DetectPiiRequest["payload"]["config"]): Promise<void> {
  if (config?.ner_provider !== "transformers" || !config.ner_model) return;
  try {
    const nerStatusPayload = getNerStatus(config);
    const resolvedModel = nerStatusPayload?.model;
    if (nerStatusPayload?.state === "ready" && resolvedModel && resolvedModel !== config.ner_model) {
      await saveSettings({ nerModel: resolvedModel });
    }
  } catch {
    // Best effort only.
  }
}

function isBackgroundRequest(message: Message): boolean {
  return message.type === "DETECT_PII"
    || message.type === "CANCEL_DETECTION"
    || message.type === "GET_NER_STATUS"
    || message.type === "LOG_FEEDBACK"
    || message.type === "OPEN_OPTIONS_PAGE"
    || message.type === "GET_SYSTEM_COMPATIBILITY_STATUS"
    || message.type === "SET_LOCAL_AI_DETECTION"
    || message.type === "WARM_UP_LOCAL_AI"
    || message.type === "DISMISS_CRITICAL_LOCAL_AI_MODAL"
    || message.type === "RE_RUN_SYSTEM_CHECK"
    || message.type === "APPLY_CRITICAL_RECOMMENDATION";
}

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  if (!isBackgroundRequest(message)) return false;

  let responded = false;
  const safeSendResponse = (response: unknown): void => {
    responded = true;
    sendResponse(response);
  };

  handleMessage(message, sender, safeSendResponse).catch((err) => {
    console.error('[PG:background] Message handling failed:', err);
    if (!responded) {
      safeSendResponse({ error: err instanceof Error ? err.message : String(err) });
    }
  });
  return true;
});

async function handleMessage(
  message: Message,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
): Promise<void> {
  switch (message.type) {
    case "DETECT_PII": {
      const settings = await loadSettings();
      const config = detectionOptionsFromSettings(settings, message.payload.config);
      const { requestId, text } = message.payload;

      if (canceledDetectionIds.delete(requestId)) {
        sendResponse(canceledResponse(requestId));
        break;
      }

      const abortController = new AbortController();
      activeDetections.set(requestId, abortController);

      try {
        const startTime = performance.now();
        const { spans, nerMs } = await detectWithExternalNer(text, config, abortController.signal);
        activeDetections.delete(requestId);

        if (canceledDetectionIds.delete(requestId)) {
          sendResponse(canceledResponse(requestId));
          break;
        }

        const totalMs = Math.round(performance.now() - startTime);
        const response: PiiResultResponse = {
          type: "PII_RESULT",
          payload: { requestId, spans, timings: { totalMs, nerMs } },
        };
        await persistResolvedNerModel(config);
        sendResponse(response);
      } catch (err) {
        activeDetections.delete(requestId);
        if (abortController.signal.aborted) {
          sendResponse(canceledResponse(requestId));
          break;
        }
        if (canceledDetectionIds.delete(requestId)) {
          sendResponse(canceledResponse(requestId));
          break;
        }
        sendResponse({
          type: "PII_RESULT",
          payload: { requestId, spans: [], timings: { totalMs: 0 } },
          error: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case "CANCEL_DETECTION": {
      const { requestId } = (message as CancelDetectionRequest).payload;
      rememberCanceledDetection(requestId);
      const activeDetection = activeDetections.get(requestId);
      if (activeDetection) {
        activeDetection.abort();
        activeDetections.delete(requestId);
      }
      sendResponse(canceledResponse(requestId));
      break;
    }

    case "GET_NER_STATUS": {
      const settings = await loadSettings();
      const config = detectionOptionsFromSettings(settings, (message as GetNerStatusRequest).payload?.config);
      sendResponse({
        type: "NER_STATUS",
        payload: getNerStatus(config),
      } satisfies NerStatusResponse);
      break;
    }

    case "LOG_FEEDBACK": {
      await logFeedback(message.payload);
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
        await detectWithExternalNer("Alice from Acme visited Berlin.", config);
        const nerStatusPayload = getNerStatus(config);
        await persistWarmupOutcome(nerStatusPayload);
        sendResponse({ type: "NER_STATUS", payload: nerStatusPayload } satisfies NerStatusResponse);
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

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await loadSettings();
  await saveSettings(settings);
  await ensureSystemCheckResult();
  await updateActiveTabIcon();
});

chrome.runtime.onStartup.addListener(() => {
  void updateActiveTabIcon();
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId) ?? undefined;
    if (tab) await updateIcon(tab);
  } catch {
    // Tab may not exist.
  }
});

chrome.tabs.onUpdated.addListener(async (_tabId, _changeInfo, tab) => {
  await updateIcon(tab);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[SETTINGS_KEY]) {
    void updateActiveTabIcon();
  }
});

async function updateActiveTabIcon(): Promise<void> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true }) ?? [];
  const [tab] = tabs;
  if (tab) {
    await updateIcon(tab);
  }
}

async function updateIcon(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab || typeof tab.id !== "number") return;

  const settings = await loadSettings();
  const isMonitored = Boolean(
    tab.url && settings.curatedUrls.some((url) => tab.url!.startsWith(url)),
  );
  const iconPath = settings.enabled && isMonitored ? ACTIVE_ICON_PATHS : INACTIVE_ICON_PATHS;

  await chrome.action.setIcon({ path: iconPath, tabId: tab.id });
  await chrome.action.setBadgeText({ text: "", tabId: tab.id });
}
