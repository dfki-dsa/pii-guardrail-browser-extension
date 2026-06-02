import type { LocalAiUnloadTimeoutMs, NerModelKey, Settings } from './message-types';
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

export interface NerModelDefinition {
  key: NerModelKey;
  label: string;
  modelId: string;
  assetBasePath: string;
  requiredAssets: readonly string[];
  webGpuDtype?: 'fp16' | 'q8';
  webGpuRequiredAssets?: readonly string[];
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
    webGpuDtype: 'fp16',
    webGpuRequiredAssets: [
      'models/ner/bardsai-eu-pii-anonimization-multilang/config.json',
      'models/ner/bardsai-eu-pii-anonimization-multilang/tokenizer.json',
      'models/ner/bardsai-eu-pii-anonimization-multilang/tokenizer_config.json',
      'models/ner/bardsai-eu-pii-anonimization-multilang/onnx/model_fp16.onnx',
    ],
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
    webGpuRequiredAssets: [
      'models/ner/hikmaai-distilbert-pii/config.json',
      'models/ner/hikmaai-distilbert-pii/tokenizer.json',
      'models/ner/hikmaai-distilbert-pii/tokenizer_config.json',
      'models/ner/hikmaai-distilbert-pii/onnx/model_fp16.onnx',
    ],
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
