import {
  BENCHMARK_ENTITY_TYPES,
  BENCHMARK_LANGUAGES,
  lengthBucketForText,
  parseBenchmarkCorpusJsonl,
  type BenchmarkCorpus,
  type BenchmarkCorpusMetadata,
  type BenchmarkEntityType,
  type BenchmarkExample,
  type BenchmarkGoldSpan,
  type BenchmarkLanguage,
  type BenchmarkLengthBucket,
} from './contracts';
import { stringIndexToByteOffset } from '../shared/text-offsets';

export const OPENPII_DATASET_ID = 'ai4privacy/pii-masking-openpii-1m';
export const OPENPII_DATASET_URL = `https://huggingface.co/datasets/${OPENPII_DATASET_ID}`;
export const OPENPII_SUPPORTED_ENTITY_TYPES = [
  'ADDRESS',
  'CREDIT_CARD',
  'DATE',
  'EMAIL',
  'LOCATION',
  'PERSON',
  'PHONE',
  'SSN',
] as const satisfies readonly BenchmarkEntityType[];

const SUPPORTED_TYPE_SET = new Set<string>(OPENPII_SUPPORTED_ENTITY_TYPES);
const ENTITY_TYPE_SET = new Set<string>(BENCHMARK_ENTITY_TYPES);
const LANGUAGE_SET = new Set<string>(BENCHMARK_LANGUAGES);
const LENGTH_BUCKETS = [
  { id: 'short' as const, maxChars: 120 },
  { id: 'medium' as const, maxChars: 260 },
  { id: 'long' as const, maxChars: null },
];

export interface OpenPiiBuildOptions {
  corpusId?: string;
  description?: string;
  sourceName?: string;
  sourceUrl?: string;
  sourceDatasetId?: string;
  sourceRevision?: string;
  sourceSnapshotPath?: string;
  sourceDownloadedAt?: string;
  sourceExportPath?: string;
  builtAt?: string;
  sampling?: OpenPiiSamplingOptions;
}

export interface OpenPiiSamplingOptions {
  strategy?: 'coverage' | 'first';
  limit?: number;
  negativeTarget?: number;
  miscTarget?: number;
}

interface JsonRecord {
  [key: string]: unknown;
}

interface SourceSpan {
  start?: number;
  end?: number;
  label?: string;
  value?: string;
}

interface Placement {
  category: 'negative' | 'misc' | 'supported';
  key: string;
}

interface CoverageSampler {
  limit: number;
  targets: Record<Placement['category'], number>;
  selected: BenchmarkExample[];
  selectedIds: Set<string>;
  counts: Record<Placement['category'], Map<string, number>>;
  categoryCounts: Record<Placement['category'], number>;
  reserves: BenchmarkExample[];
}

export function buildOpenPiiBenchmarkCorpus(
  records: readonly JsonRecord[],
  options: OpenPiiBuildOptions = {}
): BenchmarkCorpus {
  const examples = records
    .map((record, index) => openPiiRecordToBenchmarkExample(record, index))
    .filter((example): example is BenchmarkExample => example !== null);
  const sampledExamples = sampleExamples(examples, options.sampling);
  const metadata = createOpenPiiMetadata(options, sampledExamples);
  const corpus = { metadata, examples: sampledExamples };

  parseBenchmarkCorpusJsonl(toBenchmarkJsonl(corpus));
  return corpus;
}

export function createOpenPiiMetadata(
  options: OpenPiiBuildOptions = {},
  examples: readonly BenchmarkExample[] = []
): BenchmarkCorpusMetadata {
  const builtAt = options.builtAt ?? new Date().toISOString();
  return {
    recordType: 'metadata',
    schemaVersion: 1,
    corpusId: options.corpusId ?? 'openpii-generated-v1',
    description:
      options.description ??
      'Benchmark corpus generated from AI4Privacy OpenPII records with app-taxonomy gold spans materialized at build time.',
    createdAt: builtAt,
    source: {
      name: options.sourceName ?? OPENPII_DATASET_ID,
      url: options.sourceUrl ?? OPENPII_DATASET_URL,
      datasetId: options.sourceDatasetId ?? OPENPII_DATASET_ID,
      revision: options.sourceRevision,
      snapshotPath: options.sourceSnapshotPath,
      downloadedAt: options.sourceDownloadedAt,
      builtAt,
      exportPath: options.sourceExportPath,
    },
    spanOffsetUnit: 'utf8-bytes',
    scoring: 'strict-span-type-v1',
    curation: summarizeOpenPiiExamples(examples, options.sampling),
  };
}

export function openPiiRecordToBenchmarkExample(
  record: JsonRecord,
  fallbackSourceRow = 0
): BenchmarkExample | null {
  const text = firstString(record, ['source_text', 'unmasked_text', 'original_text', 'text']);
  if (!text) return null;

  const language = normalizeLanguage(firstString(record, ['language', 'lang', 'locale']));
  if (!language) return null;

  const sourceRow = firstInteger(record, ['sourceRow', 'source_row']) ?? fallbackSourceRow;
  const recordId = String(firstStringOrNumber(record, ['id', 'uid', 'record_id', 'recordId']) ?? sourceRow);
  const sourceFile = firstString(record, ['sourceFile', 'source_file']);
  const goldSpans = extractGoldSpans(record, text);

  return {
    recordType: 'example',
    id: `openpii-${language}-${recordId}`,
    language,
    lengthBucket: lengthBucketForText(text),
    text,
    goldSpans,
    source: {
      dataset: firstString(record, ['dataset']) ?? OPENPII_DATASET_ID,
      recordId,
      split: firstString(record, ['split']) ?? 'validation',
      uid: firstStringOrNumber(record, ['uid']),
      region: firstString(record, ['region']),
      script: firstString(record, ['script']),
      sourceFile,
      sourceRow,
    },
  };
}

export function sampleOpenPiiExamples(
  examples: readonly BenchmarkExample[],
  options: OpenPiiSamplingOptions = {}
): BenchmarkExample[] {
  return sampleExamples(examples, options);
}

export function summarizeOpenPiiExamples(
  examples: readonly BenchmarkExample[],
  options: OpenPiiSamplingOptions = {}
): NonNullable<BenchmarkCorpusMetadata['curation']> {
  const byLanguage: Partial<Record<BenchmarkLanguage, number>> = {};
  const byLengthBucket: Partial<Record<BenchmarkLengthBucket, number>> = {};
  const byEntityType: Partial<Record<BenchmarkEntityType, number>> = {};
  let negativeExamples = 0;
  let miscExamples = 0;

  for (const example of examples) {
    byLanguage[example.language] = (byLanguage[example.language] ?? 0) + 1;
    byLengthBucket[example.lengthBucket] = (byLengthBucket[example.lengthBucket] ?? 0) + 1;
    const spanTypes = uniqueSorted(example.goldSpans.map((span) => span.entity_type));
    if (spanTypes.length === 0) negativeExamples += 1;
    if (spanTypes.includes('MISC')) miscExamples += 1;
    for (const type of spanTypes) {
      byEntityType[type] = (byEntityType[type] ?? 0) + 1;
    }
  }

  return {
    strategy: options.strategy ?? 'coverage',
    targetExamples: options.limit ?? examples.length,
    negativeTarget: options.negativeTarget,
    miscTarget: options.miscTarget,
    lengthBuckets: LENGTH_BUCKETS,
    byLanguage,
    byLengthBucket,
    byEntityType,
    negativeExamples,
    miscExamples,
  };
}

function extractGoldSpans(record: JsonRecord, text: string): BenchmarkGoldSpan[] {
  const spans = normalizeSourceSpans(record);
  return spans
    .map((span) => sourceSpanToGoldSpan(span, text))
    .filter((span): span is BenchmarkGoldSpan => span !== null)
    .sort(
      (left, right) =>
        left.start - right.start ||
        left.end - right.end ||
        left.entity_type.localeCompare(right.entity_type)
    );
}

function normalizeSourceSpans(record: JsonRecord): SourceSpan[] {
  const privacyMask = record.privacy_mask;
  if (Array.isArray(privacyMask)) {
    return privacyMask.map((span) => {
      if (!span || typeof span !== 'object') return {};
      const object = span as JsonRecord;
      return {
        start: firstInteger(object, ['start', 'start_offset']),
        end: firstInteger(object, ['end', 'end_offset']),
        label: firstString(object, ['label', 'entity_type', 'type']),
        value: firstString(object, ['value', 'text']),
      };
    });
  }

  const spanLabels = record.span_labels;
  if (Array.isArray(spanLabels)) {
    return spanLabels.map((span) => {
      if (!Array.isArray(span)) return {};
      return {
        start: typeof span[0] === 'number' ? span[0] : undefined,
        end: typeof span[1] === 'number' ? span[1] : undefined,
        label: typeof span[2] === 'string' ? span[2] : undefined,
        value: typeof span[3] === 'string' ? span[3] : undefined,
      };
    });
  }

  return [];
}

function sourceSpanToGoldSpan(span: SourceSpan, text: string): BenchmarkGoldSpan | null {
  const entityType = mapOpenPiiLabel(span.label);
  if (!entityType) return null;

  const range = resolveSourceRange(text, span);
  if (!range) return null;

  const slicedText = text.slice(range.startIndex, range.endIndex);
  return {
    start: stringIndexToByteOffset(text, range.startIndex),
    end: stringIndexToByteOffset(text, range.endIndex),
    entity_type: entityType,
    text: slicedText,
  };
}

function resolveSourceRange(
  text: string,
  span: SourceSpan
): { startIndex: number; endIndex: number } | null {
  if (
    span.start !== undefined &&
    span.end !== undefined &&
    span.start >= 0 &&
    span.end > span.start &&
    span.end <= text.length
  ) {
    const sliced = text.slice(span.start, span.end);
    if (!span.value || sliced === span.value) return { startIndex: span.start, endIndex: span.end };
  }

  if (!span.value) return null;
  const foundAt = text.indexOf(span.value);
  if (foundAt < 0) return null;
  return { startIndex: foundAt, endIndex: foundAt + span.value.length };
}

function mapOpenPiiLabel(label: string | undefined): BenchmarkEntityType | null {
  if (!label) return null;
  const normalized = label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (ENTITY_TYPE_SET.has(normalized)) return normalized as BenchmarkEntityType;

  const aliases: Record<string, BenchmarkEntityType> = {
    ACCOUNT_NAME: 'USERNAME',
    AGE: 'MISC',
    BIRTH_DATE: 'DATE',
    BUILDING_NUMBER: 'ADDRESS',
    CITY: 'LOCATION',
    COUNTRY: 'LOCATION',
    CREDIT_CARD_NUMBER: 'CREDIT_CARD',
    CREDITCARDNUMBER: 'CREDIT_CARD',
    DATE_OF_BIRTH: 'DATE',
    DOB: 'DATE',
    DRIVER_LICENSE: 'MISC',
    DRIVER_LICENSE_NUMBER: 'MISC',
    EMAIL_ADDRESS: 'EMAIL',
    FIRST_NAME: 'PERSON',
    FIRSTNAME: 'PERSON',
    FULL_NAME: 'PERSON',
    GENDER: 'MISC',
    GIVEN_NAME: 'PERSON',
    ID_CARD: 'MISC',
    ID_CARD_NUMBER: 'MISC',
    LAST_NAME: 'PERSON',
    LASTNAME: 'PERSON',
    NAME: 'PERSON',
    PASSPORT: 'MISC',
    PASSPORT_NUMBER: 'MISC',
    PHONE_NUMBER: 'PHONE',
    PIN: 'MISC',
    POSTAL_CODE: 'MISC',
    SOCIALNUMBER: 'SSN',
    SOCIAL_SECURITY_NUMBER: 'SSN',
    STATE: 'LOCATION',
    STREET: 'ADDRESS',
    STREET_ADDRESS: 'ADDRESS',
    TAX_ID: 'MISC',
    TAX_IDENTIFICATION_NUMBER: 'MISC',
    ZIP_CODE: 'MISC',
  };

  return aliases[normalized] ?? null;
}

function sampleExamples(
  examples: readonly BenchmarkExample[],
  options: OpenPiiSamplingOptions = {}
): BenchmarkExample[] {
  const strategy = options.strategy ?? 'coverage';
  const limit = options.limit ?? examples.length;
  if (!Number.isFinite(limit)) return [...examples].sort(compareExamplesForStableCorpus);
  if (strategy === 'first') return examples.slice(0, limit);

  const sampler = createCoverageSampler({
    limit,
    negativeTarget: options.negativeTarget ?? 25,
    miscTarget: options.miscTarget ?? 50,
  });
  for (const example of examples) addExampleToCoverageSampler(sampler, example);
  return finishCoverageSampler(sampler);
}

function createCoverageSampler(options: Required<Pick<OpenPiiSamplingOptions, 'limit' | 'negativeTarget' | 'miscTarget'>>): CoverageSampler {
  const limit = Math.max(0, options.limit);
  const negativeTarget = Math.min(options.negativeTarget, limit);
  const miscTarget = Math.min(options.miscTarget, limit - negativeTarget);
  const supportedTarget = Math.max(0, limit - negativeTarget - miscTarget);

  return {
    limit,
    targets: { negative: negativeTarget, misc: miscTarget, supported: supportedTarget },
    selected: [],
    selectedIds: new Set(),
    counts: { negative: new Map(), misc: new Map(), supported: new Map() },
    categoryCounts: { negative: 0, misc: 0, supported: 0 },
    reserves: [],
  };
}

function addExampleToCoverageSampler(sampler: CoverageSampler, example: BenchmarkExample): void {
  if (sampler.limit === 0) return;
  const placement = choosePlacement(example, sampler);
  if (placement) {
    addSelected(example, placement, sampler);
    return;
  }

  if (!sampler.selectedIds.has(example.id) && sampler.reserves.length < sampler.limit * 4) {
    sampler.reserves.push(example);
  }
}

function finishCoverageSampler(sampler: CoverageSampler): BenchmarkExample[] {
  for (const example of sampler.reserves) {
    if (sampler.selected.length >= sampler.limit) break;
    if (sampler.selectedIds.has(example.id)) continue;
    sampler.selected.push(example);
    sampler.selectedIds.add(example.id);
  }

  return sampler.selected.slice(0, sampler.limit).sort(compareExamplesForStableCorpus);
}

function choosePlacement(example: BenchmarkExample, sampler: CoverageSampler): Placement | null {
  const spanTypes = uniqueSorted(example.goldSpans.map((span) => span.entity_type));
  if (spanTypes.length === 0) {
    return chooseBucketPlacement('negative', `${example.language}:${example.lengthBucket}`, negativeBucketKeys(), sampler);
  }
  if (spanTypes.includes('MISC')) {
    return chooseBucketPlacement('misc', `${example.language}:${example.lengthBucket}`, miscBucketKeys(), sampler);
  }

  const placements = spanTypes
    .filter((type) => SUPPORTED_TYPE_SET.has(type))
    .map((type) => ({
      category: 'supported' as const,
      key: `${example.language}:${type}:${example.lengthBucket}`,
      keys: supportedBucketKeys(),
    }))
    .map((placement) => ({
      ...placement,
      bucketCount: sampler.counts.supported.get(placement.key) ?? 0,
      bucketLimit: bucketLimit(placement.key, sampler.targets.supported, placement.keys),
    }))
    .filter((placement) => placement.bucketCount < placement.bucketLimit);

  if (sampler.categoryCounts.supported >= sampler.targets.supported || placements.length === 0) return null;
  placements.sort(
    (left, right) =>
      left.bucketCount - right.bucketCount ||
      left.bucketLimit - right.bucketLimit ||
      left.key.localeCompare(right.key)
  );
  return { category: 'supported', key: placements[0].key };
}

function chooseBucketPlacement(
  category: Placement['category'],
  key: string,
  keys: string[],
  sampler: CoverageSampler
): Placement | null {
  if (sampler.categoryCounts[category] >= sampler.targets[category]) return null;
  const count = sampler.counts[category].get(key) ?? 0;
  if (count >= bucketLimit(key, sampler.targets[category], keys)) return null;
  return { category, key };
}

function addSelected(example: BenchmarkExample, placement: Placement, sampler: CoverageSampler): void {
  if (sampler.selectedIds.has(example.id)) return;
  sampler.selected.push(example);
  sampler.selectedIds.add(example.id);
  sampler.counts[placement.category].set(
    placement.key,
    (sampler.counts[placement.category].get(placement.key) ?? 0) + 1
  );
  sampler.categoryCounts[placement.category] += 1;
}

function supportedBucketKeys(): string[] {
  return BENCHMARK_LANGUAGES.flatMap((language) =>
    OPENPII_SUPPORTED_ENTITY_TYPES.flatMap((type) =>
      LENGTH_BUCKETS.map((bucket) => `${language}:${type}:${bucket.id}`)
    )
  );
}

function miscBucketKeys(): string[] {
  return BENCHMARK_LANGUAGES.flatMap((language) => LENGTH_BUCKETS.map((bucket) => `${language}:${bucket.id}`));
}

function negativeBucketKeys(): string[] {
  return miscBucketKeys();
}

function bucketLimit(key: string, target: number, keys: readonly string[]): number {
  if (target <= 0) return 0;
  if (target < keys.length) return keys.includes(key) ? 1 : 0;
  const base = Math.floor(target / keys.length);
  const remainder = target % keys.length;
  const index = keys.indexOf(key);
  if (index === -1) return 0;
  return base + (index < remainder ? 1 : 0);
}

function compareExamplesForStableCorpus(left: BenchmarkExample, right: BenchmarkExample): number {
  return (
    left.language.localeCompare(right.language) ||
    String(left.source.sourceFile ?? '').localeCompare(String(right.source.sourceFile ?? '')) ||
    left.source.sourceRow - right.source.sourceRow ||
    left.id.localeCompare(right.id)
  );
}

function toBenchmarkJsonl(corpus: BenchmarkCorpus): string {
  return `${[corpus.metadata, ...corpus.examples].map((record) => JSON.stringify(record)).join('\n')}\n`;
}

function normalizeLanguage(value: string | undefined): BenchmarkLanguage | null {
  if (!value) return null;
  const normalized = value.toLowerCase().split(/[-_]/)[0];
  if (LANGUAGE_SET.has(normalized)) return normalized as BenchmarkLanguage;
  if (normalized === 'english') return 'en';
  if (normalized === 'german' || normalized === 'deutsch') return 'de';
  return null;
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

function firstString(record: JsonRecord, fields: readonly string[]): string | undefined {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function firstStringOrNumber(record: JsonRecord, fields: readonly string[]): string | number | undefined {
  for (const field of fields) {
    const value = record[field];
    if ((typeof value === 'string' && value.length > 0) || typeof value === 'number') return value;
  }
  return undefined;
}

function firstInteger(record: JsonRecord, fields: readonly string[]): number | undefined {
  for (const field of fields) {
    const value = record[field];
    if (Number.isInteger(value)) return value as number;
  }
  return undefined;
}
