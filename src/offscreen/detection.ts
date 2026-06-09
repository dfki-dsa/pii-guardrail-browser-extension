import type {
  DetectionOptions,
  NerProviderMode,
  NerStatus,
  NerStatusChangedBroadcast,
  PiiSpan,
} from '../shared/message-types';
import { ACTIVE_NER_MODELS, DEFAULT_NER_MODEL, nerModelDefinitionFor, runtimeNerModelKey } from '../shared/constants';
import { debugLog } from './debug';
import { detectPii } from './wasm-bridge';
import { createNerProvider, resetNerProviderCachesForTests, type NerProvider } from './ner-provider';

type NerProviderFactory = (mode: NerProviderMode, model: NonNullable<DetectionOptions['ner_model']>) => NerProvider | null;

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;

  throw new DOMException('Detection canceled', 'AbortError');
}

function initialTransformersStatus(model = DEFAULT_NER_MODEL): NerStatus {
  const definition = nerModelDefinitionFor(runtimeNerModelKey(model));
  return {
    mode: 'transformers',
    state: 'idle',
    model: definition.key,
    modelLabel: definition.label,
    message: `${definition.label} will load on first detection.`,
  };
}

let providerFactory: NerProviderFactory = createNerProvider;
let status: NerStatus = initialTransformersStatus();

function providerMode(config?: DetectionOptions): NerProviderMode {
  return config?.ner_provider ?? 'transformers';
}

function providerModel(config?: DetectionOptions): NonNullable<DetectionOptions['ner_model']> {
  return runtimeNerModelKey(config?.ner_model);
}

function nerStatusEqual(a: NerStatus, b: NerStatus): boolean {
  return a.mode === b.mode
    && a.state === b.state
    && a.model === b.model
    && a.modelLabel === b.modelLabel
    && a.device === b.device
    && a.message === b.message;
}

function setNerStatus(next: NerStatus): void {
  if (nerStatusEqual(status, next)) {
    status = next;
    return;
  }
  status = next;
  const broadcast: NerStatusChangedBroadcast = { type: 'NER_STATUS_CHANGED', payload: next };
  try {
    void chrome.runtime.sendMessage(broadcast).catch(() => undefined);
  } catch {
    // No listeners (popup closed, no options page open) — broadcast is best-effort.
  }
}

function regexOnlyConfig(config: DetectionOptions | undefined): DetectionOptions {
  return {
    ...config,
    ner_enabled: false,
  };
}

function transformerModelFallbackOrder(
  selected: NonNullable<DetectionOptions['ner_model']>
): NonNullable<DetectionOptions['ner_model']>[] {
  const normalizedSelected = runtimeNerModelKey(selected);
  return [
    normalizedSelected,
    ...ACTIVE_NER_MODELS
      .map((model) => model.key)
      .filter((model) => model !== normalizedSelected),
  ];
}

export function getNerStatus(config?: DetectionOptions): NerStatus {
  const mode = providerMode(config);
  const model = providerModel(config);
  const definition = nerModelDefinitionFor(model);

  if (mode === 'off') {
    return {
      mode,
      state: 'unavailable',
      model: definition.key,
      modelLabel: definition.label,
      message: 'NER provider is turned off.',
    };
  }

  if (mode === 'transformers' && status.mode === 'transformers' && status.state === 'ready') {
    return status;
  }

  if (mode === 'transformers' && (status.mode !== 'transformers' || status.model !== model)) {
    return initialTransformersStatus(model);
  }

  if (mode === 'fixture' && status.mode !== 'fixture') {
    return {
      mode,
      state: 'ready',
      message: 'Fixture NER provider is ready.',
    };
  }

  return status;
}

interface ExternalNerResult {
  spans: PiiSpan[];
  nerMs?: number;
}

async function externalNerSpansFor(
  text: string,
  config?: DetectionOptions,
  signal?: AbortSignal
): Promise<ExternalNerResult> {
  throwIfAborted(signal);
  const mode = providerMode(config);
  const model = providerModel(config);
  const definition = nerModelDefinitionFor(model);
  debugLog('[PG:offscreen] external NER requested', {
    mode,
    model,
    textLength: text.length,
    nerEnabledInConfig: config?.ner_enabled,
  });
  if (mode === 'off') {
    return { spans: [] };
  }

  const startedAt = performance.now();
  const modelsToTry = mode === 'transformers' ? transformerModelFallbackOrder(model) : [model];
  let lastProvider: NerProvider | null = null;
  let lastError: unknown;
  let selectedProvider: NerProvider | null = null;
  let selectedError: unknown;

  for (const candidateModel of modelsToTry) {
    throwIfAborted(signal);
    const candidateDefinition = nerModelDefinitionFor(candidateModel);
    const provider = providerFactory(mode, candidateModel);
    if (!provider) {
      console.warn('[PG:offscreen] no provider returned for mode/model', {
        mode,
        model: candidateModel,
      });
      lastError = new Error('No NER provider is available for the selected mode.');
      if (candidateModel === model) {
        selectedError = lastError;
      }
      if (mode === 'transformers') continue;
      setNerStatus({
        mode,
        state: 'unavailable',
        model: candidateDefinition.key,
        modelLabel: candidateDefinition.label,
        message: 'No NER provider is available for the selected mode.',
      });
      return { spans: [] };
    }

    lastProvider = provider;
    if (candidateModel === model) {
      selectedProvider = provider;
    }
    debugLog('[PG:offscreen] provider obtained', {
      providerMode: provider.mode,
      model: provider.model,
    });

    setNerStatus({
      mode,
      state: 'loading',
      model: provider.model ?? candidateDefinition.key,
      modelLabel: provider.modelLabel ?? candidateDefinition.label,
    });

    try {
      const spans = signal ? await provider.detect(text, signal) : await provider.detect(text);
      throwIfAborted(signal);
      const nerMs = Math.round(performance.now() - startedAt);
      const timings = provider.getLastTiming?.();
      const device = provider.getDevice?.();
      debugLog('[PG:offscreen] provider.detect returned', {
        mode,
        model: provider.model,
        nerMs,
        spanCount: spans.length,
        timings,
        device,
      });
      setNerStatus({
        mode,
        state: 'ready',
        model: provider.model ?? candidateDefinition.key,
        modelLabel: provider.modelLabel ?? candidateDefinition.label,
        device,
        message:
          mode === 'fixture'
            ? 'Fixture NER provider is ready.'
            : `${provider.modelLabel ?? candidateDefinition.label} is ready.`,
        timings,
      });
      return { spans, nerMs };
    } catch (err) {
      if (signal?.aborted) {
        throw err;
      }

      lastError = err;
      if (candidateModel === model) {
        selectedError = err;
      }
      console.error('[PG:offscreen] NER provider failed:', err);
      if (mode !== 'transformers') break;
    }
  }

  const nerMs = Math.round(performance.now() - startedAt);
  const reportedProvider = selectedProvider ?? lastProvider;
  const reportedError = selectedError ?? lastError;
  const message = reportedError instanceof Error ? reportedError.message : String(reportedError);
  setNerStatus({
    mode,
    state: mode === 'transformers' ? 'unavailable' : 'failed',
    model: reportedProvider?.model ?? definition.key,
    modelLabel: reportedProvider?.modelLabel ?? definition.label,
    message,
  });
  return { spans: [], nerMs };
}

export interface DetectionResult {
  spans: PiiSpan[];
  nerMs?: number;
}

export async function detectWithExternalNer(
  text: string,
  config?: DetectionOptions,
  signal?: AbortSignal
): Promise<DetectionResult> {
  throwIfAborted(signal);
  const { spans: externalNerSpans, nerMs } = await externalNerSpansFor(text, config, signal);
  throwIfAborted(signal);
  const detectConfig = externalNerSpans.length > 0 ? config : regexOnlyConfig(config);
  debugLog('[PG:offscreen] handing off to WASM', {
    externalNerSpanCount: externalNerSpans.length,
    nerEnabledForWasm: detectConfig?.ner_enabled,
  });
  const spans = await detectPii(text, detectConfig, externalNerSpans);
  reattachNerRawLabels(spans, externalNerSpans);
  throwIfAborted(signal);
  debugLog('[PG:offscreen] WASM pipeline result', {
    finalSpanCount: spans.length,
    bySource: spans.reduce<Record<string, number>>((acc, s) => {
      acc[s.source] = (acc[s.source] ?? 0) + 1;
      return acc;
    }, {}),
  });
  return { spans, nerMs };
}

function reattachNerRawLabels(spans: PiiSpan[], externalNerSpans: PiiSpan[]): void {
  if (externalNerSpans.length === 0) return;
  const key = (s: PiiSpan) => `${s.start}:${s.end}:${s.entity_type}`;
  const labels = new Map<string, string>();
  for (const span of externalNerSpans) {
    if (span.nerRawLabel) labels.set(key(span), span.nerRawLabel);
  }
  for (const span of spans) {
    if (span.source !== 'ner' || span.nerRawLabel) continue;
    const raw = labels.get(key(span));
    if (raw) span.nerRawLabel = raw;
  }
}

export function setNerProviderFactoryForTests(factory: NerProviderFactory): void {
  providerFactory = factory;
}

export function resetNerProviderStateForTests(): void {
  providerFactory = createNerProvider;
  resetNerProviderCachesForTests();
  status = initialTransformersStatus();
}
