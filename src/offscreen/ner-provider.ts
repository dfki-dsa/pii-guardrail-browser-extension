import {
  DEFAULT_NER_MODEL,
  MAX_TEXT_LENGTH,
  NER_DTYPE_FILE_SUFFIX,
  type NerDtype,
  type NerExternalDataAsset,
  type NerModelDefinition,
  nerModelDefinitionFor,
} from '../shared/constants';
import type {
  EntityType,
  NerInferenceDevice,
  NerModelKey,
  NerProviderMode,
  NerTimingInfo,
  NerWebGpuDtype,
  PiiSpan,
} from '../shared/message-types';
import { loadSystemCheckResult } from '../shared/system-check-storage';
import {
  byteLength,
  byteOffsetToStringIndex,
  sliceTextByByteOffsets,
  stringIndexToByteOffset,
} from '../shared/text-offsets';
import { debugLog } from './debug';
import {
  alignTokensToText,
  alignmentCoverage,
  type TokenCharRange,
} from './token-offsets';

export interface NerProvider {
  readonly mode: NerProviderMode;
  readonly model?: NerModelKey;
  readonly modelLabel?: string;
  detect(text: string, signal?: AbortSignal): Promise<PiiSpan[]>;
  getLastTiming?(): NerTimingInfo | undefined;
  getDevice?(): NerInferenceDevice | undefined;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;

  throw new DOMException('Detection canceled', 'AbortError');
}

export class NerProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NerProviderUnavailableError';
  }
}

interface FixtureEntity {
  text: string;
  entityType: EntityType;
  score: number;
}

export type TokenClassificationItem = {
  word: string;
  score: number;
  entity?: string;
  entity_group?: string;
  start?: number;
  end?: number;
  /** Index into 'input_ids'; the join key onto the offset table. Raw output only. */
  index?: number;
};

export interface NerTokenizerLike {
  tokenize(text: string, options?: { add_special_tokens?: boolean }): string[];
  readonly model_max_length?: number;
}

type TokenClassificationPipeline = ((
  text: string,
  options?: { aggregation_strategy?: 'simple' | 'none'; ignore_labels?: string[] }
) => Promise<TokenClassificationItem[]>) & {
  tokenizer?: NerTokenizerLike;
};

type OnnxWasmPaths = string | { mjs?: string; wasm?: string };

type OnnxWasmEnv = {
  wasmPaths?: OnnxWasmPaths;
  numThreads?: number;
  proxy?: boolean;
};

type TransformersModule = {
  env: {
    allowRemoteModels: boolean;
    allowLocalModels: boolean;
    localModelPath: string;
    useBrowserCache: boolean;
    useFSCache: boolean;
    useWasmCache: boolean;
    backends: {
      onnx: {
        wasm?: OnnxWasmEnv;
      };
    };
  };
  pipeline: (
    task: 'token-classification',
    model: string,
    options?: {
      dtype?: NerDtype;
      local_files_only?: boolean;
      device?: NerInferenceDevice;
      session_options?: { externalData?: NerExternalDataAsset[] };
    }
  ) => Promise<TokenClassificationPipeline>;
};

/** 'Partial<Navigator>': the offscreen document's DOM lib varies, and only 'gpu' is read. */
type NavigatorWithWebGpu = Partial<Navigator> & {
  gpu?: {
    requestAdapter?: () => Promise<unknown>;
  };
};

interface TransformersProviderOptions {
  modelKey?: NerModelKey;
  loadTransformers?: () => Promise<TransformersModule>;
  getExtensionUrl?: (path: string) => string;
  assetExists?: (url: string) => Promise<boolean>;
  chunking?: NerChunkingOptions;
  detectWebGpu?: () => Promise<boolean>;
  /**
   * Benchmark/test escape hatch: force a specific ONNX artifact instead of
   * the device-derived one (e.g., run the WebGPU q4f16 artifact on the CPU
   * EP in Node to measure quantization quality).
   */
  dtypeOverride?: NerDtype;
  /** Benchmark/test escape hatch: force the execution provider. */
  deviceOverride?: NerInferenceDevice;
  /**
   * User preference for the WebGPU artifact (options page). Consulted only
   * when the resolved device is 'webgpu' — the wasm fallback uses the model's
   * low-memory CPU dtype. Unlike `dtypeOverride` this never forces a
   * user-selected WebGPU artifact onto the CPU path.
   */
  webGpuDtypePreference?: NerWebGpuDtype;
}

export interface NerTextChunk {
  text: string;
  startChar: number;
  endChar: number;
  startByte: number;
  endByte: number;
}

export interface NerChunkingOptions {
  maxChunkChars?: number;
  overlapChars?: number;
}

const MODEL_ASSET_ROOT = 'models/';
const ONNX_RUNTIME_ASSET_ROOT = 'vendor/onnxruntime-web/';
const REQUIRED_RUNTIME_ASSETS = [
  // CPU/WASM path uses the non-asyncify build; it has the known-good CPU
  // behavior from the q8 fallback path and avoids the asyncify CPU regression.
  'vendor/onnxruntime-web/ort-wasm-simd-threaded.mjs',
  'vendor/onnxruntime-web/ort-wasm-simd-threaded.wasm',
  // WebGPU path requires the asyncify build — that's the one that exports
  // webgpuInit and that ort.webgpu.bundle.min.mjs (bundled inside
  // transformers.js v4) actually references.
  'vendor/onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs',
  'vendor/onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm',
] as const;

export const DEFAULT_NER_CHUNK_OVERLAP_CHARS = 256;

export const DEFAULT_NER_MAX_TOKENS_PER_CHUNK = 480;
export const DEFAULT_NER_CHUNK_OVERLAP_TOKENS = 64;

export const FALLBACK_MAX_CHUNK_CHARS = 800;

// Distilbert-uncased + AI4Privacy emits softer scores than typical NER models
// (e.g., a clear "Acme Corp" landed at 0.46 in real test traffic). Privacy
// guardrails must err toward over-detection — false positives become a user
// dismiss action in the overlay, false negatives leak PII. So we set
// thresholds well below the model's "high-confidence" band, keeping MISC
// conservative per the PRD to limit noise from broad/unsupported labels.
//
// Rust's `ner_min_confidence` in `crate/src/pipeline.rs` is the authoritative
// final filter and must be no stricter than these model-specific TS gates. The
// TS gate keeps noise off the WASM boundary.
export const NER_THRESHOLD_BY_ENTITY_TYPE: Readonly<Record<EntityType, number>> = {
  // High-value NER-only types — over-detect, but never below the global
  // `min_confidence=0.5` baseline (PRD user story 17 — NER must be at least
  // as strict as regex).
  PERSON: 0.55,
  ORGANIZATION: 0.50,
  LOCATION: 0.55,
  ADDRESS: 0.55,
  URL: 0.60,
  USERNAME: 0.60,
  PASSWORD: 0.60,
  BANK_ACCOUNT: 0.50,
  // Structured types also covered by regex/checksum recognizers, which take
  // precedence on overlap. NER acts as a backup for obfuscated formats.
  EMAIL: 0.80,
  PHONE: 0.80,
  CREDIT_CARD: 0.80,
  SSN: 0.80,
  IBAN: 0.80,
  IP_ADDRESS: 0.80,
  DATE: 0.80,
  // MISC catches AI4Privacy labels we don't have a dedicated bucket for —
  // keep conservative to avoid distracting users with weak guesses.
  MISC: 0.90,
};

const BARDSAI_NER_THRESHOLD_BY_ENTITY_TYPE: Readonly<Record<EntityType, number>> = {
  PERSON: 0.55,
  ORGANIZATION: 0.50,
  LOCATION: 0.55,
  ADDRESS: 0.55,
  URL: 0.60,
  USERNAME: 0.60,
  PASSWORD: 0.60,
  BANK_ACCOUNT: 0.50,
  EMAIL: 0.80,
  PHONE: 0.80,
  CREDIT_CARD: 0.80,
  SSN: 0.80,
  IBAN: 0.80,
  IP_ADDRESS: 0.80,
  DATE: 0.80,
  // BardsAI has explicit sensitive-data labels that the app currently
  // collapses to MISC. Keep recall higher for those categories.
  MISC: 0.70,
};

const NER_THRESHOLDS_BY_MODEL: Readonly<Record<NerModelKey, Readonly<Record<EntityType, number>>>> = {
  ai4privacy: NER_THRESHOLD_BY_ENTITY_TYPE,
  bardsai: BARDSAI_NER_THRESHOLD_BY_ENTITY_TYPE,
  // HikmaAI shares AI4Privacy's distilbert-base-uncased base, so reuse the
  // same threshold table until benchmark numbers justify tuning.
  hikmaai: NER_THRESHOLD_BY_ENTITY_TYPE,
};

const AI4PRIVACY_LABEL_MAP: Readonly<Record<string, EntityType>> = {
  PER: 'PERSON',
  PERSON: 'PERSON',
  NAME: 'PERSON',
  FULL_NAME: 'PERSON',
  FIRSTNAME: 'PERSON',
  FIRST_NAME: 'PERSON',
  GIVEN_NAME: 'PERSON',
  LASTNAME: 'PERSON',
  LAST_NAME: 'PERSON',
  FAMILY_NAME: 'PERSON',
  MIDDLENAME: 'PERSON',
  MIDDLE_NAME: 'PERSON',

  ORG: 'ORGANIZATION',
  ORGANIZATION: 'ORGANIZATION',
  ORGANISATION: 'ORGANIZATION',
  COMPANY: 'ORGANIZATION',
  COMPANY_NAME: 'ORGANIZATION',
  COMPANYNAME: 'ORGANIZATION',
  BUSINESS: 'ORGANIZATION',

  LOC: 'LOCATION',
  LOCATION: 'LOCATION',
  GPE: 'LOCATION',
  CITY: 'LOCATION',
  COUNTRY: 'LOCATION',
  STATE: 'LOCATION',
  COUNTY: 'LOCATION',
  REGION: 'LOCATION',

  ADDRESS: 'ADDRESS',
  STREET: 'ADDRESS',
  STREET_ADDRESS: 'ADDRESS',
  STREETADDRESS: 'ADDRESS',
  POSTAL_ADDRESS: 'ADDRESS',
  POSTCODE: 'ADDRESS',
  POSTAL_CODE: 'ADDRESS',
  ZIP: 'ADDRESS',
  ZIPCODE: 'ADDRESS',
  ZIP_CODE: 'ADDRESS',

  URL: 'URL',
  URI: 'URL',
  WEBSITE: 'URL',
  WEB_URL: 'URL',

  USERNAME: 'USERNAME',
  USER_NAME: 'USERNAME',
  HANDLE: 'USERNAME',
  LOGIN: 'USERNAME',

  PASSWORD: 'PASSWORD',
  PASSWD: 'PASSWORD',
  PASSCODE: 'PASSWORD',
  PIN: 'PASSWORD',

  BANK_ACCOUNT: 'BANK_ACCOUNT',
  BANKACCOUNT: 'BANK_ACCOUNT',
  ACCOUNT_NUMBER: 'BANK_ACCOUNT',
  ACCOUNTNUMBER: 'BANK_ACCOUNT',
  BANK_ACCOUNT_NUMBER: 'BANK_ACCOUNT',

  EMAIL: 'EMAIL',
  EMAIL_ADDRESS: 'EMAIL',
  MAIL: 'EMAIL',

  PHONE: 'PHONE',
  PHONE_NUMBER: 'PHONE',
  PHONENUMBER: 'PHONE',
  TELEPHONE: 'PHONE',
  MOBILE: 'PHONE',

  CREDIT_CARD: 'CREDIT_CARD',
  CREDITCARD: 'CREDIT_CARD',
  CREDIT_CARD_NUMBER: 'CREDIT_CARD',
  CREDITCARDNUMBER: 'CREDIT_CARD',

  SSN: 'SSN',
  SOCIAL_SECURITY_NUMBER: 'SSN',
  SOCIALSECURITYNUMBER: 'SSN',

  IBAN: 'IBAN',
  IBAN_CODE: 'IBAN',

  IP: 'IP_ADDRESS',
  IP_ADDRESS: 'IP_ADDRESS',
  IPV4: 'IP_ADDRESS',
  IPV6: 'IP_ADDRESS',

  DATE: 'DATE',
  DOB: 'DATE',
  DATE_OF_BIRTH: 'DATE',
  BIRTHDATE: 'DATE',

  MISC: 'MISC',
  PASSPORT: 'MISC',
  PASSPORT_NUMBER: 'MISC',
  DRIVER_LICENSE: 'MISC',
  DRIVERS_LICENSE: 'MISC',
  NATIONAL_ID: 'MISC',
  ID_CARD: 'MISC',
};

const BARDSAI_LABEL_MAP: Readonly<Record<string, EntityType>> = {
  ACCOUNT_IDENTIFIER: 'USERNAME',
  AUTH_SECRET: 'PASSWORD',
  BANK_ACCOUNT_IDENTIFIER: 'BANK_ACCOUNT',
  BIOMETRIC_DATA: 'MISC',
  CONTACT_HANDLE: 'USERNAME',
  CRIMINAL_OFFENCE_DATA: 'MISC',
  DATE_OF_BIRTH: 'DATE',
  DEVICE_IDENTIFIER: 'MISC',
  DOCUMENT_IDENTIFIER: 'MISC',
  DOCUMENT_REFERENCE: 'MISC',
  EMAIL_ADDRESS: 'EMAIL',
  ETHNIC_ORIGIN: 'MISC',
  FINANCIAL_AMOUNT: 'MISC',
  GEO_LOCATION: 'LOCATION',
  HEALTH_DATA: 'MISC',
  IDENTIFYING_LINK: 'URL',
  IP_ADDRESS: 'IP_ADDRESS',
  LOCATION: 'LOCATION',
  ORGANIZATION_IDENTIFIER: 'ORGANIZATION',
  ORGANIZATION_NAME: 'ORGANIZATION',
  PAYMENT_CARD: 'CREDIT_CARD',
  PAYMENT_CARD_SECURITY: 'CREDIT_CARD',
  PERSON_ALIAS: 'PERSON',
  PERSON_ATTRIBUTE: 'MISC',
  PERSON_IDENTIFIER: 'MISC',
  PERSON_NAME: 'PERSON',
  PERSON_ROLE_OR_TITLE: 'MISC',
  PHONE_NUMBER: 'PHONE',
  POLITICAL_OPINION: 'MISC',
  POSTAL_ADDRESS: 'ADDRESS',
  PROPER_NAME: 'MISC',
  RELIGION_OR_BELIEF: 'MISC',
  SEXUAL_ORIENTATION: 'MISC',
  TRADE_UNION_MEMBERSHIP: 'MISC',
  VEHICLE_IDENTIFIER: 'MISC',
};

const HIKMAAI_LABEL_MAP: Readonly<Record<string, EntityType>> = {
  GIVENNAME: 'PERSON',
  SURNAME: 'PERSON',
  DATEOFBIRTH: 'DATE',
  USERNAME: 'USERNAME',
  PASSWORD: 'PASSWORD',
  EMAIL: 'EMAIL',
  TELEPHONENUM: 'PHONE',
  STREET: 'ADDRESS',
  BUILDINGNUM: 'ADDRESS',
  ZIPCODE: 'ADDRESS',
  CITY: 'LOCATION',
  CREDITCARDNUMBER: 'CREDIT_CARD',
  ACCOUNTNUM: 'BANK_ACCOUNT',
  SOCIALNUM: 'SSN',
  TAXNUM: 'MISC',
  DRIVERLICENSENUM: 'MISC',
  IDCARDNUM: 'MISC',
};

const FIXTURE_ENTITIES: readonly FixtureEntity[] = [
  { text: 'Ada Lovelace', entityType: 'PERSON', score: 0.92 },
  { text: 'David Smith', entityType: 'PERSON', score: 0.92 },
  { text: 'Anna Müller', entityType: 'PERSON', score: 0.92 },
  { text: 'Acme Corp', entityType: 'ORGANIZATION', score: 0.90 },
  { text: 'Beispiel GmbH', entityType: 'ORGANIZATION', score: 0.90 },
  { text: 'Berlin', entityType: 'LOCATION', score: 0.88 },
  { text: 'München', entityType: 'LOCATION', score: 0.88 },
  { text: '42 Cedar St', entityType: 'ADDRESS', score: 0.91 },
  { text: 'https://portal.example/private', entityType: 'URL', score: 0.94 },
  { text: 'alice_admin', entityType: 'USERNAME', score: 0.89 },
  { text: 'correct-horse', entityType: 'PASSWORD', score: 0.87 },
  { text: '1234567890', entityType: 'BANK_ACCOUNT', score: 0.86 },
];

// Keyed by model AND WebGPU dtype preference: a provider pins its pipeline
// (and thus its ONNX artifact) on first detect, so switching the preference
// must produce a fresh provider instead of reusing a stale pipeline.
let cachedTransformersProviders = new Map<string, NerProvider>();

function chunkBoundaryEnd(text: string, start: number, targetEnd: number, maxChunkChars: number): number {
  if (targetEnd >= text.length) return text.length;

  const minEnd = Math.min(targetEnd, start + Math.max(1, Math.floor(maxChunkChars * 0.6)));
  for (let index = targetEnd; index > minEnd; index -= 1) {
    if (/\s/.test(text.charAt(index - 1))) {
      return index;
    }
  }

  return targetEnd;
}

export function chunkTextForNer(
  text: string,
  options: NerChunkingOptions = {}
): NerTextChunk[] {
  if (text.length === 0) return [];

  const maxChunkChars = options.maxChunkChars ?? MAX_TEXT_LENGTH;
  const overlapChars = options.overlapChars ?? DEFAULT_NER_CHUNK_OVERLAP_CHARS;
  if (maxChunkChars < 1) {
    throw new Error('NER maxChunkChars must be at least 1.');
  }
  if (overlapChars < 0) {
    throw new Error('NER overlapChars must be non-negative.');
  }

  const boundedOverlap = Math.min(overlapChars, Math.max(0, maxChunkChars - 1));
  const chunks: NerTextChunk[] = [];
  let startChar = 0;

  while (startChar < text.length) {
    const targetEnd = Math.min(text.length, startChar + maxChunkChars);
    const endChar = chunkBoundaryEnd(text, startChar, targetEnd, maxChunkChars);
    const startByte = byteLength(text.slice(0, startChar));
    const endByte = byteLength(text.slice(0, endChar));
    chunks.push({
      text: text.slice(startChar, endChar),
      startChar,
      endChar,
      startByte,
      endByte,
    });

    if (endChar >= text.length) break;
    startChar = Math.max(startChar + 1, endChar - boundedOverlap);
  }

  return chunks;
}

export interface NerTokenChunkingOptions {
  maxTokens?: number;
  overlapTokens?: number;
}

/** Below this share of placed tokens, fall back to the legacy search. */
export const MIN_ALIGNMENT_COVERAGE = 0.8;

/** Positions reserved for '<s>' / '</s>' (or '[CLS]' / '[SEP]'). */
const SPECIAL_TOKEN_BUDGET = 2;

function safeTokenize(tokenizer: NerTokenizerLike, text: string): string[] | null {
  try {
    return tokenizer.tokenize(text, { add_special_tokens: true });
  } catch (err) {
    debugLog('[PG:ner] tokenize failed', err);
    return null;
  }
}

function tokenLimitFor(tokenizer: NerTokenizerLike): number {
  const modelMax = tokenizer.model_max_length;
  if (typeof modelMax !== 'number' || !Number.isFinite(modelMax) || modelMax <= SPECIAL_TOKEN_BUDGET) {
    return DEFAULT_NER_MAX_TOKENS_PER_CHUNK;
  }

  return Math.min(DEFAULT_NER_MAX_TOKENS_PER_CHUNK, modelMax - SPECIAL_TOKEN_BUDGET);
}

/**
 * Split text on token boundaries so no chunk exceeds the encoder's position limit.
 * Boundaries come from the aligner, so no chunk cuts a word and no character is
 * dropped between them.
 */
/** 'index' may itself be unplaced, so scan forward for the first placed token. */
function chunkStartChar(ranges: readonly (TokenCharRange | null)[], index: number): number {
  for (let i = index; i < ranges.length; i += 1) {
    const range = ranges[i];
    if (range) return range.start;
  }
  return 0;
}

/**
 * The boundary must sit on a placed token. Taking the last one at or before the
 * budget keeps the chunk within it; only an unplaced run filling the whole window
 * makes us step past, which costs a few positions but drops no characters.
 */
function chunkBoundaryIndex(
  ranges: readonly (TokenCharRange | null)[],
  tokenStart: number,
  tokenEnd: number
): number {
  for (let i = Math.min(tokenEnd, ranges.length - 1); i > tokenStart; i -= 1) {
    if (ranges[i]) return i;
  }
  for (let i = tokenEnd + 1; i < ranges.length; i += 1) {
    if (ranges[i]) return i;
  }
  return ranges.length;
}

export function chunkTextByTokens(
  text: string,
  tokenizer: NerTokenizerLike,
  options: NerTokenChunkingOptions = {}
): NerTextChunk[] | null {
  if (text.length === 0) return [];

  const maxTokens = options.maxTokens ?? DEFAULT_NER_MAX_TOKENS_PER_CHUNK;
  const overlapTokens = Math.min(options.overlapTokens ?? DEFAULT_NER_CHUNK_OVERLAP_TOKENS, maxTokens - 1);
  if (maxTokens < 1) throw new Error('NER maxTokens must be at least 1.');
  if (overlapTokens < 0) throw new Error('NER overlapTokens must be non-negative.');

  let pieces: string[];
  try {
    pieces = tokenizer.tokenize(text, { add_special_tokens: false });
  } catch {
    return null;
  }

  const ranges = alignTokensToText(text, pieces);
  if (!ranges.some((range) => range !== null)) return null;

  if (alignmentCoverage(ranges, pieces) < MIN_ALIGNMENT_COVERAGE) return null;
  if (pieces.length <= maxTokens) {
    return [
      {
        text,
        startChar: 0,
        endChar: text.length,
        startByte: 0,
        endByte: byteLength(text),
      },
    ];
  }

  const chunks: NerTextChunk[] = [];
  let tokenStart = 0;

  // Budget in every piece, not just placed ones: an unplaced piece still occupies
  // an encoder position, so counting only placed ones lets a chunk overrun.
  while (tokenStart < pieces.length) {
    const tokenEnd = Math.min(pieces.length, tokenStart + maxTokens);
    // Close on the *next* chunk's first token: characters between tokens have no
    // boundary of their own and would otherwise land in no chunk at all.
    const boundary = tokenEnd >= pieces.length ? pieces.length : chunkBoundaryIndex(ranges, tokenStart, tokenEnd);
    const startChar = tokenStart === 0 ? 0 : chunkStartChar(ranges, tokenStart);
    const endChar = boundary >= pieces.length ? text.length : ranges[boundary]!.start;

    chunks.push({
      text: text.slice(startChar, endChar),
      startChar,
      endChar,
      startByte: byteLength(text.slice(0, startChar)),
      endByte: byteLength(text.slice(0, endChar)),
    });

    if (boundary >= pieces.length) break;
    tokenStart = Math.max(tokenStart + 1, boundary - overlapTokens);
  }

  return chunks;
}

function shiftSpanToOriginalText(span: PiiSpan, chunk: NerTextChunk): PiiSpan {
  return {
    ...span,
    start: span.start + chunk.startByte,
    end: span.end + chunk.startByte,
  };
}

function spansOverlap(a: PiiSpan, b: PiiSpan): boolean {
  return a.start < b.end && b.start < a.end;
}

function betterNerSpan(a: PiiSpan, b: PiiSpan): PiiSpan {
  if (b.score !== a.score) return b.score > a.score ? b : a;

  const aLength = a.end - a.start;
  const bLength = b.end - b.start;
  if (bLength !== aLength) return bLength > aLength ? b : a;

  if (b.start !== a.start) return b.start < a.start ? b : a;
  return b.end < a.end ? b : a;
}

export function mergeOverlappingNerSpans(spans: PiiSpan[]): PiiSpan[] {
  const spansByType = new Map<EntityType, PiiSpan[]>();

  for (const span of spans) {
    const byType = spansByType.get(span.entity_type) ?? [];
    byType.push(span);
    spansByType.set(span.entity_type, byType);
  }

  const merged: PiiSpan[] = [];
  for (const byType of spansByType.values()) {
    const sorted = [...byType].sort((a, b) => a.start - b.start || a.end - b.end);
    let current: PiiSpan | null = null;

    for (const span of sorted) {
      if (!current) {
        current = span;
        continue;
      }

      if (spansOverlap(current, span)) {
        current = betterNerSpan(current, span);
        continue;
      }

      merged.push(current);
      current = span;
    }

    if (current) merged.push(current);
  }

  return merged.sort((a, b) => a.start - b.start || a.end - b.end);
}

function fixtureSpan(originalText: string, fixture: FixtureEntity, startIndex: number): PiiSpan {
  const start = byteLength(originalText.slice(0, startIndex));
  const end = start + byteLength(fixture.text);
  return {
    start,
    end,
    entity_type: fixture.entityType,
    score: fixture.score,
    text: fixture.text,
    source: 'ner',
  };
}

export function createFixtureNerProvider(): NerProvider {
  return {
    mode: 'fixture',
    async detect(text: string, signal?: AbortSignal): Promise<PiiSpan[]> {
      throwIfAborted(signal);
      const spans: PiiSpan[] = [];

      for (const fixture of FIXTURE_ENTITIES) {
        throwIfAborted(signal);
        let searchFrom = 0;
        while (searchFrom < text.length) {
          throwIfAborted(signal);
          const startIndex = text.indexOf(fixture.text, searchFrom);
          if (startIndex === -1) break;

          spans.push(fixtureSpan(text, fixture, startIndex));
          searchFrom = startIndex + fixture.text.length;
        }
      }

      return spans.sort((a, b) => a.start - b.start);
    },
  };
}

function defaultExtensionUrl(path: string): string {
  return chrome.runtime.getURL(path);
}

async function defaultAssetExists(url: string): Promise<boolean> {
  if (!/^https?:|^chrome-extension:|^moz-extension:/i.test(url)) {
    try {
      const requireFn = eval('require') as NodeRequire;
      const fs = requireFn('fs') as typeof import('fs');
      return fs.existsSync(url) && fs.statSync(url).isFile();
    } catch {
      return false;
    }
  }

  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

async function defaultLoadTransformers(): Promise<TransformersModule> {
  return import(
    /* webpackMode: "eager" */ '@huggingface/transformers'
  ) as Promise<TransformersModule>;
}

async function probeCurrentWebGpu(): Promise<boolean> {
  const gpu = (globalThis.navigator as NavigatorWithWebGpu | undefined)?.gpu;
  if (!gpu) return false;
  if (typeof gpu.requestAdapter !== 'function') return true;

  try {
    return Boolean(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

export async function defaultDetectWebGpu(): Promise<boolean> {
  try {
    const systemCheck = await loadSystemCheckResult();
    if (systemCheck?.webGpu === 'available') return true;
  } catch {
    // Fall through to a current runtime probe. The stored check can be absent,
    // stale, or temporarily unreadable, but the backend choice needs to match
    // the browser session that is loading the model.
  }

  return probeCurrentWebGpu();
}

async function assertRequiredAssetsAvailable(
  requiredModelAssets: readonly string[],
  getExtensionUrl: (path: string) => string,
  assetExists: (url: string) => Promise<boolean>
): Promise<void> {
  const missing: string[] = [];
  const present: string[] = [];

  for (const path of [...requiredModelAssets, ...REQUIRED_RUNTIME_ASSETS]) {
    const url = getExtensionUrl(path);
    if (await assetExists(url)) {
      present.push(path);
    } else {
      missing.push(path);
    }
  }

  debugLog('[PG:ner] asset check', {
    presentCount: present.length,
    missingCount: missing.length,
    missing,
  });

  if (missing.length > 0) {
    throw new NerProviderUnavailableError(
      `Missing transformer NER assets: ${missing.join(', ')}`
    );
  }
}

function configureTransformersEnvironment(
  transformers: TransformersModule,
  getExtensionUrl: (path: string) => string,
  device: NerInferenceDevice = 'wasm'
): void {
  transformers.env.allowRemoteModels = false;
  transformers.env.allowLocalModels = true;
  transformers.env.localModelPath = getExtensionUrl(MODEL_ASSET_ROOT);
  transformers.env.useBrowserCache = false;
  transformers.env.useFSCache = false;
  // Skip Transformers.js's blob-URL wasm caching — extension CSP forbids
  // executing scripts from blob: URLs.
  transformers.env.useWasmCache = false;

  // Mutate the existing onnx.wasm object in place. Transformers.js exposes
  // env.backends.onnx as a shallow spread of ONNX's env, so its `wasm`
  // property is the same reference ORT actually reads. Replacing the
  // property would only update the spread copy and ORT would keep the CDN
  // defaults set at import time.
  const wasmEnv = transformers.env.backends.onnx.wasm;
  if (!wasmEnv) {
    throw new NerProviderUnavailableError(
      'Transformers.js did not expose an onnx.wasm environment to configure.'
    );
  }
  const runtimeRoot = getExtensionUrl(ONNX_RUNTIME_ASSET_ROOT);
  // The asyncify build is the one that exports `webgpuInit` and that
  // ort.webgpu.bundle.min.mjs (bundled in transformers.js v4) references —
  // it is required for the WebGPU EP. The non-asyncify build has the
  // known-good CPU behavior; the asyncify variant previously produced
  // silently degraded logits there.
  // So pick per device.
  const wasmFile =
    device === 'webgpu'
      ? 'ort-wasm-simd-threaded.asyncify'
      : 'ort-wasm-simd-threaded';
  wasmEnv.wasmPaths = {
    mjs: `${runtimeRoot}${wasmFile}.mjs`,
    wasm: `${runtimeRoot}${wasmFile}.wasm`,
  };
  // Extension pages do not have cross-origin isolation, so SharedArrayBuffer
  // is unavailable. Force single-threaded execution to avoid ORT trying to
  // spin up worker threads that would fail to load.
  wasmEnv.numThreads = 1;
  wasmEnv.proxy = false;

  debugLog('[PG:ner] transformers env configured', {
    localModelPath: transformers.env.localModelPath,
    wasmPaths: wasmEnv.wasmPaths,
    numThreads: wasmEnv.numThreads,
    allowRemoteModels: transformers.env.allowRemoteModels,
    allowLocalModels: transformers.env.allowLocalModels,
  });
}

export function dtypeForDevice(
  model: NerModelDefinition,
  device: NerInferenceDevice,
  webGpuDtypePreference?: NerWebGpuDtype
): NerDtype {
  if (device !== 'webgpu') return model.wasmDtype ?? 'q8';
  return webGpuDtypePreference ?? model.webGpuDtype ?? 'q8';
}

export function requiredAssetsForDtype(model: NerModelDefinition, dtype: NerDtype): readonly string[] {
  const artifact = model.webGpuArtifacts?.[dtype];
  if (artifact) {
    return artifact.requiredAssets;
  }
  if (dtype === 'q8') {
    return model.requiredAssets;
  }
  // Dtype without a curated artifact (benchmark override): derive the model
  // file from the dtype suffix and reuse the tokenizer/config assets. No
  // external data — these artifacts ship their weights embedded in the
  // protobuf.
  const jsonAssets = model.requiredAssets.filter((asset) => asset.endsWith('.json'));
  return [...jsonAssets, `${model.assetBasePath}/onnx/model${NER_DTYPE_FILE_SUFFIX[dtype]}.onnx`];
}

function externalDataForDtype(
  model: NerModelDefinition,
  dtype: NerDtype
): readonly NerExternalDataAsset[] | undefined {
  return model.webGpuArtifacts?.[dtype]?.externalData;
}

function normalizeLabel(label: string | undefined): string {
  return (label ?? '')
    .replace(/^[BI]-/i, '')
    .replace(/^\[|\]$/g, '')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

export function mapAi4PrivacyLabelToEntityType(label: string | undefined): EntityType | null {
  return AI4PRIVACY_LABEL_MAP[normalizeLabel(label)] ?? null;
}

export function mapBardsAiLabelToEntityType(label: string | undefined): EntityType | null {
  return BARDSAI_LABEL_MAP[normalizeLabel(label)] ?? null;
}

export function mapHikmaAiLabelToEntityType(label: string | undefined): EntityType | null {
  return HIKMAAI_LABEL_MAP[normalizeLabel(label)] ?? null;
}

function mapTransformerLabelToEntityType(
  label: string | undefined,
  modelKey: NerModelKey
): EntityType | null {
  if (modelKey === 'bardsai') {
    return mapBardsAiLabelToEntityType(label);
  }
  if (modelKey === 'hikmaai') {
    return mapHikmaAiLabelToEntityType(label);
  }
  return mapAi4PrivacyLabelToEntityType(label);
}

export function nerThresholdForEntityType(
  entityType: EntityType,
  modelKey: NerModelKey = DEFAULT_NER_MODEL
): number {
  return NER_THRESHOLDS_BY_MODEL[modelKey][entityType];
}

export function passesNerThreshold(
  span: Pick<PiiSpan, 'entity_type' | 'score'>,
  modelKey: NerModelKey = DEFAULT_NER_MODEL
): boolean {
  return span.score >= nerThresholdForEntityType(span.entity_type, modelKey);
}

export function applyNerThresholdPolicy(
  spans: PiiSpan[],
  modelKey: NerModelKey = DEFAULT_NER_MODEL
): PiiSpan[] {
  return spans.filter((span) => passesNerThreshold(span, modelKey));
}

function fallbackCharacterRange(
  text: string,
  item: TokenClassificationItem,
  searchFrom: number
): { start: number; end: number } | null {
  if (typeof item.start === 'number' && typeof item.end === 'number') {
    return { start: item.start, end: item.end };
  }

  const words = normalizedSearchWords(item.word);

  // Transformers.js does not emit char offsets for token-classification, and
  // uncased models (e.g., distilbert-base-uncased) return lowercased words.
  // Recover the original-text range with a case-insensitive search.
  for (const word of words) {
    const start = text.toLowerCase().indexOf(word.toLowerCase(), searchFrom);
    if (start !== -1) return { start, end: start + word.length };
  }

  return null;
}

function normalizedSearchWords(rawWord: string): string[] {
  const trimmed = rawWord.replace(/^##/, '').trim();
  if (!trimmed) return [];

  const compactPunctuation = trimmed.replace(/\s*([_@:/.-])\s*/g, '$1');
  const compactAllSpaces = trimmed.replace(/\s+/g, '');
  const normalizedWhitespace = trimmed.replace(/\s+/g, ' ');

  return Array.from(
    new Set([trimmed, compactPunctuation, compactAllSpaces, normalizedWhitespace])
  ).filter(Boolean);
}

function transformerItemToSpan(
  text: string,
  item: TokenClassificationItem,
  searchFrom: number,
  modelKey: NerModelKey
): { span: PiiSpan; nextSearchFrom: number } | null {
  const rawLabel = item.entity_group ?? item.entity;
  const entityType = mapTransformerLabelToEntityType(rawLabel, modelKey);
  if (!entityType) return null;

  const range = fallbackCharacterRange(text, item, searchFrom);
  if (!range || range.start >= range.end) return null;

  const start = byteLength(text.slice(0, range.start));
  const end = byteLength(text.slice(0, range.end));
  return {
    span: {
      start,
      end,
      entity_type: entityType,
      score: item.score,
      text: text.slice(range.start, range.end),
      source: 'ner',
      ...(rawLabel ? { nerRawLabel: rawLabel } : {}),
    },
    nextSearchFrom: range.end,
  };
}

function canMergeAdjacentNerFragments(text: string, previous: PiiSpan, next: PiiSpan): boolean {
  if (previous.entity_type !== next.entity_type || previous.end > next.start) return false;

  const gap = sliceTextByByteOffsets(text, previous.end, next.start);
  return gap.length <= 4 && /^[\s._@:/+\-(),]*$/.test(gap);
}

function mergeAdjacentNerFragments(text: string, spans: PiiSpan[]): PiiSpan[] {
  const merged: PiiSpan[] = [];

  for (const span of spans) {
    const previous = merged[merged.length - 1];
    if (!previous || !canMergeAdjacentNerFragments(text, previous, span)) {
      merged.push(span);
      continue;
    }

    previous.end = span.end;
    previous.score = Math.max(previous.score, span.score);
    previous.text = sliceTextByByteOffsets(text, previous.start, previous.end);
  }

  return merged;
}

function isTokenCharacter(char: string): boolean {
  return /^[\p{L}\p{N}_-]$/u.test(char);
}

function expandSpanToTokenBoundaries(text: string, span: PiiSpan): PiiSpan {
  const originalStart = byteOffsetToStringIndex(text, span.start);
  const originalEnd = byteOffsetToStringIndex(text, span.end);
  let startChar = originalStart;
  let endChar = originalEnd;

  while (startChar > 0 && isTokenCharacter(text.charAt(startChar - 1))) {
    startChar -= 1;
  }
  while (endChar < text.length && isTokenCharacter(text.charAt(endChar))) {
    endChar += 1;
  }

  if (startChar === originalStart && endChar === originalEnd) {
    return span;
  }

  return {
    ...span,
    start: stringIndexToByteOffset(text, startChar),
    end: stringIndexToByteOffset(text, endChar),
    text: text.slice(startChar, endChar),
  };
}

/** A comma, bracket, line break or real word between two fragments ends the entity. */
const JOINABLE_GAP_PATTERN = /^[ \t._@:/+-]*$/;
const MAX_JOINABLE_GAP_CHARS = 3;

function isJoinableGap(gap: string): boolean {
  return gap.length <= MAX_JOINABLE_GAP_CHARS && JOINABLE_GAP_PATTERN.test(gap);
}

function isWordCharacter(char: string): boolean {
  return /^[\p{L}\p{N}_]$/u.test(char);
}

function completePartialWord(text: string, range: TokenCharRange): TokenCharRange {
  let { start, end } = range;

  while (start > 0 && isWordCharacter(text.charAt(start)) && isWordCharacter(text.charAt(start - 1))) {
    start -= 1;
  }
  while (end < text.length && isWordCharacter(text.charAt(end - 1)) && isWordCharacter(text.charAt(end))) {
    end += 1;
  }

  return { start, end };
}

interface AlignedTokenPrediction {
  entityType: EntityType;
  rawLabel: string;
  score: number;
  range: TokenCharRange;
}

const EMAIL_DOMAIN_TAIL_TYPES: ReadonlySet<EntityType> = new Set<EntityType>([
  'ORGANIZATION',
  'URL',
  'LOCATION',
  'MISC',
]);

const MAX_INTRA_RUN_GAP_CHARS = 16;

/** Excludes every separator, so a bridge cannot reach across two values. */
const INTRA_RUN_BRIDGE_PATTERN = /^[\p{L}\p{N}_.\-+@]*$/u;

function isBridgeableGap(bridge: string): boolean {
  return bridge.length <= MAX_INTRA_RUN_GAP_CHARS && INTRA_RUN_BRIDGE_PATTERN.test(bridge);
}

const INTRA_RUN_LOOKBACK_SPANS = 3;

/**
 * Rejoin same-type spans that a mislabelled slice split apart mid-identifier.
 *
 * When that middle falls under its own threshold, both ends are redacted and
 * 'tester' of 't.tester@example.invalid' is left in the clear.
 */
function closeIntraRunGaps(text: string, spans: PiiSpan[]): PiiSpan[] {
  const out: PiiSpan[] = [];

  for (const span of spans) {
    let mergedInto = -1;

    for (let i = out.length - 1; i >= 0 && i >= out.length - INTRA_RUN_LOOKBACK_SPANS; i -= 1) {
      const candidate = out[i];
      if (candidate.entity_type !== span.entity_type || candidate.end > span.start) continue;

      // An empty bridge counts: the two halves can end up flush.
      if (!isBridgeableGap(sliceTextByByteOffsets(text, candidate.end, span.start))) continue;

      candidate.end = span.end;
      candidate.text = sliceTextByByteOffsets(text, candidate.start, candidate.end);
      mergedInto = i;
      break;
    }

    if (mergedInto === -1) {
      out.push(span);
      continue;
    }

    const absorber = out[mergedInto];
    out.splice(
      mergedInto + 1,
      out.length - mergedInto - 1,
      ...out.slice(mergedInto + 1).filter((other) => other.end > absorber.end)
    );
  }

  return out;
}

function stitchEmailDomains(text: string, spans: PiiSpan[]): PiiSpan[] {
  const stitched: PiiSpan[] = [];

  for (const span of spans) {
    const previous = stitched[stitched.length - 1];
    if (
      previous &&
      previous.entity_type === 'EMAIL' &&
      EMAIL_DOMAIN_TAIL_TYPES.has(span.entity_type) &&
      previous.end <= span.start
    ) {
      const gap = sliceTextByByteOffsets(text, previous.end, span.start);
      const joinsAddress = gap === '@' || (gap === '' && previous.text.endsWith('@'));
      if (joinsAddress) {
        previous.end = span.end;
        previous.text = sliceTextByByteOffsets(text, previous.start, previous.end);
        continue;
      }
    }

    stitched.push(span);
  }

  return stitched;
}

/**
 * Build spans from raw per-token predictions using real character offsets.
 *
 * 'ranges' must be the aligner's output for the tokenizer call the model saw, so
 * 'item.index' addresses it directly. Grouping is by entity type and source
 * adjacency, not the model's BIO prefixes.
 *
 * A group scores from its opening token ('first' strategy): confidence decays across
 * continuation pieces -- 'firstName.lastName@' scores [0.999, 0.999, 0.473, 0.670,
 * 0.586, 0.631] -- so averaging would drop a genuine address under the email gate.
 */
export function alignedTokensToSpans(
  text: string,
  output: readonly TokenClassificationItem[],
  ranges: readonly (TokenCharRange | null)[],
  modelKey: NerModelKey = DEFAULT_NER_MODEL
): PiiSpan[] {
  const predictions: AlignedTokenPrediction[] = [];

  for (const item of output) {
    if (typeof item.index !== 'number') continue;

    const rawLabel = item.entity_group ?? item.entity;
    const entityType = mapTransformerLabelToEntityType(rawLabel, modelKey);
    if (!entityType || !rawLabel) continue;

    const range = ranges[item.index];
    if (!range || range.start >= range.end) continue;

    predictions.push({ entityType, rawLabel, score: item.score, range });
  }

  predictions.sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end);

  const grouped: PiiSpan[] = [];
  let current: { prediction: AlignedTokenPrediction; end: number } | null = null;

  const flush = (): void => {
    if (!current) return;
    const range = completePartialWord(text, {
      start: current.prediction.range.start,
      end: current.end,
    });
    grouped.push({
      start: stringIndexToByteOffset(text, range.start),
      end: stringIndexToByteOffset(text, range.end),
      entity_type: current.prediction.entityType,
      score: current.prediction.score,
      text: text.slice(range.start, range.end),
      source: 'ner',
      nerRawLabel: current.prediction.rawLabel,
    });
    current = null;
  };

  for (const prediction of predictions) {
    if (!current) {
      current = { prediction, end: prediction.range.end };
      continue;
    }

    const sameType = current.prediction.entityType === prediction.entityType;
    const gap = prediction.range.start >= current.end
      ? text.slice(current.end, prediction.range.start)
      : '';

    if (sameType && prediction.range.start >= current.prediction.range.start && isJoinableGap(gap)) {
      current.end = Math.max(current.end, prediction.range.end);
      continue;
    }

    flush();
    current = { prediction, end: prediction.range.end };
  }
  flush();

  return stitchEmailDomains(text, closeIntraRunGaps(text, grouped));
}

export function transformerOutputToSpans(
  text: string,
  output: TokenClassificationItem[],
  modelKey: NerModelKey = DEFAULT_NER_MODEL
): PiiSpan[] {
  const spans: PiiSpan[] = [];
  let searchFrom = 0;

  for (const item of output) {
    const converted = transformerItemToSpan(text, item, searchFrom, modelKey);
    if (!converted) continue;

    spans.push(converted.span);
    searchFrom = converted.nextSearchFrom;
  }

  const sorted = spans.sort((a, b) => a.start - b.start);
  return mergeAdjacentNerFragments(text, sorted).map((span) =>
    expandSpanToTokenBoundaries(text, span)
  );
}

export function createTransformersNerProvider(
  options: TransformersProviderOptions = {}
): NerProvider {
  const model = nerModelDefinitionFor(options.modelKey ?? DEFAULT_NER_MODEL);
  const loadTransformers = options.loadTransformers ?? defaultLoadTransformers;
  const getExtensionUrl = options.getExtensionUrl ?? defaultExtensionUrl;
  const assetExists = options.assetExists ?? defaultAssetExists;
  const detectWebGpu = options.detectWebGpu ?? defaultDetectWebGpu;
  const chunking = options.chunking;
  let pipelinePromise: Promise<TokenClassificationPipeline> | null = null;
  let pipelineReady = false;
  let lastLoadMs: number | undefined;
  let lastTiming: NerTimingInfo | undefined;
  let selectedDevice: NerInferenceDevice | undefined;

  async function buildPipeline(
    transformers: TransformersModule,
    device: NerInferenceDevice,
    dtype: NerDtype
  ): Promise<TokenClassificationPipeline> {
    // Browser builds need external-data sidecars fetched and attached for any
    // device. In Node, Transformers.js keeps string paths when possible so the
    // benchmark harness can still let ONNX Runtime resolve local sidecars.
    const externalData = externalDataForDtype(model, dtype);
    return transformers.pipeline('token-classification', model.modelId, {
      dtype,
      local_files_only: true,
      device,
      ...(externalData && externalData.length > 0
        ? { session_options: { externalData: [...externalData] } }
        : {}),
    });
  }

  async function ensurePipeline(): Promise<TokenClassificationPipeline> {
    pipelinePromise ??= (async () => {
      const startedAt = performance.now();
      try {
        const webgpuAvailable = await detectWebGpu();
        const device: NerInferenceDevice =
          options.deviceOverride ?? (webgpuAvailable ? 'webgpu' : 'wasm');
        const dtype =
          options.dtypeOverride ?? dtypeForDevice(model, device, options.webGpuDtypePreference);
        selectedDevice = device;
        await assertRequiredAssetsAvailable(
          requiredAssetsForDtype(model, dtype),
          getExtensionUrl,
          assetExists
        );
        debugLog('[PG:ner] pipeline init: assets ok, loading transformers module');
        const transformers = await loadTransformers();
        debugLog('[PG:ner] pipeline init: transformers loaded, detecting backend');

        // wasmPaths must be set before the wasm module loads, and the WebGPU
        // and CPU paths require different wasm builds (only asyncify exports
        // webgpuInit). Pick once based on detection — runtime fallback is
        // unsafe because the wasm module is cached after first instantiation.
        configureTransformersEnvironment(transformers, getExtensionUrl, device);
        debugLog('[PG:ner] pipeline init: building token-classification pipeline', {
          model: model.modelId,
          device,
          dtype,
          webgpuAvailable,
        });

        const classifier = await buildPipeline(transformers, device, dtype);

        if (device === 'webgpu') {
          // Compile shaders eagerly so the first paste-time inference doesn't
          // pay the 1–3s WGSL compile cost. Failure here is non-fatal — log
          // and continue; the next real call will retry compilation.
          try {
            const warmupStartedAt = performance.now();
            await classifier('warmup', { aggregation_strategy: 'simple' });
            console.log('[PG:ner] webgpu warmup complete', {
              warmupMs: Math.round(performance.now() - warmupStartedAt),
            });
          } catch (err) {
            console.warn('[PG:ner] webgpu warmup failed', err);
          }
        }

        lastLoadMs = Math.round(performance.now() - startedAt);
        pipelineReady = true;
        console.log('[PG:ner] pipeline ready', { model: model.key, device, loadMs: lastLoadMs });
        return classifier;
      } catch (err) {
        console.error('[PG:ner] pipeline init failed', err);
        throw err;
      }
    })();

    return pipelinePromise;
  }

  function planChunks(text: string, tokenizer: NerTokenizerLike | undefined): NerTextChunk[] {
    if (tokenizer) {
      const tokenChunks = chunkTextByTokens(text, tokenizer, {
        maxTokens: tokenLimitFor(tokenizer),
      });
      if (tokenChunks) return tokenChunks;
      debugLog('[PG:ner] detect: token chunking unavailable, falling back to characters');
    }

    // No tokenizer to measure with, so cap on characters pessimistically rather
    // than letting a long paste run past the encoder's 512 positions unseen.
    return chunkTextForNer(text, {
      ...chunking,
      maxChunkChars: Math.min(chunking?.maxChunkChars ?? MAX_TEXT_LENGTH, FALLBACK_MAX_CHUNK_CHARS),
    });
  }

  async function detectChunked(
    text: string,
    classifier: TokenClassificationPipeline,
    signal?: AbortSignal
  ): Promise<{ spans: PiiSpan[]; chunkCount: number }> {
    throwIfAborted(signal);
    const tokenizer = classifier.tokenizer;
    const chunks = planChunks(text, tokenizer);
    debugLog('[PG:ner] detect: chunked text', {
      model: model.key,
      textLength: text.length,
      chunkCount: chunks.length,
      chunkedBy: tokenizer ? 'tokens' : 'characters',
    });
    const spans: PiiSpan[] = [];

    for (let i = 0; i < chunks.length; i += 1) {
      throwIfAborted(signal);
      const chunk = chunks[i];

      // Transformers.js leaves 'start'/'end' undefined, and searching for each
      // predicted fragment puts spans on the wrong words (see token-offsets.ts).
      const pieces = tokenizer ? safeTokenize(tokenizer, chunk.text) : null;
      const ranges = pieces ? alignTokensToText(chunk.text, pieces) : null;
      const coverage = ranges && pieces ? alignmentCoverage(ranges, pieces) : 0;
      const useOffsets = ranges !== null && coverage >= MIN_ALIGNMENT_COVERAGE;

      const chunkStartedAt = performance.now();
      const output = await classifier(
        chunk.text,
        useOffsets ? { aggregation_strategy: 'none' } : { aggregation_strategy: 'simple' }
      );
      throwIfAborted(signal);
      const inferenceMs = Math.round(performance.now() - chunkStartedAt);

      const converted = (
        useOffsets
          ? alignedTokensToSpans(chunk.text, output, ranges, model.key)
          : transformerOutputToSpans(chunk.text, output, model.key)
      ).map((span) => shiftSpanToOriginalText(span, chunk));

      debugLog('[PG:ner] detect: chunk inference', {
        chunkIndex: i,
        chunkChars: chunk.text.length,
        tokenCount: pieces?.length,
        offsetMode: useOffsets ? 'aligned' : 'legacy-search',
        alignmentCoverage: Number(coverage.toFixed(3)),
        inferenceMs,
        rawItemCount: output.length,
        convertedSpanCount: converted.length,
      });

      if (!useOffsets) {
        console.warn('[PG:ner] detect: offset alignment unavailable, span positions are approximate', {
          chunkIndex: i,
          hasTokenizer: Boolean(tokenizer),
          alignmentCoverage: Number(coverage.toFixed(3)),
        });
      }

      spans.push(...converted);
    }

    return {
      spans: mergeOverlappingNerSpans(spans),
      chunkCount: chunks.length,
    };
  }

  return {
    mode: 'transformers',
    model: model.key,
    modelLabel: model.label,
    async detect(text: string, signal?: AbortSignal): Promise<PiiSpan[]> {
      throwIfAborted(signal);
      const startedAt = performance.now();
      const wasCold = !pipelineReady;
      debugLog('[PG:ner] detect: invoked', {
        model: model.key,
        textLength: text.length,
        wasCold,
      });
      const classifier = await ensurePipeline();
      throwIfAborted(signal);
      const inferenceStartedAt = performance.now();
      const { spans, chunkCount } = await detectChunked(text, classifier, signal);
      throwIfAborted(signal);
      const inferenceMs = Math.round(performance.now() - inferenceStartedAt);
      const totalMs = Math.round(performance.now() - startedAt);
      lastTiming = {
        totalMs,
        inferenceMs,
        chunkCount,
        textBytes: byteLength(text),
        wasCold,
        ...(wasCold && typeof lastLoadMs === 'number' ? { loadMs: lastLoadMs } : {}),
      };

      const filtered = applyNerThresholdPolicy(spans, model.key);
      // Unconditional diagnostic — first-run users may not have flipped
      // the debug toggle yet. Keep until model behaviour is stable.
      console.log('[PG:ner] detect: complete', {
        model: model.key,
        totalMs,
        inferenceMs,
        chunkCount,
        rawSpanCount: spans.length,
        filteredSpanCount: filtered.length,
        droppedByThreshold: spans.length - filtered.length,
        rawSpans: spans.map((s) => ({
          type: s.entity_type,
          score: Number(s.score.toFixed(3)),
          textLength: s.text.length,
          threshold: nerThresholdForEntityType(s.entity_type, model.key),
          passes: passesNerThreshold(s, model.key),
        })),
      });
      return filtered;
    },
    getLastTiming(): NerTimingInfo | undefined {
      return lastTiming;
    },
    getDevice(): NerInferenceDevice | undefined {
      return selectedDevice;
    },
  };
}

export function createNerProvider(
  mode: NerProviderMode,
  modelKey: NerModelKey = DEFAULT_NER_MODEL,
  webGpuDtypePreference?: NerWebGpuDtype
): NerProvider | null {
  if (mode === 'off') return null;
  if (mode === 'fixture') return createFixtureNerProvider();
  const cacheKey = `${modelKey}:${webGpuDtypePreference ?? 'default'}`;
  const cached = cachedTransformersProviders.get(cacheKey);
  if (cached) return cached;

  const provider = createTransformersNerProvider({ modelKey, webGpuDtypePreference });
  cachedTransformersProviders.set(cacheKey, provider);
  return provider;
}

export function resetNerProviderCachesForTests(): void {
  cachedTransformersProviders = new Map<string, NerProvider>();
}
