import type { LocalAiUnloadTimeoutMs, NerModelKey, NerWebGpuDtype, Settings } from './message-types';
import { defaultGroupsEnabled } from './category-groups';

/** Curated LLM chat URLs where paste interception is active. */
export const DEFAULT_CURATED_URLS = [
  'https://chat.openai.com',
  'https://chatgpt.com',
  'https://claude.ai',
  'https://gemini.google.com',
];

/** Minimum text length to trigger PII analysis on paste. */
export const MIN_PASTE_LENGTH = 10;

/** Maximum text length before chunking for NER. */
export const MAX_TEXT_LENGTH = 5000;

/** Delay (ms) before de-anonymizing a streaming response. */
export const RESPONSE_DEBOUNCE_MS = 500;

/** How long (ms) the "no PII found" indicator stays visible. */
export const NO_PII_INDICATOR_MS = 1500;

/** How long (ms) the post-anonymization chip stays visible. */
export const CHIP_FADE_MS = 5000;

/** Offscreen document idle timeout before closing (ms). */
export const OFFSCREEN_IDLE_MS = 600_000 satisfies LocalAiUnloadTimeoutMs;
export const LOCAL_AI_ACTIVITY_WINDOW_MS = 30_000;
export const LOCAL_AI_ACTIVITY_HEARTBEAT_MS = 15_000;
export const LOCAL_AI_UNLOAD_TIMEOUT_CHOICES: readonly LocalAiUnloadTimeoutMs[] = [
  60_000,
  300_000,
  600_000,
  1_800_000,
  null,
];

export type NerDtype = 'q8' | 'fp16' | 'q4f16';

/**
 * WebGPU artifact choices exposed on the options page. Order matters for the
 * UI: the low-memory default comes first.
 */
export const NER_WEBGPU_DTYPE_CHOICES: readonly NerWebGpuDtype[] = ['q4f16'];

/**
 * External-data companion file for an ONNX artifact whose weights live outside
 * the protobuf. `path` must match the `location` recorded inside the .onnx
 * graph; `data` is the asset path relative to the model directory, fetched at
 * session creation and handed to ONNX Runtime.
 */
export interface NerExternalDataAsset {
  path: string;
  data: string;
}

/** Maps a dtype to the Transformers.js model file suffix it loads. */
export const NER_DTYPE_FILE_SUFFIX: Readonly<Record<NerDtype, string>> = {
  q8: '_quantized',
  fp16: '_fp16',
  q4f16: '_q4f16',
};

/** A curated ONNX artifact for one WebGPU dtype choice. */
export interface NerWebGpuArtifact {
  requiredAssets: readonly string[];
  /** External weight files accompanying the artifact, if any. */
  externalData?: readonly NerExternalDataAsset[];
}

export interface NerModelDefinition {
  key: NerModelKey;
  label: string;
  modelId: string;
  assetBasePath: string;
  requiredAssets: readonly string[];
  /** ONNX dtype used for the browser CPU/WASM path. Defaults to q8 for older models. */
  wasmDtype?: NerDtype;
  /** Default WebGPU dtype when the user expressed no preference. */
  webGpuDtype?: NerDtype;
  /** Curated non-q8 artifacts, keyed by dtype. */
  webGpuArtifacts?: Partial<Readonly<Record<NerDtype, NerWebGpuArtifact>>>;
}

export const DEFAULT_NER_MODEL: NerModelKey = 'bardsai';

export const NER_MODELS: readonly NerModelDefinition[] = [
  {
    key: 'ai4privacy',
    label: 'AI4Privacy prototype',
    modelId: 'ner/ai4privacy',
    assetBasePath: 'models/ner/ai4privacy',
    requiredAssets: [
      'models/ner/ai4privacy/config.json',
      'models/ner/ai4privacy/tokenizer.json',
      'models/ner/ai4privacy/tokenizer_config.json',
      'models/ner/ai4privacy/onnx/model_quantized.onnx',
    ],
  },
  {
    key: 'bardsai',
    label: 'BardsAI EU multilingual',
    modelId: 'ner/bardsai-eu-pii-anonimization-multilang',
    assetBasePath: 'models/ner/bardsai-eu-pii-anonimization-multilang',
    requiredAssets: [
      'models/ner/bardsai-eu-pii-anonimization-multilang/config.json',
      'models/ner/bardsai-eu-pii-anonimization-multilang/tokenizer.json',
      'models/ner/bardsai-eu-pii-anonimization-multilang/tokenizer_config.json',
      'models/ner/bardsai-eu-pii-anonimization-multilang/onnx/model_quantized.onnx',
    ],
    // The active CPU/WebGPU artifacts ship as ONNX external data: an embedded-weights
    // protobuf forces ORT to copy all weights through the wasm heap several
    // times during session init (JS fetch buffer, wasm-heap copy,
    // protobuf-parsed initializers, optimizer copies) and wasm memory never
    // shrinks — with the 555 MB embedded fp16 build the offscreen document
    // sat at multiple GB afterwards. With external data the parsed graph is
    // ~330 KB and the weight buffer is handed to ORT separately and uploaded
    // to the selected execution provider.
    wasmDtype: 'q4f16',
    webGpuDtype: 'q4f16',
    webGpuArtifacts: {
      q4f16: {
        requiredAssets: [
          'models/ner/bardsai-eu-pii-anonimization-multilang/config.json',
          'models/ner/bardsai-eu-pii-anonimization-multilang/tokenizer.json',
          'models/ner/bardsai-eu-pii-anonimization-multilang/tokenizer_config.json',
          'models/ner/bardsai-eu-pii-anonimization-multilang/onnx/model_q4f16.onnx',
          'models/ner/bardsai-eu-pii-anonimization-multilang/onnx/model_q4f16.onnx.data',
        ],
        externalData: [
          {
            path: 'model_q4f16.onnx.data',
            data: 'onnx/model_q4f16.onnx.data',
          },
        ],
      },
    },
  },
  {
    key: 'hikmaai',
    label: 'HikmaAI DistilBERT PII',
    modelId: 'ner/hikmaai-distilbert-pii',
    assetBasePath: 'models/ner/hikmaai-distilbert-pii',
    requiredAssets: [
      'models/ner/hikmaai-distilbert-pii/config.json',
      'models/ner/hikmaai-distilbert-pii/tokenizer.json',
      'models/ner/hikmaai-distilbert-pii/tokenizer_config.json',
      'models/ner/hikmaai-distilbert-pii/onnx/model_quantized.onnx',
    ],
    webGpuDtype: 'fp16',
    // Inactive model; its fp16 artifact still ships weights embedded in the
    // protobuf. Repackage as external data before reactivating.
    webGpuArtifacts: {
      fp16: {
        requiredAssets: [
          'models/ner/hikmaai-distilbert-pii/config.json',
          'models/ner/hikmaai-distilbert-pii/tokenizer.json',
          'models/ner/hikmaai-distilbert-pii/tokenizer_config.json',
          'models/ner/hikmaai-distilbert-pii/onnx/model_fp16.onnx',
        ],
      },
    },
  },
] as const;

export const ACTIVE_NER_MODELS: readonly NerModelDefinition[] = NER_MODELS.filter(
  (model) => model.key === DEFAULT_NER_MODEL
);

export function runtimeNerModelKey(key: NerModelKey | undefined): NerModelKey {
  return key && ACTIVE_NER_MODELS.some((model) => model.key === key)
    ? key
    : DEFAULT_NER_MODEL;
}

export function nerModelDefinitionFor(key: NerModelKey): NerModelDefinition {
  return NER_MODELS.find((model) => model.key === key) ?? NER_MODELS[0];
}

/** One entry in the merged model + GPU precision picker. */
export interface NerModelChoice {
  /** Composite select value: `key` or `key@dtype`. */
  value: string;
  key: NerModelKey;
  /** WebGPU dtype this entry selects; null when the model offers no choice. */
  dtype: NerWebGpuDtype | null;
  label: string;
}

function webGpuDtypeChoicesFor(model: NerModelDefinition): readonly NerWebGpuDtype[] {
  return NER_WEBGPU_DTYPE_CHOICES.filter((dtype) => model.webGpuArtifacts?.[dtype]);
}

/**
 * Flattens models into picker entries shared by the popup and the options
 * page. A model with multiple curated WebGPU artifacts appears once per
 * dtype, labelled "Label (dtype)".
 */
export function nerModelChoices(
  models: readonly NerModelDefinition[] = ACTIVE_NER_MODELS,
): NerModelChoice[] {
  return models.flatMap((model): NerModelChoice[] => {
    const dtypes = webGpuDtypeChoicesFor(model);
    if (dtypes.length < 2) {
      return [{ value: model.key, key: model.key, dtype: null, label: model.label }];
    }
    return dtypes.map((dtype) => ({
      value: `${model.key}@${dtype}`,
      key: model.key,
      dtype,
      label: `${model.label} (${dtype})`,
    }));
  });
}

/** Select value matching the persisted model + dtype settings. */
export function nerModelChoiceValue(
  key: NerModelKey,
  dtype: NerWebGpuDtype | undefined,
  models: readonly NerModelDefinition[] = ACTIVE_NER_MODELS,
): string {
  const choices = nerModelChoices(models);
  const wanted = dtype ?? DEFAULT_SETTINGS.nerWebGpuDtype;
  const match = choices.find(
    (choice) => choice.key === key && (choice.dtype === null || choice.dtype === wanted),
  );
  return (match ?? choices.find((choice) => choice.key === key) ?? choices[0]).value;
}

/** Inverse of {@link nerModelChoiceValue}: settings patch for a select value. */
export function parseNerModelChoice(
  value: string,
): { nerModel: NerModelKey; nerWebGpuDtype?: NerWebGpuDtype } {
  const [key, dtype] = value.split('@');
  const nerModel = key as NerModelKey;
  return dtype && (NER_WEBGPU_DTYPE_CHOICES as readonly string[]).includes(dtype)
    ? { nerModel, nerWebGpuDtype: dtype as NerWebGpuDtype }
    : { nerModel };
}

/** Default extension settings. */
export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  // Default-on while stabilizing the local transformer NER bundle — gives
  // the offscreen `[PG:ner]` log breadcrumbs needed to diagnose label-mapping
  // or threshold-filter issues without asking the tester to flip a toggle.
  // Flip back to false once the model is proven stable across supported browsers.
  debug: true,
  minConfidence: 0.5,
  sensitivityMode: 'global',
  groupThresholds: {},
  contextBoost: 0.15,
  contextWindow: 5,
  curatedUrls: DEFAULT_CURATED_URLS,
  allowlist: [],
  blocklist: [],
  nerProvider: 'transformers',
  nerModel: DEFAULT_NER_MODEL,
  // q4f16 external data keeps the offscreen document around 1 GB while loaded.
  nerWebGpuDtype: 'q4f16',
  groupsEnabled: defaultGroupsEnabled(),
  // The vault is enabled by default; consistency across sessions is the
  // primary value-add and the storage cost is negligible.
  identityVaultEnabled: true,
  // Conservative default — placeholder mode is what existing tests rely
  // on and is the easiest behaviour to explain to a new user. Users who
  // want better LLM response quality flip this to `synthetic`.
  defaultReplacementMode: 'placeholder',
  // Existing users see no change — `dark` matches what the popup and
  // options page have always rendered.
  theme: 'dark',
  // Preserve the behavior shipped by the clipboard-interception slices:
  // users can opt out from the popup if the copy toast feels intrusive.
  clipboardInterceptEnabled: true,
  skipCodeBlocks: false,
  // Privacy-safe default: an explicit cancel asks what to do with the pending paste.
  cancelDetectionBehavior: 'ask',
  localAiUnloadTimeoutMs: OFFSCREEN_IDLE_MS,
  keepLocalAiLoadedWhileActive: true,
  autoWarmLocalAiOnActiveSupportedPage: true,
};

/** Placeholder format for anonymized entities. */
export function placeholder(type: string, index: number): string {
  return `[${type}_${index}]`;
}

/** Regex to match placeholders in text (e.g., [PERSON_1], [EMAIL_2]). */
export const PLACEHOLDER_REGEX = /\[([A-Z_]+)_(\d+)\]/g;
