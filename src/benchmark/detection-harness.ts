import * as fs from 'fs';
import * as path from 'path';
import { parseBenchmarkCorpusJsonl, type BenchmarkCorpus, type BenchmarkExample } from './contracts';
import {
  DEFAULT_NER_MODEL,
  DEFAULT_SETTINGS,
  NER_DTYPE_FILE_SUFFIX,
  NER_MODELS,
  type NerDtype,
  nerModelDefinitionFor,
} from '../shared/constants';
import type { DetectionOptions, NerModelKey, NerStatus, PiiSpan } from '../shared/message-types';
import { dtypeForDevice, requiredAssetsForDtype, type NerProvider } from '../offscreen/ner-provider';
import { createBenchmarkReport, formatBenchmarkReport } from './reporting';

export interface BenchmarkCliOptions {
  corpusPath: string;
  model: NerModelKey;
  dtype?: NerDtype;
  regexOnly: boolean;
  outputPath?: string;
  rootDir: string;
  help: boolean;
}

export interface BenchmarkExampleDetectionResult {
  id: string;
  spans: PiiSpan[];
  timings: {
    totalMs: number;
    nerMs?: number;
  };
}

export interface BenchmarkDetectionRunResult {
  corpus: {
    metadata: BenchmarkCorpus['metadata'];
    exampleCount: number;
  };
  sourceExamples: BenchmarkExample[];
  mode: 'regex-only' | 'model';
  config: DetectionOptions;
  provider: NerStatus;
  timings: {
    totalWallMs: number;
  };
  examples: BenchmarkExampleDetectionResult[];
}

export interface BenchmarkDetector {
  (text: string, config: DetectionOptions): Promise<{ spans: PiiSpan[]; nerMs?: number }>;
}

export interface RunBenchmarkDetectionOptions {
  corpusPath: string;
  model?: NerModelKey;
  dtype?: NerDtype;
  regexOnly?: boolean;
  outputPath?: string;
  rootDir?: string;
  detector?: BenchmarkDetector;
  getProviderStatus?: (config: DetectionOptions) => NerStatus;
  now?: () => number;
}

const DEFAULT_CORPUS_PATH = 'benchmarks/corpora/openpii-generated.jsonl';
const REQUIRED_RUNTIME_ASSETS = [
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
] as const;

export function benchmarkCliUsage(): string {
  return `
Run the OpenPII benchmark detection harness.

Usage:
  node scripts/run-openpii-benchmark.js [--corpus <path>] [--model <key> | --regex-only] [--out <path>]

Options:
  --corpus <path>     Benchmark JSONL corpus. Default: ${DEFAULT_CORPUS_PATH}
  --model <key>       Transformer model to run: ${NER_MODELS.map((model) => model.key).join(', ')}. Default: ${DEFAULT_NER_MODEL}
  --dtype <dtype>     ONNX artifact to load: ${Object.keys(NER_DTYPE_FILE_SUFFIX).join(', ')}. Default: the model's CPU-path artifact (${defaultBenchmarkDtype()} for ${DEFAULT_NER_MODEL}).
  --regex-only        Disable NER and run the final WASM regex/merge path only.
  --out <path>        Optional JSON output path for the raw detection run.
  --help              Show this help.
`.trim();
}

export function parseBenchmarkCliArgs(
  argv: string[],
  rootDir = process.cwd()
): BenchmarkCliOptions {
  const options: BenchmarkCliOptions = {
    corpusPath: path.resolve(rootDir, DEFAULT_CORPUS_PATH),
    model: DEFAULT_NER_MODEL,
    regexOnly: false,
    rootDir,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = (): string => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
      index += 1;
      return value;
    };

    switch (arg) {
      case '--corpus':
        options.corpusPath = path.resolve(rootDir, next());
        break;
      case '--model':
        options.model = parseModelKey(next());
        break;
      case '--dtype':
        options.dtype = parseDtype(next());
        break;
      case '--regex-only':
        options.regexOnly = true;
        break;
      case '--out':
        options.outputPath = path.resolve(rootDir, next());
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

export function createBenchmarkDetectionConfig(options: {
  model?: NerModelKey;
  regexOnly?: boolean;
}): DetectionOptions {
  return {
    min_confidence: DEFAULT_SETTINGS.minConfidence,
    context_boost: DEFAULT_SETTINGS.contextBoost,
    context_window: DEFAULT_SETTINGS.contextWindow,
    ner_provider: options.regexOnly ? 'off' : DEFAULT_SETTINGS.nerProvider,
    ner_model: options.model ?? DEFAULT_NER_MODEL,
    ner_enabled: !options.regexOnly,
  };
}

export function validateBenchmarkModelAssets(
  rootDir: string,
  modelKey: NerModelKey,
  dtype: NerDtype = defaultBenchmarkDtype(modelKey)
): void {
  const model = nerModelDefinitionFor(modelKey);
  const missing = [
    ...requiredAssetsForDtype(model, dtype).filter((assetPath) => !fileExists(resolvePackagedAsset(rootDir, assetPath))),
    ...REQUIRED_RUNTIME_ASSETS
      .map((fileName) => `vendor/onnxruntime-web/${fileName}`)
      .filter((assetPath) => !fileExists(resolvePackagedAsset(rootDir, assetPath))),
  ];

  if (missing.length > 0) {
    throw new Error(
      [
        `Missing local NER assets for model "${model.key}" (${model.label}): ${missing.join(', ')}.`,
        'Prepare the model assets before running a model-backed benchmark, or pass --regex-only.',
      ].join(' ')
    );
  }
}

export async function runBenchmarkDetection(
  options: RunBenchmarkDetectionOptions
): Promise<BenchmarkDetectionRunResult> {
  const rootDir = options.rootDir ?? process.cwd();
  const model = options.model ?? DEFAULT_NER_MODEL;
  const regexOnly = Boolean(options.regexOnly);
  if (!regexOnly) validateBenchmarkModelAssets(rootDir, model, options.dtype ?? defaultBenchmarkDtype(model));

  installNodeBenchmarkShims(rootDir);
  if (!options.detector) await configureNodeNerProviderFactory(options.dtype);
  const corpus = parseBenchmarkCorpusJsonl(fs.readFileSync(options.corpusPath, 'utf8'));
  const config = createBenchmarkDetectionConfig({ model, regexOnly });
  const detector = options.detector ?? defaultDetector;
  const readProviderStatus = options.getProviderStatus ?? defaultProviderStatus;
  const now = options.now ?? defaultNow;
  const examples: BenchmarkExampleDetectionResult[] = [];
  const runStartedAt = now();

  for (let i = 0; i < corpus.examples.length; i += 1) {
    const example = corpus.examples[i];
    examples.push(await detectExample(example, config, detector, now));
    if (i === 0 && !regexOnly) {
      const providerStatus = readProviderStatus(config);
      if (providerStatus.state === 'unavailable' || providerStatus.state === 'failed') {
        throw new Error(
          [
            `NER provider failed to load for model "${model}".`,
            `Status: ${providerStatus.state}${providerStatus.message ? ` — ${providerStatus.message}` : ''}.`,
            'Re-prepare the model assets (npm run prepare:model:<key>) or pass --regex-only to run without a model.',
          ].join(' ')
        );
      }
    }
  }
  const totalWallMs = Math.max(0, Math.round(now() - runStartedAt));

  const result: BenchmarkDetectionRunResult = {
    corpus: summarizeCorpus(corpus),
    sourceExamples: corpus.examples,
    mode: regexOnly ? 'regex-only' : 'model',
    config,
    provider: readProviderStatus(config),
    timings: { totalWallMs },
    examples,
  };

  if (options.outputPath) {
    const report = createBenchmarkReport(result);
    fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
    fs.writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  return result;
}

export function formatBenchmarkDetectionSummary(result: BenchmarkDetectionRunResult): string {
  return formatBenchmarkReport(createBenchmarkReport(result));
}

function parseModelKey(value: string): NerModelKey {
  const model = NER_MODELS.find((candidate) => candidate.key === value);
  if (!model) {
    throw new Error(`Unknown model "${value}". Supported models: ${NER_MODELS.map((item) => item.key).join(', ')}.`);
  }
  return model.key;
}

function parseDtype(value: string): NerDtype {
  const dtypes = Object.keys(NER_DTYPE_FILE_SUFFIX) as NerDtype[];
  const dtype = dtypes.find((candidate) => candidate === value);
  if (!dtype) {
    throw new Error(`Unknown dtype "${value}". Supported dtypes: ${dtypes.join(', ')}.`);
  }
  return dtype;
}

function defaultBenchmarkDtype(modelKey: NerModelKey = DEFAULT_NER_MODEL): NerDtype {
  return dtypeForDevice(nerModelDefinitionFor(modelKey), 'cpu');
}

/**
 * Point the detection module at providers that work under Node:
 * onnxruntime-node has no 'wasm' execution provider, so inference runs on the
 * native CPU EP, optionally with a forced artifact dtype (e.g., the WebGPU
 * q4f16 build) to measure quantization quality.
 */
async function configureNodeNerProviderFactory(dtype?: NerDtype): Promise<void> {
  const detection = await import('../offscreen/detection');
  const { createNerProvider, createTransformersNerProvider } = await import('../offscreen/ner-provider');
  const providerCache = new Map<string, NerProvider>();

  detection.setNerProviderFactoryForTests((mode, modelKey) => {
    if (mode !== 'transformers') return createNerProvider(mode, modelKey);

    const cacheKey = `${modelKey}:${dtype ?? 'default'}`;
    let provider = providerCache.get(cacheKey);
    if (!provider) {
      provider = createTransformersNerProvider({
        modelKey,
        deviceOverride: 'cpu',
        ...(dtype ? { dtypeOverride: dtype } : {}),
      });
      providerCache.set(cacheKey, provider);
    }
    return provider;
  });
}

async function detectExample(
  example: BenchmarkExample,
  config: DetectionOptions,
  detector: BenchmarkDetector,
  now: () => number
): Promise<BenchmarkExampleDetectionResult> {
  const startedAt = now();
  const { spans, nerMs } = await detector(example.text, config);
  return {
    id: example.id,
    spans,
    timings: {
      totalMs: Math.max(0, Math.round(now() - startedAt)),
      ...(typeof nerMs === 'number' ? { nerMs } : {}),
    },
  };
}

async function defaultDetector(
  text: string,
  config: DetectionOptions
): Promise<{ spans: PiiSpan[]; nerMs?: number }> {
  const { detectWithExternalNer } = await import('../offscreen/detection');
  return detectWithExternalNer(text, config);
}

function defaultProviderStatus(config: DetectionOptions): NerStatus {
  if (config.ner_provider === 'off') {
    const definition = nerModelDefinitionFor(config.ner_model ?? DEFAULT_NER_MODEL);
    return {
      mode: 'off',
      state: 'unavailable',
      model: definition.key,
      modelLabel: definition.label,
      message: 'NER provider is turned off.',
    };
  }

  const requireFn = eval('require') as NodeRequire;
  const { getNerStatus } = requireFn('../offscreen/detection') as {
    getNerStatus: (config?: DetectionOptions) => NerStatus;
  };
  return getNerStatus(config);
}

function summarizeCorpus(corpus: BenchmarkCorpus): BenchmarkDetectionRunResult['corpus'] {
  return {
    metadata: corpus.metadata,
    exampleCount: corpus.examples.length,
  };
}

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function resolvePackagedAsset(rootDir: string, assetPath: string): string {
  if (assetPath.startsWith('models/')) {
    return path.join(rootDir, 'generated', assetPath);
  }
  if (assetPath.startsWith('vendor/onnxruntime-web/')) {
    return path.join(rootDir, 'node_modules', 'onnxruntime-web', 'dist', path.basename(assetPath));
  }
  if (assetPath.startsWith('wasm/')) {
    return path.join(rootDir, 'crate', 'pkg', assetPath.replace(/^wasm\/privacy_guardrail_wasm_bg\.wasm$/, 'privacy_guardrail_wasm_bg.wasm'));
  }
  return path.join(rootDir, assetPath);
}

export function installNodeBenchmarkShims(rootDir: string): void {
  const globalObject = globalThis as typeof globalThis & { chrome?: any };
  globalObject.chrome ??= {};
  globalObject.chrome.runtime ??= {};
  globalObject.chrome.runtime.getURL = (assetPath: string) => resolvePackagedAsset(rootDir, assetPath);
}
