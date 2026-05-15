import { readFileSync } from 'fs';
import { join } from 'path';

import { SYSTEM_CHECK_STORAGE_KEY, buildSystemCheckResult } from '../../src/shared/system-check-storage';
import { DEFAULT_SETTINGS } from '../../src/shared/constants';

const SRC_ROOT = join(__dirname, '..', '..', 'src');

function readSource(relative: string): string {
  return readFileSync(join(SRC_ROOT, relative), 'utf8');
}

describe('passive system-check release-readiness invariants', () => {
  describe('source-level isolation from the heavy detection pipeline', () => {
    const heavyImportPatterns = [
      /['"]@xenova\/transformers['"]/,
      /['"]@huggingface\/transformers['"]/,
      /onnxruntime-web/,
      /['"][^'"]*ner-provider['"]/,
      /['"][^'"]*wasm-bridge['"]/,
      /['"][^'"]*offscreen\/detection['"]/,
      /['"][^'"]*offscreen\/offscreen['"]/,
    ];
    const networkPatterns = [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bsendBeacon\b/];

    test.each([
      'system-check/passive-signals.ts',
      'system-check/system-check-offscreen.ts',
      'shared/system-compatibility-policy.ts',
      'shared/system-check-storage.ts',
    ])('%s pulls in no Transformers/ONNX/NER/WASM module', (file) => {
      const source = readSource(file);
      heavyImportPatterns.forEach((pattern) => {
        expect(source).not.toMatch(pattern);
      });
    });

    test.each([
      'system-check/passive-signals.ts',
      'system-check/system-check-offscreen.ts',
      'shared/system-compatibility-policy.ts',
    ])('%s issues no outbound network call', (file) => {
      const source = readSource(file);
      networkPatterns.forEach((pattern) => {
        expect(source).not.toMatch(pattern);
      });
    });

    test('passive-signals returns unknown WebGPU when navigator.gpu is missing', async () => {
      const { collectPassiveSystemSignals } = await import('../../src/system-check/passive-signals');
      const signals = await collectPassiveSystemSignals({} as Navigator);
      expect(signals).toEqual({ webGpu: 'unavailable' });
    });

    test('passive-signals returns unknown WebGPU when requestAdapter rejects', async () => {
      const { collectPassiveSystemSignals } = await import('../../src/system-check/passive-signals');
      const signals = await collectPassiveSystemSignals({
        gpu: { requestAdapter: jest.fn().mockRejectedValue(new Error('boom')) },
      } as unknown as Navigator);
      expect(signals).toEqual({ webGpu: 'unknown' });
    });
  });

  describe('background offscreen lifecycle around passive system-check', () => {
    let store: Record<string, unknown>;
    let messageListener: ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean) | undefined;
    let sendMessage: jest.Mock;
    let createDocument: jest.Mock;
    let closeDocument: jest.Mock;
    let hasDocument: jest.Mock;

    async function importWorker(): Promise<void> {
      jest.resetModules();
      store = {};
      messageListener = undefined;
      sendMessage = jest.fn().mockResolvedValue({});
      createDocument = jest.fn().mockResolvedValue(undefined);
      closeDocument = jest.fn().mockResolvedValue(undefined);
      hasDocument = jest.fn().mockResolvedValue(false);

      (globalThis as any).chrome = {
        storage: {
          local: {
            get: jest.fn(async (key: string) => ({ [key]: store[key] })),
            set: jest.fn(async (value: Record<string, unknown>) => { store = { ...store, ...value }; }),
            remove: jest.fn(async (key: string) => { delete store[key]; }),
          },
          onChanged: { addListener: jest.fn() },
        },
        runtime: {
          sendMessage,
          onMessage: { addListener: jest.fn((listener) => { messageListener = listener; }) },
          onInstalled: { addListener: jest.fn() },
          onStartup: { addListener: jest.fn() },
          getURL: jest.fn((path: string) => `chrome-extension://test/${path}`),
        },
        offscreen: {
          hasDocument,
          createDocument,
          closeDocument,
        },
        tabs: {
          query: jest.fn().mockResolvedValue([]),
          get: jest.fn(),
          create: jest.fn(),
          onActivated: { addListener: jest.fn() },
          onUpdated: { addListener: jest.fn() },
        },
        action: {
          setIcon: jest.fn(),
          setBadgeText: jest.fn(),
        },
      };

      await import('../../src/background/service-worker');
    }

    test('closes the system-check offscreen document immediately after a successful collect', async () => {
      await importWorker();
      store[SETTINGS_KEY()] = { ...DEFAULT_SETTINGS, nerProvider: 'transformers' };
      sendMessage.mockImplementation(async (message) => {
        if (message?.type === 'COLLECT_SYSTEM_SIGNALS') {
          // After Chrome dispatches the signal, the offscreen doc still exists.
          hasDocument.mockResolvedValue(true);
          return { type: 'SYSTEM_SIGNALS', payload: { browserMemoryGb: 32, webGpu: 'available' } };
        }
        return {};
      });

      await new Promise<unknown>((resolve) => {
        messageListener?.({ type: 'RE_RUN_SYSTEM_CHECK' }, {}, resolve);
      });

      expect(createDocument).toHaveBeenCalledTimes(1);
      expect(createDocument.mock.calls[0][0].url).toContain('system-check/system-check-offscreen.html');
      expect(closeDocument).toHaveBeenCalled();
    });

    test('still closes the system-check offscreen document if COLLECT_SYSTEM_SIGNALS rejects', async () => {
      await importWorker();
      store[SETTINGS_KEY()] = { ...DEFAULT_SETTINGS, nerProvider: 'transformers' };
      store[SYSTEM_CHECK_STORAGE_KEY] = buildSystemCheckResult({ browserMemoryGb: 32, webGpu: 'available' }, 100);
      sendMessage.mockImplementation(async (message) => {
        if (message?.type === 'COLLECT_SYSTEM_SIGNALS') {
          hasDocument.mockResolvedValue(true);
          throw new Error('passive collector exploded');
        }
        return {};
      });

      const response = await new Promise<any>((resolve) => {
        messageListener?.({ type: 'RE_RUN_SYSTEM_CHECK' }, {}, resolve);
      });

      // Background relays the error to the caller.
      expect(response).toEqual(expect.objectContaining({ error: expect.any(String) }));
      expect(createDocument).toHaveBeenCalledTimes(1);
      // closeDocument is invoked both before opening and in the finally clause.
      expect(closeDocument).toHaveBeenCalled();
      const lastCloseAt = closeDocument.mock.invocationCallOrder.slice(-1)[0];
      const createAt = createDocument.mock.invocationCallOrder[0];
      expect(lastCloseAt).toBeGreaterThan(createAt);
    });

    test('passive system-check never creates the heavy NER offscreen document', async () => {
      await importWorker();
      store[SETTINGS_KEY()] = { ...DEFAULT_SETTINGS, nerProvider: 'transformers' };
      sendMessage.mockImplementation(async (message) => {
        if (message?.type === 'COLLECT_SYSTEM_SIGNALS') {
          return { type: 'SYSTEM_SIGNALS', payload: { browserMemoryGb: 32, webGpu: 'available' } };
        }
        return {};
      });

      await new Promise<unknown>((resolve) => {
        messageListener?.({ type: 'RE_RUN_SYSTEM_CHECK' }, {}, resolve);
      });

      const heavyOffscreenOpens = createDocument.mock.calls.filter(([opts]) => /offscreen\/offscreen\.html$/.test(opts.url));
      expect(heavyOffscreenOpens).toHaveLength(0);
      const nerStatusCalls = sendMessage.mock.calls.filter(([msg]) => msg?.type === 'GET_NER_STATUS' || msg?.type === 'DETECT_PII');
      expect(nerStatusCalls).toHaveLength(0);
    });
  });
});

function SETTINGS_KEY(): string {
  return 'pg_settings';
}
