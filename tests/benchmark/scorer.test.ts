import type { BenchmarkExample, BenchmarkGoldSpan } from '../../src/benchmark/contracts';
import { scoreBenchmarkDetections, scoreExample } from '../../src/benchmark/scorer';
import type { EntityType, PiiSpan } from '../../src/shared/message-types';

function gold(start: number, end: number, entityType: EntityType = 'PERSON', text = 'value'): BenchmarkGoldSpan {
  return { start, end, entity_type: entityType, text };
}

function detected(start: number, end: number, entityType: EntityType = 'PERSON', text = 'value'): PiiSpan {
  return { start, end, entity_type: entityType, score: 0.9, text, source: 'ner' };
}

function example(
  id: string,
  goldSpans: BenchmarkGoldSpan[],
  overrides: Partial<BenchmarkExample> = {}
): BenchmarkExample {
  return {
    recordType: 'example',
    id,
    language: 'en',
    lengthBucket: 'short',
    text: '0123456789abcdefghijklmnopqrstuvwxyz',
    goldSpans,
    source: {
      dataset: 'fixture/openpii',
      recordId: id,
      split: 'validation',
      sourceRow: 0,
    },
    ...overrides,
  };
}

describe('benchmark span scorer', () => {
  test('matches exact spans as primary true positives', () => {
    const result = scoreBenchmarkDetections([example('ex-1', [gold(4, 12)])], {
      'ex-1': [detected(4, 12)],
    });

    expect(result.headline).toEqual(
      expect.objectContaining({ truePositives: 1, falsePositives: 0, falseNegatives: 0, precision: 1, recall: 1, f1: 1 })
    );
    expect(result.typeAccuracy).toEqual({ matched: 1, correct: 1, accuracy: 1 });
  });

  test('tolerates small boundary drift without requiring type correctness', () => {
    const result = scoreBenchmarkDetections(
      [example('ex-1', [gold(10, 20, 'EMAIL')])],
      { 'ex-1': [detected(9, 21, 'PERSON')] },
      { boundaryToleranceBytes: 2 }
    );

    expect(result.headline.truePositives).toBe(1);
    expect(result.headline.falseNegatives).toBe(0);
    expect(result.typeAccuracy).toEqual({ matched: 1, correct: 0, accuracy: 0 });
  });

  test('rejects too-broad detections even when they cover the gold span', () => {
    const result = scoreBenchmarkDetections([example('ex-1', [gold(10, 20)])], {
      'ex-1': [detected(0, 40)],
    });

    expect(result.headline).toEqual(
      expect.objectContaining({ truePositives: 0, falsePositives: 1, falseNegatives: 1, precision: 0, recall: 0, f1: 0 })
    );
  });

  test('rejects insufficient overlap and boundary misses', () => {
    const result = scoreBenchmarkDetections([example('ex-1', [gold(10, 20)])], {
      'ex-1': [detected(16, 24)],
    });

    expect(result.falseNegatives).toHaveLength(1);
    expect(result.falsePositives).toHaveLength(1);
    expect(result.headline.truePositives).toBe(0);
  });

  test('uses one-to-one matching so duplicate detections become false positives', () => {
    const result = scoreBenchmarkDetections([example('ex-1', [gold(10, 20)])], {
      'ex-1': [detected(10, 20), detected(10, 20)],
    });

    expect(result.headline).toEqual(
      expect.objectContaining({ truePositives: 1, falsePositives: 1, falseNegatives: 0, precision: 0.5, recall: 1 })
    );
  });

  test('one broad detection cannot satisfy many gold spans', () => {
    const scored = scoreExample(example('ex-1', [gold(10, 20), gold(22, 32)]), [detected(9, 33)], {
      boundaryToleranceBytes: 2,
      minGoldCoverage: 0.8,
      minDetectionCoverage: 0.5,
      sampleLimit: 5,
    });

    expect(scored.matches).toHaveLength(0);
    expect(scored.falseNegatives).toHaveLength(2);
    expect(scored.falsePositives).toHaveLength(1);
  });

  test('reports false positives and false negatives in entity, language, and length breakdowns', () => {
    const examples = [
      example('en-short', [gold(1, 5, 'EMAIL')]),
      example('de-long', [gold(6, 12, 'PHONE')], { language: 'de', lengthBucket: 'long' }),
    ];
    const result = scoreBenchmarkDetections(examples, {
      'en-short': [detected(1, 5, 'EMAIL'), detected(20, 24, 'URL')],
      'de-long': [],
    });

    expect(result.byEntityType.EMAIL).toEqual(expect.objectContaining({ truePositives: 1, recall: 1 }));
    expect(result.byEntityType.URL).toEqual(expect.objectContaining({ falsePositives: 1, precision: 0 }));
    expect(result.byEntityType.PHONE).toEqual(expect.objectContaining({ falseNegatives: 1, recall: 0 }));
    expect(result.byLanguage.en).toEqual(expect.objectContaining({ truePositives: 1, falsePositives: 1 }));
    expect(result.byLanguage.de).toEqual(expect.objectContaining({ falseNegatives: 1 }));
    expect(result.byLengthBucket.long).toEqual(expect.objectContaining({ falseNegatives: 1 }));
  });

  test('reports negative examples separately with pass and false-positive rates', () => {
    const result = scoreBenchmarkDetections(
      [example('negative-pass', []), example('negative-fail', [])],
      { 'negative-fail': [detected(2, 8, 'ORGANIZATION')] }
    );

    expect(result.headline).toEqual(
      expect.objectContaining({ truePositives: 0, falsePositives: 0, falseNegatives: 0 })
    );
    expect(result.negative).toEqual({
      examples: 2,
      passed: 1,
      failed: 1,
      passRate: 0.5,
      falsePositiveRate: 0.5,
      falsePositives: 1,
    });
  });

  test('excludes miscellaneous-label examples from headline metrics and reports them separately', () => {
    const result = scoreBenchmarkDetections(
      [
        example('normal', [gold(4, 12, 'PERSON')]),
        example('misc', [gold(15, 20, 'MISC'), gold(22, 28, 'EMAIL')]),
      ],
      {
        normal: [detected(4, 12, 'PERSON')],
        misc: [detected(15, 20, 'MISC'), detected(22, 28, 'PERSON'), detected(30, 35, 'MISC')],
      }
    );

    expect(result.headline).toEqual(
      expect.objectContaining({ truePositives: 1, falsePositives: 0, falseNegatives: 0, precision: 1, recall: 1 })
    );
    expect(result.misc.examples).toBe(1);
    expect(result.typeAccuracy).toEqual({ matched: 1, correct: 1, accuracy: 1 });
    expect(result.misc.goldSpans).toBe(2);
    expect(result.misc.metrics).toEqual(
      expect.objectContaining({ truePositives: 2, falsePositives: 1, falseNegatives: 0, precision: 2 / 3, recall: 1 })
    );
    expect(result.misc.typeAccuracy).toEqual({ matched: 2, correct: 1, accuracy: 0.5 });
  });

  test('returns compact false-positive and false-negative samples', () => {
    const result = scoreBenchmarkDetections(
      [example('miss', [gold(4, 12, 'ADDRESS')]), example('extra', [])],
      { extra: [detected(20, 25, 'DATE')] },
      { sampleLimit: 1 }
    );

    expect(result.samples.falseNegatives).toEqual([
      expect.objectContaining({ exampleId: 'miss', gold: expect.objectContaining({ entity_type: 'ADDRESS' }) }),
    ]);
    expect(result.samples.falsePositives).toEqual([
      expect.objectContaining({ exampleId: 'extra', detected: expect.objectContaining({ entity_type: 'DATE' }) }),
    ]);
  });
});
