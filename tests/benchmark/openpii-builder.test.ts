import { parseBenchmarkCorpusJsonl } from '../../src/benchmark/contracts';
import {
  OPENPII_DATASET_ID,
  buildOpenPiiBenchmarkCorpus,
  openPiiRecordToBenchmarkExample,
  sampleOpenPiiExamples,
} from '../../src/benchmark/openpii-builder';
import { stringIndexToByteOffset } from '../../src/shared/text-offsets';

const { mkdtempSync, readFileSync, writeFileSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');
const { spawnSync } = require('child_process');

function mask(text: string, value: string, label: string) {
  const start = text.indexOf(value);
  if (start < 0) throw new Error(`Fixture value ${value} not found.`);
  return { start, end: start + value.length, value, label };
}

function record(overrides: Record<string, unknown> = {}) {
  const text = 'Contact Björn Müller at bjoern@example.test in München on 03/05/2026.';
  return {
    id: 42,
    language: 'de',
    source_text: text,
    privacy_mask: [
      mask(text, 'Björn Müller', 'FULL_NAME'),
      mask(text, 'bjoern@example.test', 'EMAIL_ADDRESS'),
      mask(text, 'München', 'CITY'),
      mask(text, '03/05/2026', 'DATE'),
    ],
    region: 'DE',
    script: 'Latn',
    sourceFile: 'benchmarks/cache/openpii/data/validation.jsonl',
    sourceRow: 7,
    ...overrides,
  };
}

describe('OpenPII benchmark corpus builder', () => {
  test('converts OpenPII privacy masks into app taxonomy spans with UTF-8 byte offsets', () => {
    const example = openPiiRecordToBenchmarkExample(record());

    expect(example).not.toBeNull();
    if (!example) return;
    expect(example).toEqual(
      expect.objectContaining({
        id: 'openpii-de-42',
        language: 'de',
        lengthBucket: 'short',
        source: expect.objectContaining({
          dataset: OPENPII_DATASET_ID,
          recordId: '42',
          sourceRow: 7,
        }),
      })
    );
    expect(example.goldSpans).toEqual([
      {
        start: stringIndexToByteOffset(example.text, example.text.indexOf('Björn Müller')),
        end: stringIndexToByteOffset(example.text, example.text.indexOf(' at ')),
        entity_type: 'PERSON',
        text: 'Björn Müller',
      },
      expect.objectContaining({ entity_type: 'EMAIL', text: 'bjoern@example.test' }),
      expect.objectContaining({ entity_type: 'LOCATION', text: 'München' }),
      expect.objectContaining({ entity_type: 'DATE', text: '03/05/2026' }),
    ]);
  });

  test('falls back to source value search when source offsets do not match', () => {
    const text = 'Reach Léa at lea@example.test.';
    const example = openPiiRecordToBenchmarkExample(
      record({
        id: 'fallback',
        language: 'en',
        source_text: text,
        privacy_mask: [{ start: 0, end: 3, value: 'Léa', label: 'FIRSTNAME' }],
      })
    );

    expect(example?.goldSpans).toEqual([
      {
        start: stringIndexToByteOffset(text, text.indexOf('Léa')),
        end: stringIndexToByteOffset(text, text.indexOf(' at ')),
        entity_type: 'PERSON',
        text: 'Léa',
      },
    ]);
  });

  test('builds metadata with compact provenance and validates the generated corpus', () => {
    const corpus = buildOpenPiiBenchmarkCorpus([record()], {
      corpusId: 'fixture-openpii',
      sourceRevision: 'revision-a',
      sourceSnapshotPath: 'benchmarks/cache/openpii',
      sourceDownloadedAt: '2026-04-28T18:26:57.126Z',
      sourceExportPath: 'benchmarks/cache/openpii/data/validation.jsonl',
      builtAt: '2026-04-28T18:27:40.341Z',
      sampling: { strategy: 'first', limit: 1 },
    });

    expect(corpus.metadata).toEqual(
      expect.objectContaining({
        corpusId: 'fixture-openpii',
        createdAt: '2026-04-28T18:27:40.341Z',
        spanOffsetUnit: 'utf8-bytes',
        source: expect.objectContaining({
          datasetId: OPENPII_DATASET_ID,
          revision: 'revision-a',
          builtAt: '2026-04-28T18:27:40.341Z',
        }),
      })
    );
    expect(corpus.metadata.curation).toEqual(
      expect.objectContaining({
        strategy: 'first',
        targetExamples: 1,
        byLanguage: { de: 1 },
        byLengthBucket: { short: 1 },
      })
    );
  });

  test('coverage sampling deterministically reserves negative, misc, and supported examples', () => {
    const records = [
      record({ id: 3, language: 'en', privacy_mask: [], sourceRow: 3 }),
      record({
        id: 2,
        language: 'de',
        privacy_mask: [mask(record().source_text as string, '03/05/2026', 'AGE')],
        sourceRow: 2,
      }),
      record({ id: 1, language: 'en', sourceRow: 1 }),
      record({ id: 4, language: 'de', sourceRow: 4 }),
    ];
    const examples = records
      .map((item, index) => openPiiRecordToBenchmarkExample(item, index))
      .filter((example) => example !== null);

    const sampled = sampleOpenPiiExamples(examples, {
      strategy: 'coverage',
      limit: 3,
      negativeTarget: 1,
      miscTarget: 1,
    });

    expect(sampled.map((example) => example.id)).toEqual([
      'openpii-de-2',
      'openpii-en-1',
      'openpii-en-3',
    ]);
  });

  test('build script reads explicit inputs, validates output, and writes parseable JSONL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'openpii-builder-'));
    const input = join(dir, 'validation.jsonl');
    const output = join(dir, 'corpus.jsonl');
    writeFileSync(input, `${JSON.stringify(record())}\n${JSON.stringify(record({ id: 43, language: 'en' }))}\n`);

    const result = spawnSync(
      process.execPath,
      [
        'scripts/build-openpii-corpus.js',
        '--input',
        input,
        '--out',
        output,
        '--limit',
        '2',
        '--sample',
        'first',
        '--source-revision',
        'fixture-revision',
      ],
      { cwd: process.cwd(), encoding: 'utf8' }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Wrote 2 examples');
    const parsed = parseBenchmarkCorpusJsonl(readFileSync(output, 'utf8'));
    expect(parsed.metadata.source.revision).toBe('fixture-revision');
    expect(parsed.examples).toHaveLength(2);
  });
});
