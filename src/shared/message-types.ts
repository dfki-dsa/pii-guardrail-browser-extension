export type GroupName =
  | 'Identity'
  | 'Contact'
  | 'Financial'
  | 'Network'
  | 'Location'
  | 'Password'
  | 'Organization'
  | 'Low-signal';

/** Entity types matching the Rust WASM module's EntityType enum. */
export type EntityType =
  | 'PERSON'
  | 'EMAIL'
  | 'PHONE'
  | 'CREDIT_CARD'
  | 'SSN'
  | 'IBAN'
  | 'IP_ADDRESS'
  | 'LOCATION'
  | 'ORGANIZATION'
  | 'ADDRESS'
  | 'URL'
  | 'USERNAME'
  | 'PASSWORD'
  | 'BANK_ACCOUNT'
  | 'DATE'
  | 'MISC';

export const ENTITY_TYPES: readonly EntityType[] = [
  'PERSON',
  'EMAIL',
  'PHONE',
  'CREDIT_CARD',
  'SSN',
  'IBAN',
  'IP_ADDRESS',
  'LOCATION',
  'ORGANIZATION',
  'ADDRESS',
  'URL',
  'USERNAME',
  'PASSWORD',
  'BANK_ACCOUNT',
  'DATE',
  'MISC',
];

/** Detection source — which pipeline stage produced this span. */
export type DetectionSource = 'regex' | 'ner' | 'manual';

/** A detected PII span returned from the WASM module. */
export interface PiiSpan {
  start: number;
  end: number;
  entity_type: EntityType;
  score: number;
  text: string;
  source: DetectionSource;
  /** Set by the pipeline when skipCodeBlocks is true and the span's start lies inside a code region. */
  inCodeBlock?: boolean;
  /** For NER-sourced spans: the raw model label before it was mapped to entity_type. Debug aid only. */
  nerRawLabel?: string;
}

/** Pipeline configuration sent to the WASM module. */
export interface PipelineConfig {
  min_confidence: number;
  context_boost: number;
  context_window: number;
  ner_enabled: boolean;
}

export type NerProviderMode = 'off' | 'fixture' | 'transformers';
export type NerModelKey = 'ai4privacy' | 'bardsai' | 'hikmaai';
export type NerRuntimeState = 'idle' | 'unavailable' | 'loading' | 'ready' | 'failed';
// 'cpu' only occurs in the Node benchmark harness (onnxruntime-node has no
// wasm EP); the extension itself runs 'wasm' or 'webgpu'.
export type NerInferenceDevice = 'wasm' | 'webgpu' | 'cpu';
/**
 * User-selectable ONNX artifact for the WebGPU device path. q4f16 is the only
 * packaged runtime artifact and is also used by the WASM fallback.
 */
export type NerWebGpuDtype = 'q4f16';
export type BrowserMemoryTier = 'critical' | 'warning' | 'ok' | 'unknown';
export type WebGpuAvailability = 'available' | 'unavailable' | 'unknown';
export type LocalAiProtectionState =
  | 'enabled'
  | 'off-user-choice'
  | 'off-low-memory-auto'
  | 'off-load-failure'
  | 'enabled-low-memory-override';

export interface NerTimingInfo {
  totalMs: number;
  loadMs?: number;
  inferenceMs?: number;
  chunkCount?: number;
  textBytes?: number;
  wasCold?: boolean;
}

export interface NerStatus {
  mode: NerProviderMode;
  state: NerRuntimeState;
  model?: NerModelKey;
  modelLabel?: string;
  device?: NerInferenceDevice;
  message?: string;
  timings?: NerTimingInfo;
}

export interface DetectionOptions extends Partial<PipelineConfig> {
  ner_provider?: NerProviderMode;
  ner_model?: NerModelKey;
  /** WebGPU precision preference — ignored on the wasm fallback path. */
  ner_webgpu_dtype?: NerWebGpuDtype;
}

/** Feedback entry logged when a user corrects a detection. */
export interface FeedbackEntry {
  text: string;
  detectedType: EntityType | null;
  correctedType: EntityType | 'NOT_PII';
  context: string;
  timestamp: number;
}

// --- Chrome runtime message types ---

export interface DetectPiiRequest {
  type: 'DETECT_PII';
  payload: {
    text: string;
    requestId: string;
    config?: DetectionOptions;
  };
}

export interface CancelDetectionRequest {
  type: 'CANCEL_DETECTION';
  payload: {
    requestId: string;
  };
}

export interface DetectionCanceledResponse {
  type: 'DETECTION_CANCELED';
  payload: {
    requestId: string;
  };
}

export interface PiiResultResponse {
  type: 'PII_RESULT';
  payload: {
    requestId: string;
    spans: PiiSpan[];
    timings?: {
      totalMs: number;
      nerMs?: number;
    };
  };
}

export interface GetNerStatusRequest {
  type: 'GET_NER_STATUS';
  payload?: {
    config?: DetectionOptions;
  };
}

export interface NerStatusResponse {
  type: 'NER_STATUS';
  payload: NerStatus;
}

/**
 * Lightweight liveness probe used by the service worker to confirm that
 * the offscreen document's `onMessage` listener has attached after
 * `chrome.offscreen.createDocument` resolved (the document's JS loads
 * asynchronously, so a freshly created document can briefly throw
 * "Receiving end does not exist" on forwarded messages).
 */
export interface OffscreenPingRequest {
  type: 'OFFSCREEN_PING';
}

export interface OffscreenPongResponse {
  type: 'OFFSCREEN_PONG';
}

/**
 * Pushed from the offscreen document whenever the in-memory NER status
 * transitions (idle → loading → ready/unavailable). Popup / options pages
 * subscribe to keep their pills in sync without polling.
 */
export interface NerStatusChangedBroadcast {
  type: 'NER_STATUS_CHANGED';
  payload: NerStatus;
}

export interface LogFeedbackRequest {
  type: 'LOG_FEEDBACK';
  payload: FeedbackEntry;
}

export interface SettingsUpdatedMessage {
  type: 'SETTINGS_UPDATED';
  payload: Settings;
}

export interface OpenOptionsPageRequest {
  type: 'OPEN_OPTIONS_PAGE';
  payload: { url: string };
}

export interface SystemCompatibilityStatus {
  schemaVersion: number;
  policyVersion: number;
  checkedAt: number;
  browserMemoryGb?: number;
  webGpu: WebGpuAvailability;
  tier: BrowserMemoryTier;
  recommendation: 'auto-disable-local-ai' | 'warn' | 'none';
  notes: string[];
  localAiState: LocalAiProtectionState;
  runtimeState: NerRuntimeState | 'unknown' | 'not-loaded';
  criticalModal: 'none' | 'pending' | 'dismissed';
  loadFailure?: { message: string; at: number };
}

export interface GetSystemCompatibilityStatusRequest {
  type: 'GET_SYSTEM_COMPATIBILITY_STATUS';
}

export interface SystemCompatibilityStatusResponse {
  type: 'SYSTEM_COMPATIBILITY_STATUS';
  payload: SystemCompatibilityStatus;
}

export interface SetLocalAiDetectionRequest {
  type: 'SET_LOCAL_AI_DETECTION';
  payload: { enabled: boolean };
}

export interface WarmUpLocalAiRequest {
  type: 'WARM_UP_LOCAL_AI';
  payload?: {
    config?: DetectionOptions;
  };
}

export interface SupportedPageActivityRequest {
  type: 'SUPPORTED_PAGE_ACTIVITY';
  payload: {
    visible: boolean;
  };
}

export interface DismissCriticalLocalAiModalRequest {
  type: 'DISMISS_CRITICAL_LOCAL_AI_MODAL';
}

export interface CollectSystemSignalsRequest {
  type: 'COLLECT_SYSTEM_SIGNALS';
}

export interface ReRunSystemCheckRequest {
  type: 'RE_RUN_SYSTEM_CHECK';
}

export interface ReRunSystemCheckResponse {
  type: 'SYSTEM_COMPATIBILITY_STATUS';
  payload: SystemCompatibilityStatus;
  /**
   * True when the freshly-collected status recommends auto-disabling Local AI
   * and Local AI is currently enabled (not already off, not via override). The
   * caller must obtain user confirmation and then send
   * APPLY_CRITICAL_RECOMMENDATION before the recommendation takes effect.
   */
  pendingCriticalRecommendation: boolean;
}

export interface ApplyCriticalRecommendationRequest {
  type: 'APPLY_CRITICAL_RECOMMENDATION';
  payload: { accepted: boolean };
}

export interface SystemSignalsResponse {
  type: 'SYSTEM_SIGNALS';
  payload: {
    browserMemoryGb?: number;
    webGpu: WebGpuAvailability;
  };
  error?: string;
}

export interface AllowlistEntry {
  pattern: string;
  scope: 'any';
  addedAt: number;
  source: 'manual' | 'detection';
}

export interface BlocklistEntry {
  pattern: string;
  /** 'any' means inject as MISC; a concrete EntityType forces that category. */
  scope: EntityType | 'any';
  addedAt: number;
  source: 'manual' | 'detection';
}

/**
 * How an anonymised entity is rendered into the outgoing prompt.
 *  - `placeholder`: typed token like `[PERSON_1]` (default; safest, easy
 *    to round-trip but can degrade LLM response quality).
 *  - `synthetic`: realistic but obviously-fake replacement like
 *    `Jordan Park`. Improves response naturalness at the cost of having
 *    to track synthetic-to-original mappings during de-anonymisation.
 */
export type ReplacementModeSetting = 'placeholder' | 'synthetic';

/**
 * Visual theme applied to extension UI surfaces (popup, options page,
 * Shadow DOM components on host pages). `dark` matches the default
 * deep-blue gradient palette; `light` is a minimal, low-contrast white
 * scheme that fits better on light hosts.
 */
export type ThemeSetting = 'dark' | 'light';

export type CancelDetectionBehavior = 'ask' | 'paste-original' | 'drop';
export type LocalAiUnloadTimeoutMs = 60_000 | 300_000 | 600_000 | 1_800_000 | null;

export interface Settings {
  enabled: boolean;
  debug: boolean;
  minConfidence: number;
  sensitivityMode: 'global' | 'individual';
  groupThresholds: Partial<Record<GroupName, number>>;
  contextBoost: number;
  contextWindow: number;
  curatedUrls: string[];
  allowlist: AllowlistEntry[];
  blocklist: BlocklistEntry[];
  nerProvider: NerProviderMode;
  nerModel: NerModelKey;
  /** ONNX artifact used when Local AI runs on WebGPU. The wasm fallback
   *  uses the model's low-memory CPU artifact, so this only matters on capable GPUs. */
  nerWebGpuDtype: NerWebGpuDtype;
  groupsEnabled: Record<GroupName, boolean>;
  /** Default replacement mode applied to records whose own
   *  `replacementMode` matches this. Effectively a global toggle. */
  defaultReplacementMode: ReplacementModeSetting;
  /** Master switch for the cross-session identity vault. When false the
   *  legacy per-conversation anonymisation behaviour is used. */
  identityVaultEnabled: boolean;
  /** UI colour scheme. `dark` is the default dramatic palette; `light`
   *  is a minimal white surface for users who prefer a quiet UI. */
  theme: ThemeSetting;
  /** Fine-grained switch for the clipboard de-anonymization toast. */
  clipboardInterceptEnabled: boolean;
  /** When true, skip PII detection inside fenced code blocks / preformatted regions. */
  skipCodeBlocks: boolean;
  /** What to do after the user explicitly cancels a running paste scan. */
  cancelDetectionBehavior: CancelDetectionBehavior;
  /** How long the Local AI runtime may remain loaded after relevant activity. Null keeps it for the browser session. */
  localAiUnloadTimeoutMs: LocalAiUnloadTimeoutMs;
  /** Keep an already-loaded Local AI runtime resident while the user is active on a foreground supported page. */
  keepLocalAiLoadedWhileActive: boolean;
  /** Proactively load Local AI when the user is active on a foreground supported page. */
  autoWarmLocalAiOnActiveSupportedPage: boolean;
}

export type Message =
  | DetectPiiRequest
  | CancelDetectionRequest
  | DetectionCanceledResponse
  | PiiResultResponse
  | GetNerStatusRequest
  | NerStatusResponse
  | NerStatusChangedBroadcast
  | OffscreenPingRequest
  | OffscreenPongResponse
  | LogFeedbackRequest
  | SettingsUpdatedMessage
  | OpenOptionsPageRequest
  | GetSystemCompatibilityStatusRequest
  | SystemCompatibilityStatusResponse
  | SetLocalAiDetectionRequest
  | WarmUpLocalAiRequest
  | SupportedPageActivityRequest
  | DismissCriticalLocalAiModalRequest
  | CollectSystemSignalsRequest
  | SystemSignalsResponse
  | ReRunSystemCheckRequest
  | ApplyCriticalRecommendationRequest;
