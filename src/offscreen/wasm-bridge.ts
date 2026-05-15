import type { DetectionOptions, PiiSpan } from '../shared/message-types';

let wasmModule: typeof import('../../crate/pkg/privacy_guardrail_wasm.js') | null =
  null;
let initPromise: Promise<void> | null = null;

function isNodeRuntime(): boolean {
  return Boolean((globalThis as typeof globalThis & { process?: { versions?: { node?: string } } }).process?.versions?.node);
}

function nodeWasmInitTarget(): Uint8Array {
  const requireFn = eval('require') as NodeRequire;
  const fs = requireFn('fs') as typeof import('fs');
  return fs.readFileSync(chrome.runtime.getURL('wasm/privacy_guardrail_wasm_bg.wasm'));
}

/**
 * Load and initialize the WASM module.
 * Caches the module after first load.
 */
export async function ensureWasm(): Promise<void> {
  if (wasmModule) return;

  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = (async () => {
    // The generated wasm-bindgen JS wrapper is bundled into the offscreen entry.
    // Load the compiled WASM from the extension's packaged asset path.
    const mod = await import('../../crate/pkg/privacy_guardrail_wasm.js');
    await mod.default({
      module_or_path: isNodeRuntime()
        ? nodeWasmInitTarget()
        : chrome.runtime.getURL('wasm/privacy_guardrail_wasm_bg.wasm'),
    });
    mod.init();
    wasmModule = mod;
  })();

  await initPromise;
}

/**
 * Run PII detection on text via the WASM pipeline.
 */
export async function detectPii(
  text: string,
  config?: DetectionOptions,
  externalNerSpans: PiiSpan[] = []
): Promise<PiiSpan[]> {
  await ensureWasm();

  const configJson = config ? JSON.stringify(config) : '';
  const resultJson =
    externalNerSpans.length > 0
      ? (wasmModule! as any).detect_pii_with_external_spans(
          text,
          configJson,
          JSON.stringify(externalNerSpans)
        )
      : wasmModule!.detect_pii(text, configJson);
  return JSON.parse(resultJson) as PiiSpan[];
}

/**
 * Check if the NER model is loaded in the WASM module.
 */
export async function isNerReady(): Promise<boolean> {
  await ensureWasm();
  return wasmModule!.is_ner_ready();
}

/**
 * Get the default pipeline configuration from WASM.
 */
export async function getDefaultConfig(): Promise<Required<Omit<DetectionOptions, 'ner_provider'>>> {
  await ensureWasm();
  const json = wasmModule!.default_config();
  return JSON.parse(json) as Required<Omit<DetectionOptions, 'ner_provider'>>;
}
