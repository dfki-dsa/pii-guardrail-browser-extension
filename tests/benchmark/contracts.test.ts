import {
  lengthBucketForText,
  parseBenchmarkCorpusJsonl,
  type BenchmarkCorpusMetadata,
  type BenchmarkExample,
} from '../../src/benchmark/contracts';
import { stringIndexToByteOffset } from '../../src/shared/text-offsets';

const { readFileSync } = require('fs');
const { join } = require('path');

function metadata(overrides: Partial<BenchmarkCorpusMetadata> = {}): BenchmarkCorpusMetadata {
  return {
    recordType: 'metadata',
    schemaVersion: 1,
    corpusId: 'fixture-corpus',
    description: 'Fixture corpus',
    createdAt: '2026-04-28T00:00:00.000Z',
    source: {
      name: 'fixture',
      url: 'https://example.test/dataset',
      datasetId: 'fixture/dataset',
      revision: 'abc123',
      snapshotPath: 'benchmarks/cache/openpii',
      downloadedAt: '2026-04-28T00:00:00.000Z',
      builtAt: '2026-04-28T00:00:00.000Z',
      exportPath: 'benchmarks/cache/openpii/data/validation.jsonl',
    },
    spanOffsetUnit: 'utf8-bytes',
    scoring: 'strict-span-type-v1',
    curation: {
      strategy: 'fixture',
      lengthBuckets: [
        { id: 'short', maxChars: 120 },
        { id: 'medium', maxChars: 260 },
        { id: 'long', maxChars: null },
      ],
      byLanguage: { en: 1 },
      byLengthBucket: { short: 1 },
      byEntityType: { PERSON: 1 },
      negativeExamples: 0,
      miscExamples: 0,
    },
    ...overrides,
  };
}

function example(overrides: Partial<BenchmarkExample> = {}): BenchmarkExample {
  const text = overrides.text ?? 'Contact Björn Müller by email.';
  const start = stringIndexToByteOffset(text, text.indexOf('Björn'));
  const end = stringIndexToByteOffset(text, text.indexOf(' by email'));

  return {
    recordType: 'example',
    id: 'fixture-1',
    language: 'en',
    lengthBucket: 'short',
    text,
    goldSpans: [{ start, end, entity_type: 'PERSON', text: 'Björn Müller' }],
    source: {
      dataset: 'fixture/dataset',
      recordId: 'row-1',
      split: 'validation',
      uid: 1,
      region: 'US',
      script: 'Latn',
      sourceFile: 'fixture.jsonl',
      sourceRow: 0,
    },
    ...overrides,
  };
}

function jsonl(...records: object[]): string {
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}

describe('benchmark corpus contracts', () => {
  test('parses the committed OpenPII corpus metadata and 500 examples', () => {
    const corpusPath = join(process.cwd(), 'benchmarks/corpora/openpii-generated.jsonl');
    const corpus = parseBenchmarkCorpusJsonl(readFileSync(corpusPath, 'utf8'));

    expect(corpus.metadata.corpusId).toBe('openpii-generated-v1');
    expect(corpus.metadata.spanOffsetUnit).toBe('utf8-bytes');
    expect(corpus.examples).toHaveLength(500);
    expect(corpus.examples.map((record) => record.language)).toEqual(
      expect.arrayContaining(['en', 'de'])
    );
    expect(corpus.examples.every((record) => record.lengthBucket === lengthBucketForText(record.text))).toBe(
      true
    );
  });

  test('parses a synthetic example and validates non-ASCII UTF-8 byte offsets', () => {
    const parsed = parseBenchmarkCorpusJsonl(jsonl(metadata(), example()));

    expect(parsed.examples[0]).toEqual(
      expect.objectContaining({
        id: 'fixture-1',
        language: 'en',
        lengthBucket: 'short',
        goldSpans: [expect.objectContaining({ text: 'Björn Müller', entity_type: 'PERSON' })],
      })
    );
  });

  test('allows negative examples with no gold spans', () => {
    const parsed = parseBenchmarkCorpusJsonl(
      jsonl(
        metadata(),
        example({
          id: 'negative-1',
          text: 'This sentence has no personal data.',
          goldSpans: [],
        })
      )
    );

    expect(parsed.examples[0].goldSpans).toEqual([]);
  });

  test('requires exactly one metadata record', () => {
    expect(() => parseBenchmarkCorpusJsonl(jsonl(example()))).toThrow(/missing a metadata record/i);
    expect(() => parseBenchmarkCorpusJsonl(jsonl(metadata(), metadata(), example()))).toThrow(
      /exactly one metadata record/
    );
  });

  test('rejects malformed JSONL and unknown record types with line numbers', () => {
    expect(() => parseBenchmarkCorpusJsonl(`${JSON.stringify(metadata())}\n{nope}\n`)).toThrow(
      /line 2: Malformed JSONL record/
    );
    expect(() => parseBenchmarkCorpusJsonl(jsonl(metadata(), { recordType: 'surprise' }))).toThrow(
      /line 2: Unknown recordType "surprise"/
    );
  });

  test('rejects missing required fields with clear errors', () => {
    const badExample = { ...example() };
    delete (badExample as Partial<BenchmarkExample>).source;

    expect(() => parseBenchmarkCorpusJsonl(jsonl(metadata(), badExample))).toThrow(
      /line 2: source must be an object/
    );
  });

  test('rejects unsupported languages and entity types', () => {
    expect(() =>
      parseBenchmarkCorpusJsonl(jsonl(metadata(), { ...example(), language: 'fr' }))
    ).toThrow(/Unsupported language "fr"/);

    expect(() =>
      parseBenchmarkCorpusJsonl(
        jsonl(metadata(), {
          ...example(),
          goldSpans: [{ ...example().goldSpans[0], entity_type: 'PASSPORT' }],
        })
      )
    ).toThrow(/unsupported entity_type "PASSPORT"/);
  });

  test('rejects invalid ranges and offset-unit mismatches', () => {
    expect(() =>
      parseBenchmarkCorpusJsonl(
        jsonl(metadata(), {
          ...example(),
          goldSpans: [{ ...example().goldSpans[0], start: 6, end: 5 }],
        })
      )
    ).toThrow(/invalid UTF-8 byte span range/);

    expect(() =>
      parseBenchmarkCorpusJsonl(
        jsonl(metadata(), {
          ...example(),
          goldSpans: [{ ...example().goldSpans[0], start: 8, end: 20 }],
        })
      )
    ).toThrow(/text mismatch for UTF-8 byte offsets/);
  });

  test('rejects byte offsets that split a multibyte character', () => {
    const text = 'A😀B';
    const start = stringIndexToByteOffset(text, text.indexOf('😀'));
    const badEnd = start + 1;

    expect(() =>
      parseBenchmarkCorpusJsonl(
        jsonl(metadata(), {
          ...example(),
          text,
          goldSpans: [{ start, end: badEnd, entity_type: 'MISC', text: '😀' }],
        })
      )
    ).toThrow(/align to UTF-8 character boundaries/);
  });
});
