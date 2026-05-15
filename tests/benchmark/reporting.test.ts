import type { BenchmarkDetectionRunResult } from '../../src/benchmark/detection-harness';
import type { BenchmarkCorpusMetadata, BenchmarkExample, BenchmarkGoldSpan } from '../../src/benchmark/contracts';
import { createBenchmarkReport, formatBenchmarkReport } from '../../src/benchmark/reporting';
import type { EntityType, PiiSpan } from '../../src/shared/message-types';

function metadata(): BenchmarkCorpusMetadata {
  return {
    recordType: 'metadata',
    schemaVersion: 1,
    corpusId: 'report-fixture',
    description: 'Reporting fixture',
    createdAt: '2026-05-04T00:00:00.000Z',
    source: {
      name: 'fixture',
      url: 'https://example.test/openpii',
      datasetId: 'fixture/openpii',
      revision: 'test-rev',
    },
    spanOffsetUnit: 'utf8-bytes',
    scoring: 'span-tolerant-v1',
  };
}

function gold(start: number, end: number, entityType: EntityType, text: string): BenchmarkGoldSpan {
  return { start, end, entity_type: entityType, text };
}

function detected(start: number, end: number, entityType: EntityType, text: string, score = 0.9): PiiSpan {
  return { start, end, entity_type: entityType, text, score, source: 'ner' };
}

function example(
  id: string,
  text: string,
  goldSpans: BenchmarkGoldSpan[],
  overrides: Partial<BenchmarkExample> = {}
): BenchmarkExample {
  return {
    recordType: 'example',
    id,
    language: 'en',
    lengthBucket: 'short',
    text,
    goldSpans,
    source: {
      dataset: 'fixture/openpii',
      recordId: id,
      split: 'validation',
      sourceRow: 1,
    },
    ...overrides,
  };
}

function runResult(): BenchmarkDetectionRunResult {
  const sourceExamples = [
    example('hit', 'Ada can be reached at ada@example.test.', [
      gold(0, 3, 'PERSON', 'Ada'),
      gold(22, 38, 'EMAIL', 'ada@example.test'),
    ]),
    example('miss', 'Call Linus at 555-0100.', [gold(5, 10, 'PERSON', 'Linus')], {
      language: 'de',
      lengthBucket: 'medium',
    }),
    example('negative', 'No sensitive content here.', []),
    example('misc', 'Passport XX123456 belongs to Ada.', [gold(9, 17, 'MISC', 'XX123456')]),
  ];

  return {
    corpus: {
      metadata: metadata(),
      exampleCount: sourceExamples.length,
    },
    sourceExamples,
    mode: 'model',
    config: {
      min_confidence: 0.5,
      context_boost: 0.15,
      context_window: 5,
      ner_provider: 'transformers',
      ner_model: 'ai4privacy',
      ner_enabled: true,
    },
    provider: {
      mode: 'transformers',
      state: 'ready',
      model: 'ai4privacy',
      modelLabel: 'AI4Privacy prototype',
      message: 'ready',
      timings: { totalMs: 10, loadMs: 7, inferenceMs: 3 },
    },
    timings: { totalWallMs: 100 },
    examples: [
      {
        id: 'hit',
        spans: [
          detected(0, 3, 'PERSON', 'Ada'),
          detected(22, 38, 'EMAIL', 'ada@example.test'),
        ],
        timings: { totalMs: 20, nerMs: 12 },
      },
      {
        id: 'miss',
        spans: [detected(14, 22, 'PHONE', '555-0100', 0.8)],
        timings: { totalMs: 30, nerMs: 18 },
      },
      {
        id: 'negative',
        spans: [detected(3, 12, 'ORGANIZATION', 'sensitive', 0.6)],
        timings: { totalMs: 10, nerMs: 6 },
      },
      {
        id: 'misc',
        spans: [detected(9, 17, 'MISC', 'XX123456')],
        timings: { totalMs: 40, nerMs: 24 },
      },
    ],
  };
}

describe('benchmark reporting', () => {
  test('formats a console summary with config, quality, breakdowns, samples, and latency', () => {
    const report = createBenchmarkReport(runResult());
    const summary = formatBenchmarkReport(report);

    expect(summary).toContain('OpenPII benchmark');
    expect(summary).toContain('Corpus: report-fixture (4 examples, schema 1)');
    expect(summary).toContain('Provider: transformers; model: ai4privacy; NER enabled: yes');
    expect(summary).toContain('Micro span P/R/F1: 66.7% / 66.7% / 66.7%');
    expect(summary).toContain('Type accuracy on matched spans: 100.0% (2/2)');
    expect(summary).toContain('Language: en');
    expect(summary).toContain('Length: short');
    expect(summary).toContain('Negative examples: 0/1 passed');
    expect(summary).toContain('Misc bucket: 1 examples, 1 gold spans');
    expect(summary).toContain('Total wall time: 100 ms');
    expect(summary).toContain('Per example: avg 25 ms, p50 20 ms, p95 40 ms, max 40 ms');
    expect(summary).toContain('NER timing: avg 15 ms, p50 12 ms, p95 24 ms, max 24 ms');
    expect(summary).toContain('Last provider model load: 7 ms');
    expect(summary).toContain('- miss PERSON "Linus"');
    expect(summary).toContain('- miss PHONE "555-0100"');
  });

  test('builds a JSON-serializable report with summary metrics and per-example details', () => {
    const report = createBenchmarkReport(runResult());
    const parsed = JSON.parse(JSON.stringify(report));

    expect(parsed).toEqual(
      expect.objectContaining({
        corpus: expect.objectContaining({
          metadata: expect.objectContaining({ corpusId: 'report-fixture' }),
          exampleCount: 4,
        }),
        score: expect.objectContaining({
          headline: expect.objectContaining({
            truePositives: 2,
            falsePositives: 1,
            falseNegatives: 1,
          }),
        }),
        latency: expect.objectContaining({
          totalWallMs: 100,
          perExampleMs: expect.objectContaining({ averageMs: 25, p95Ms: 40 }),
          nerMs: expect.objectContaining({ averageMs: 15 }),
        }),
        samples: expect.objectContaining({
          falseNegatives: [expect.objectContaining({ exampleId: 'miss', spanText: 'Linus' })],
          falsePositives: expect.arrayContaining([
            expect.objectContaining({ exampleId: 'miss', spanText: '555-0100' }),
          ]),
        }),
        examples: expect.arrayContaining([
          expect.objectContaining({
            id: 'hit',
            goldSpans: expect.any(Array),
            detectedSpans: expect.any(Array),
            matches: expect.any(Array),
            timings: expect.objectContaining({ totalMs: 20 }),
          }),
        ]),
      })
    );
  });
});
