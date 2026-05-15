import { ENTITY_TYPES, type EntityType } from '../shared/message-types';

export const BENCHMARK_LANGUAGES = ['en', 'de'] as const;
export type BenchmarkLanguage = (typeof BENCHMARK_LANGUAGES)[number];

export const BENCHMARK_LENGTH_BUCKETS = ['short', 'medium', 'long'] as const;
export type BenchmarkLengthBucket = (typeof BENCHMARK_LENGTH_BUCKETS)[number];

export const BENCHMARK_ENTITY_TYPES = ENTITY_TYPES;
export type BenchmarkEntityType = EntityType;

export interface BenchmarkLengthBucketDefinition {
  id: BenchmarkLengthBucket;
  maxChars: number | null;
}

export interface BenchmarkSourceMetadata {
  name: string;
  url: string;
  datasetId: string;
  revision?: string;
  snapshotPath?: string;
  downloadedAt?: string;
  builtAt?: string;
  exportPath?: string;
}

export interface BenchmarkCurationSummary {
  strategy: string;
  targetExamples?: number;
  negativeTarget?: number;
  miscTarget?: number;
  lengthBuckets?: BenchmarkLengthBucketDefinition[];
  byLanguage?: Partial<Record<BenchmarkLanguage, number>>;
  byLengthBucket?: Partial<Record<BenchmarkLengthBucket, number>>;
  byEntityType?: Partial<Record<BenchmarkEntityType, number>>;
  negativeExamples?: number;
  miscExamples?: number;
}

export interface BenchmarkCorpusMetadata {
  recordType: 'metadata';
  schemaVersion: number;
  corpusId: string;
  description: string;
  createdAt: string;
  source: BenchmarkSourceMetadata;
  spanOffsetUnit: 'utf8-bytes';
  scoring: string;
  curation?: BenchmarkCurationSummary;
}

export interface BenchmarkGoldSpan {
  start: number;
  end: number;
  entity_type: BenchmarkEntityType;
  text: string;
}

export interface BenchmarkSourceProvenance {
  dataset: string;
  recordId: string;
  split: string;
  uid?: string | number;
  region?: string;
  script?: string;
  sourceFile?: string;
  sourceRow: number;
}

export interface BenchmarkExample {
  recordType: 'example';
  id: string;
  language: BenchmarkLanguage;
  lengthBucket: BenchmarkLengthBucket;
  text: string;
  goldSpans: BenchmarkGoldSpan[];
  source: BenchmarkSourceProvenance;
}

export interface BenchmarkCorpus {
  metadata: BenchmarkCorpusMetadata;
  examples: BenchmarkExample[];
}

type JsonRecord = Record<string, unknown>;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const entityTypeSet = new Set<string>(BENCHMARK_ENTITY_TYPES);
const languageSet = new Set<string>(BENCHMARK_LANGUAGES);
const lengthBucketSet = new Set<string>(BENCHMARK_LENGTH_BUCKETS);

export function parseBenchmarkCorpusJsonl(jsonl: string): BenchmarkCorpus {
  const metadataRecords: BenchmarkCorpusMetadata[] = [];
  const examples: BenchmarkExample[] = [];
  const lines = jsonl.split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (line.trim().length === 0) return;

    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch (error) {
      throw corpusError(lineNumber, `Malformed JSONL record: ${(error as Error).message}`);
    }

    const object = requireObject(record, lineNumber, 'record');
    const recordType = requireString(object, 'recordType', lineNumber);
    if (recordType === 'metadata') {
      metadataRecords.push(parseMetadataRecord(object, lineNumber));
      return;
    }
    if (recordType === 'example') {
      examples.push(parseExampleRecord(object, lineNumber));
      return;
    }

    throw corpusError(lineNumber, `Unknown recordType "${recordType}".`);
  });

  if (metadataRecords.length === 0) {
    throw new Error('Benchmark corpus is missing a metadata record.');
  }
  if (metadataRecords.length > 1) {
    throw new Error(`Benchmark corpus must contain exactly one metadata record; found ${metadataRecords.length}.`);
  }
  if (examples.length === 0) {
    throw new Error('Benchmark corpus does not contain any example records.');
  }

  return { metadata: metadataRecords[0], examples };
}

export function lengthBucketForText(text: string): BenchmarkLengthBucket {
  if (text.length <= 120) return 'short';
  if (text.length <= 260) return 'medium';
  return 'long';
}

function parseMetadataRecord(record: JsonRecord, lineNumber: number): BenchmarkCorpusMetadata {
  const schemaVersion = requireNumber(record, 'schemaVersion', lineNumber);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw corpusError(lineNumber, 'metadata.schemaVersion must be a positive integer.');
  }

  const spanOffsetUnit = requireString(record, 'spanOffsetUnit', lineNumber);
  if (spanOffsetUnit !== 'utf8-bytes') {
    throw corpusError(lineNumber, `metadata.spanOffsetUnit must be "utf8-bytes"; found "${spanOffsetUnit}".`);
  }

  return {
    recordType: 'metadata',
    schemaVersion,
    corpusId: requireString(record, 'corpusId', lineNumber),
    description: requireString(record, 'description', lineNumber),
    createdAt: requireString(record, 'createdAt', lineNumber),
    source: parseMetadataSource(requireObjectField(record, 'source', lineNumber), lineNumber),
    spanOffsetUnit,
    scoring: requireString(record, 'scoring', lineNumber),
    curation: parseOptionalCuration(record.curation, lineNumber),
  };
}

function parseMetadataSource(source: JsonRecord, lineNumber: number): BenchmarkSourceMetadata {
  return {
    name: requireString(source, 'name', lineNumber),
    url: requireString(source, 'url', lineNumber),
    datasetId: requireString(source, 'datasetId', lineNumber),
    revision: optionalString(source, 'revision', lineNumber),
    snapshotPath: optionalString(source, 'snapshotPath', lineNumber),
    downloadedAt: optionalString(source, 'downloadedAt', lineNumber),
    builtAt: optionalString(source, 'builtAt', lineNumber),
    exportPath: optionalString(source, 'exportPath', lineNumber),
  };
}

function parseOptionalCuration(value: unknown, lineNumber: number): BenchmarkCurationSummary | undefined {
  if (value === undefined) return undefined;
  const curation = requireObject(value, lineNumber, 'metadata.curation');
  const parsed: BenchmarkCurationSummary = {
    strategy: requireString(curation, 'strategy', lineNumber),
    targetExamples: optionalInteger(curation, 'targetExamples', lineNumber),
    negativeTarget: optionalInteger(curation, 'negativeTarget', lineNumber),
    miscTarget: optionalInteger(curation, 'miscTarget', lineNumber),
    lengthBuckets: parseOptionalLengthBucketDefinitions(curation.lengthBuckets, lineNumber),
    byLanguage: parseOptionalCountMap(curation.byLanguage, languageSet, 'curation.byLanguage', lineNumber),
    byLengthBucket: parseOptionalCountMap(
      curation.byLengthBucket,
      lengthBucketSet,
      'curation.byLengthBucket',
      lineNumber
    ),
    byEntityType: parseOptionalCountMap(
      curation.byEntityType,
      entityTypeSet,
      'curation.byEntityType',
      lineNumber
    ),
    negativeExamples: optionalInteger(curation, 'negativeExamples', lineNumber),
    miscExamples: optionalInteger(curation, 'miscExamples', lineNumber),
  };
  return parsed;
}

function parseExampleRecord(record: JsonRecord, lineNumber: number): BenchmarkExample {
  const language = parseLanguage(requireString(record, 'language', lineNumber), lineNumber);
  const text = requireString(record, 'text', lineNumber);
  const goldSpans = parseGoldSpans(requireArray(record, 'goldSpans', lineNumber), text, lineNumber);

  return {
    recordType: 'example',
    id: requireString(record, 'id', lineNumber),
    language,
    lengthBucket: lengthBucketForText(text),
    text,
    goldSpans,
    source: parseSourceProvenance(requireObjectField(record, 'source', lineNumber), lineNumber),
  };
}

function parseGoldSpans(spans: unknown[], text: string, lineNumber: number): BenchmarkGoldSpan[] {
  return spans.map((span, index) => {
    const label = `goldSpans[${index}]`;
    const record = requireObject(span, lineNumber, label);
    const start = requireInteger(record, 'start', lineNumber, label);
    const end = requireInteger(record, 'end', lineNumber, label);
    const entityType = parseEntityType(requireString(record, 'entity_type', lineNumber, label), lineNumber, label);
    const spanText = requireString(record, 'text', lineNumber, label);
    validateByteSpan(text, start, end, spanText, lineNumber, label);

    return { start, end, entity_type: entityType, text: spanText };
  });
}

function parseSourceProvenance(source: JsonRecord, lineNumber: number): BenchmarkSourceProvenance {
  return {
    dataset: requireString(source, 'dataset', lineNumber, 'source'),
    recordId: requireString(source, 'recordId', lineNumber, 'source'),
    split: requireString(source, 'split', lineNumber, 'source'),
    uid: optionalStringOrNumber(source, 'uid', lineNumber, 'source'),
    region: optionalString(source, 'region', lineNumber, 'source'),
    script: optionalString(source, 'script', lineNumber, 'source'),
    sourceFile: optionalString(source, 'sourceFile', lineNumber, 'source'),
    sourceRow: requireInteger(source, 'sourceRow', lineNumber, 'source'),
  };
}

function validateByteSpan(
  text: string,
  start: number,
  end: number,
  expectedText: string,
  lineNumber: number,
  label: string
): void {
  const textBytes = encoder.encode(text);
  if (start < 0 || end <= start || end > textBytes.length) {
    throw corpusError(
      lineNumber,
      `${label} has invalid UTF-8 byte span range ${start}-${end} for ${textBytes.length} byte text.`
    );
  }

  let actualText: string;
  try {
    actualText = decoder.decode(textBytes.slice(start, end));
  } catch {
    throw corpusError(lineNumber, `${label} byte offsets must align to UTF-8 character boundaries.`);
  }

  if (actualText !== expectedText) {
    throw corpusError(
      lineNumber,
      `${label} text mismatch for UTF-8 byte offsets ${start}-${end}: expected "${expectedText}", sliced "${actualText}".`
    );
  }
}

function parseLanguage(value: string, lineNumber: number): BenchmarkLanguage {
  if (!languageSet.has(value)) {
    throw corpusError(lineNumber, `Unsupported language "${value}".`);
  }
  return value as BenchmarkLanguage;
}

function parseEntityType(value: string, lineNumber: number, label: string): BenchmarkEntityType {
  if (!entityTypeSet.has(value)) {
    throw corpusError(lineNumber, `${label} has unsupported entity_type "${value}".`);
  }
  return value as BenchmarkEntityType;
}

function parseOptionalLengthBucketDefinitions(
  value: unknown,
  lineNumber: number
): BenchmarkLengthBucketDefinition[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw corpusError(lineNumber, 'curation.lengthBuckets must be an array.');

  return value.map((bucket, index) => {
    const object = requireObject(bucket, lineNumber, `curation.lengthBuckets[${index}]`);
    const id = requireString(object, 'id', lineNumber, `curation.lengthBuckets[${index}]`);
    if (!lengthBucketSet.has(id)) {
      throw corpusError(lineNumber, `Unsupported length bucket "${id}".`);
    }
    const maxChars = object.maxChars;
    if (maxChars !== null && (typeof maxChars !== 'number' || !Number.isInteger(maxChars) || maxChars < 0)) {
      throw corpusError(lineNumber, `curation.lengthBuckets[${index}].maxChars must be a non-negative integer or null.`);
    }
    return { id: id as BenchmarkLengthBucket, maxChars };
  });
}

function parseOptionalCountMap<T extends string>(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  label: string,
  lineNumber: number
): Partial<Record<T, number>> | undefined {
  if (value === undefined) return undefined;
  const object = requireObject(value, lineNumber, label);
  const parsed: Partial<Record<T, number>> = {};
  for (const [key, count] of Object.entries(object)) {
    if (!allowedKeys.has(key)) throw corpusError(lineNumber, `${label} contains unsupported key "${key}".`);
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
      throw corpusError(lineNumber, `${label}.${key} must be a non-negative integer.`);
    }
    parsed[key as T] = count;
  }
  return parsed;
}

function requireObject(value: unknown, lineNumber: number, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw corpusError(lineNumber, `${label} must be an object.`);
  }
  return value as JsonRecord;
}

function requireObjectField(record: JsonRecord, field: string, lineNumber: number): JsonRecord {
  return requireObject(record[field], lineNumber, field);
}

function requireArray(record: JsonRecord, field: string, lineNumber: number): unknown[] {
  const value = record[field];
  if (!Array.isArray(value)) throw corpusError(lineNumber, `${field} must be an array.`);
  return value;
}

function requireString(record: JsonRecord, field: string, lineNumber: number, parent?: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw corpusError(lineNumber, `${fieldName(parent, field)} must be a non-empty string.`);
  }
  return value;
}

function optionalString(record: JsonRecord, field: string, lineNumber: number, parent?: string): string | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw corpusError(lineNumber, `${fieldName(parent, field)} must be a non-empty string when present.`);
  }
  return value;
}

function optionalStringOrNumber(
  record: JsonRecord,
  field: string,
  lineNumber: number,
  parent?: string
): string | number | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if ((typeof value !== 'string' || value.length === 0) && typeof value !== 'number') {
    throw corpusError(lineNumber, `${fieldName(parent, field)} must be a string or number when present.`);
  }
  return value;
}

function requireNumber(record: JsonRecord, field: string, lineNumber: number, parent?: string): number {
  const value = record[field];
  if (typeof value !== 'number') throw corpusError(lineNumber, `${fieldName(parent, field)} must be a number.`);
  return value;
}

function requireInteger(record: JsonRecord, field: string, lineNumber: number, parent?: string): number {
  const value = requireNumber(record, field, lineNumber, parent);
  if (!Number.isInteger(value)) throw corpusError(lineNumber, `${fieldName(parent, field)} must be an integer.`);
  return value;
}

function optionalInteger(record: JsonRecord, field: string, lineNumber: number): number | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw corpusError(lineNumber, `${field} must be a non-negative integer when present.`);
  }
  return value;
}

function fieldName(parent: string | undefined, field: string): string {
  return parent ? `${parent}.${field}` : field;
}

function corpusError(lineNumber: number, message: string): Error {
  return new Error(`Benchmark corpus line ${lineNumber}: ${message}`);
}
