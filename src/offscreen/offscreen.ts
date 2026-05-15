import type {
  CancelDetectionRequest,
  DetectPiiRequest,
  DetectionCanceledResponse,
  GetNerStatusRequest,
  Message,
  NerStatusResponse,
  OffscreenPongResponse,
  PiiResultResponse,
} from '../shared/message-types';
import { debugLog, initDebugFlag } from './debug';
import { detectWithExternalNer, getNerStatus } from './detection';

initDebugFlag();

const activeDetections = new Map<string, AbortController>();
const canceledDetections = new Set<string>();

function canceledResponse(requestId: string): DetectionCanceledResponse {
  return {
    type: 'DETECTION_CANCELED',
    payload: { requestId },
  };
}

/**
 * Offscreen document — receives DETECT_PII messages from the service worker,
 * runs the WASM detection pipeline, and returns results.
 */
chrome.runtime.onMessage.addListener(
  (message: Message, _sender, sendResponse) => {
    if (message.type === 'OFFSCREEN_PING') {
      const pong: OffscreenPongResponse = { type: 'OFFSCREEN_PONG' };
      sendResponse(pong);
      return false;
    }

    if (message.type === 'CANCEL_DETECTION') {
      const { requestId } = (message as CancelDetectionRequest).payload;
      const activeDetection = activeDetections.get(requestId);
      if (activeDetection) {
        activeDetection.abort();
        activeDetections.delete(requestId);
      } else {
        canceledDetections.add(requestId);
        window.setTimeout(() => canceledDetections.delete(requestId), 300000);
      }
      sendResponse(canceledResponse(requestId));
      return false;
    }

    if (message.type === 'GET_NER_STATUS') {
      const { config } = (message as GetNerStatusRequest).payload ?? {};
      const response: NerStatusResponse = {
        type: 'NER_STATUS',
        payload: getNerStatus(config),
      };
      sendResponse(response);
      return false;
    }

    if (message.type !== 'DETECT_PII') return false;

    const { text, requestId, config } = (message as DetectPiiRequest).payload;
    if (canceledDetections.delete(requestId)) {
      sendResponse(canceledResponse(requestId));
      return false;
    }

    debugLog('[PG:offscreen] DETECT_PII received', {
      requestId,
      textLength: text.length,
      config,
    });
    const startTime = performance.now();
    const abortController = new AbortController();
    activeDetections.set(requestId, abortController);

    detectWithExternalNer(text, config, abortController.signal)
      .then(({ spans, nerMs }) => {
        activeDetections.delete(requestId);
        const totalMs = Math.round(performance.now() - startTime);
        const response: PiiResultResponse = {
          type: 'PII_RESULT',
          payload: { requestId, spans, timings: { totalMs, nerMs } },
        };
        sendResponse(response);
      })
      .catch((err) => {
        activeDetections.delete(requestId);
        if (abortController.signal.aborted || err?.name === 'AbortError') {
          sendResponse(canceledResponse(requestId));
          return;
        }

        console.error('[PG:offscreen] Detection error:', err);
        sendResponse({
          type: 'PII_RESULT',
          payload: { requestId, spans: [], timings: { totalMs: 0 } },
        });
      });

    return true; // keep channel open for async response
  }
);

console.log('[PG:offscreen] Offscreen document ready');
