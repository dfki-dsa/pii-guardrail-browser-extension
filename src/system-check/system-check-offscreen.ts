import type { CollectSystemSignalsRequest, SystemSignalsResponse } from '../shared/message-types';
import { collectPassiveSystemSignals } from './passive-signals';

chrome.runtime.onMessage.addListener((message: CollectSystemSignalsRequest, _sender, sendResponse) => {
  if (message?.type !== 'COLLECT_SYSTEM_SIGNALS') return false;

  collectPassiveSystemSignals()
    .then((signals) => {
      const response: SystemSignalsResponse = { type: 'SYSTEM_SIGNALS', payload: signals };
      sendResponse(response);
    })
    .catch((error) => {
      const response: SystemSignalsResponse = {
        type: 'SYSTEM_SIGNALS',
        payload: { webGpu: 'unknown' },
        error: error instanceof Error ? error.message : String(error),
      };
      sendResponse(response);
    });

  return true;
});
