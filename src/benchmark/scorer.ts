import type {
  BenchmarkEntityType,
  BenchmarkExample,
  BenchmarkGoldSpan,
  BenchmarkLanguage,
  BenchmarkLengthBucket,
} from './contracts';
import { BENCHMARK_ENTITY_TYPES, BENCHMARK_LANGUAGES, BENCHMARK_LENGTH_BUCKETS } from './contracts';
import type { PiiSpan } from '../shared/message-types';

export interface BenchmarkScorerOptions {
  boundaryToleranceBytes?: number;
  minGoldCoverage?: number;
  minDetectionCoverage?: number;
  sampleLimit?: number;
}

export interface BenchmarkMetricCounts {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
}

export interface BenchmarkPrecisionRecallF1 extends BenchmarkMetricCounts {
  precision: number;
  recall: number;
  f1: number;
}

export interface BenchmarkTypeAccuracy {
  matched: number;
  correct: number;
  accuracy: number;
}

export interface BenchmarkMatchedSpan {
  exampleId: string;
  gold: BenchmarkGoldSpan;
  detected: PiiSpan;
  overlapBytes: number;
  goldCoverage: number;
  detectionCoverage: number;
  typeCorrect: boolean;
}

export interface BenchmarkUnmatchedGoldSpan {
  exampleId: string;
  gold: BenchmarkGoldSpan;
}

export interface BenchmarkUnmatchedDetectedSpan {
  exampleId: string;
  detected: PiiSpan;
}

export interface BenchmarkNegativeBehavior {
  examples: number;
  passed: number;
  failed: number;
  passRate: number;
  falsePositiveRate: number;
  falsePositives: number;
}

export interface BenchmarkMiscBehavior {
  examples: number;
  goldSpans: number;
  metrics: BenchmarkPrecisionRecallF1;
  typeAccuracy: BenchmarkTypeAccuracy;
}

export interface BenchmarkScoreResult {
  options: Required<BenchmarkScorerOptions>;
  headline: BenchmarkPrecisionRecallF1;
  typeAccuracy: BenchmarkTypeAccuracy;
  byEntityType: Record<BenchmarkEntityType, BenchmarkPrecisionRecallF1>;
  byLanguage: Record<BenchmarkLanguage, BenchmarkPrecisionRecallF1>;
  byLengthBucket: Record<BenchmarkLengthBucket, BenchmarkPrecisionRecallF1>;
  negative: BenchmarkNegativeBehavior;
  misc: BenchmarkMiscBehavior;
  matches: BenchmarkMatchedSpan[];
  falseNegatives: BenchmarkUnmatchedGoldSpan[];
  falsePositives: BenchmarkUnmatchedDetectedSpan[];
  samples: {
    falseNegatives: BenchmarkUnmatchedGoldSpan[];
    falsePositives: BenchmarkUnmatchedDetectedSpan[];
  };
}

interface ScoreExampleResult {
  matches: BenchmarkMatchedSpan[];
  falseNegatives: BenchmarkUnmatchedGoldSpan[];
  falsePositives: BenchmarkUnmatchedDetectedSpan[];
}

interface MatchCandidate {
  goldIndex: number;
  detectionIndex: number;
  overlapBytes: number;
  goldCoverage: number;
  detectionCoverage: number;
  boundaryDrift: number;
  lengthDelta: number;
}

const DEFAULT_OPTIONS: Required<BenchmarkScorerOptions> = {
  boundaryToleranceBytes: 2,
  minGoldCoverage: 0.8,
  minDetectionCoverage: 0.5,
  sampleLimit: 5,
};

export function scoreBenchmarkDetections(
  examples: BenchmarkExample[],
  detectionsByExampleId: ReadonlyMap<string, readonly PiiSpan[]> | Record<string, readonly PiiSpan[]>,
  options: BenchmarkScorerOptions = {}
): BenchmarkScoreResult {
  const resolvedOptions = { ...DEFAULT_OPTIONS, ...options };
  const lookup = normalizeDetectionLookup(detectionsByExampleId);
  const headline = createCounts();
  const miscCounts = createCounts();
  const byEntityType = createTypedCountMap(BENCHMARK_ENTITY_TYPES);
  const byLanguage = createTypedCountMap(BENCHMARK_LANGUAGES);
  const byLengthBucket = createTypedCountMap(BENCHMARK_LENGTH_BUCKETS);
  const matches: BenchmarkMatchedSpan[] = [];
  const falseNegatives: BenchmarkUnmatchedGoldSpan[] = [];
  const falsePositives: BenchmarkUnmatchedDetectedSpan[] = [];
  const headlineMatches: BenchmarkMatchedSpan[] = [];
  const miscMatches: BenchmarkMatchedSpan[] = [];
  let negativeExamples = 0;
  let negativePassed = 0;
  let negativeFalsePositives = 0;
  let miscExamples = 0;
  let miscGoldSpans = 0;

  for (const example of examples) {
    const detectedSpans = [...(lookup.get(example.id) ?? [])];
    const scored = scoreExample(example, detectedSpans, resolvedOptions);
    const hasGold = example.goldSpans.length > 0;
    const isMiscExample = example.goldSpans.some((span) => span.entity_type === 'MISC');

    matches.push(...scored.matches);
    falseNegatives.push(...scored.falseNegatives);
    falsePositives.push(...scored.falsePositives);

    if (!hasGold) {
      negativeExamples += 1;
      negativeFalsePositives += scored.falsePositives.length;
      if (scored.falsePositives.length === 0) negativePassed += 1;
      continue;
    }

    if (isMiscExample) {
      miscExamples += 1;
      miscGoldSpans += example.goldSpans.length;
      miscMatches.push(...scored.matches);
      addExampleCounts(miscCounts, scored);
      continue;
    }

    addExampleCounts(headline, scored);
    headlineMatches.push(...scored.matches);
    addExampleCounts(byLanguage[example.language], scored);
    addExampleCounts(byLengthBucket[example.lengthBucket], scored);
    addEntityBreakdownCounts(byEntityType, scored);
  }

  return {
    options: resolvedOptions,
    headline: finalizeMetrics(headline),
    typeAccuracy: finalizeTypeAccuracy(headlineMatches),
    byEntityType: finalizeMetricMap(byEntityType),
    byLanguage: finalizeMetricMap(byLanguage),
    byLengthBucket: finalizeMetricMap(byLengthBucket),
    negative: {
      examples: negativeExamples,
      passed: negativePassed,
      failed: negativeExamples - negativePassed,
      passRate: ratio(negativePassed, negativeExamples),
      falsePositiveRate: ratio(negativeFalsePositives, negativeExamples),
      falsePositives: negativeFalsePositives,
    },
    misc: {
      examples: miscExamples,
      goldSpans: miscGoldSpans,
      metrics: finalizeMetrics(miscCounts),
      typeAccuracy: finalizeTypeAccuracy(miscMatches),
    },
    matches,
    falseNegatives,
    falsePositives,
    samples: {
      falseNegatives: falseNegatives.slice(0, resolvedOptions.sampleLimit),
      falsePositives: falsePositives.slice(0, resolvedOptions.sampleLimit),
    },
  };
}

export function scoreExample(
  example: BenchmarkExample,
  detectedSpans: readonly PiiSpan[],
  options: Required<BenchmarkScorerOptions> = DEFAULT_OPTIONS
): ScoreExampleResult {
  const candidates = buildCandidates(example.goldSpans, detectedSpans, options).sort(compareCandidates);
  const usedGold = new Set<number>();
  const usedDetections = new Set<number>();
  const matches: BenchmarkMatchedSpan[] = [];

  for (const candidate of candidates) {
    if (usedGold.has(candidate.goldIndex) || usedDetections.has(candidate.detectionIndex)) continue;

    usedGold.add(candidate.goldIndex);
    usedDetections.add(candidate.detectionIndex);
    const gold = example.goldSpans[candidate.goldIndex];
    const detected = detectedSpans[candidate.detectionIndex];
    matches.push({
      exampleId: example.id,
      gold,
      detected,
      overlapBytes: candidate.overlapBytes,
      goldCoverage: candidate.goldCoverage,
      detectionCoverage: candidate.detectionCoverage,
      typeCorrect: gold.entity_type === detected.entity_type,
    });
  }

  return {
    matches,
    falseNegatives: example.goldSpans
      .map((gold, index) => ({ gold, index }))
      .filter(({ index }) => !usedGold.has(index))
      .map(({ gold }) => ({ exampleId: example.id, gold })),
    falsePositives: detectedSpans
      .map((detected, index) => ({ detected, index }))
      .filter(({ index }) => !usedDetections.has(index))
      .map(({ detected }) => ({ exampleId: example.id, detected })),
  };
}

function buildCandidates(
  goldSpans: readonly BenchmarkGoldSpan[],
  detectedSpans: readonly PiiSpan[],
  options: Required<BenchmarkScorerOptions>
): MatchCandidate[] {
  const candidates: MatchCandidate[] = [];

  goldSpans.forEach((gold, goldIndex) => {
    detectedSpans.forEach((detected, detectionIndex) => {
      const overlapBytes = spanOverlapBytes(gold, detected);
      if (overlapBytes <= 0) return;

      const goldLength = spanLength(gold);
      const detectionLength = spanLength(detected);
      const goldCoverage = overlapBytes / goldLength;
      const detectionCoverage = overlapBytes / detectionLength;
      const boundaryDrift = Math.max(
        Math.max(0, detected.start - gold.start),
        Math.max(0, gold.end - detected.end)
      );

      if (
        boundaryDrift > options.boundaryToleranceBytes ||
        goldCoverage < options.minGoldCoverage ||
        detectionCoverage < options.minDetectionCoverage
      ) {
        return;
      }

      candidates.push({
        goldIndex,
        detectionIndex,
        overlapBytes,
        goldCoverage,
        detectionCoverage,
        boundaryDrift,
        lengthDelta: Math.abs(detectionLength - goldLength),
      });
    });
  });

  return candidates;
}

function compareCandidates(a: MatchCandidate, b: MatchCandidate): number {
  return (
    b.goldCoverage - a.goldCoverage ||
    b.detectionCoverage - a.detectionCoverage ||
    a.boundaryDrift - b.boundaryDrift ||
    a.lengthDelta - b.lengthDelta ||
    a.goldIndex - b.goldIndex ||
    a.detectionIndex - b.detectionIndex
  );
}

function addExampleCounts(counts: BenchmarkMetricCounts, scored: ScoreExampleResult): void {
  counts.truePositives += scored.matches.length;
  counts.falseNegatives += scored.falseNegatives.length;
  counts.falsePositives += scored.falsePositives.length;
}

function addEntityBreakdownCounts(
  countsByEntityType: Record<BenchmarkEntityType, BenchmarkMetricCounts>,
  scored: ScoreExampleResult
): void {
  for (const match of scored.matches) {
    countsByEntityType[match.gold.entity_type].truePositives += 1;
  }
  for (const falseNegative of scored.falseNegatives) {
    countsByEntityType[falseNegative.gold.entity_type].falseNegatives += 1;
  }
  for (const falsePositive of scored.falsePositives) {
    countsByEntityType[falsePositive.detected.entity_type].falsePositives += 1;
  }
}

function finalizeMetricMap<T extends string>(counts: Record<T, BenchmarkMetricCounts>): Record<T, BenchmarkPrecisionRecallF1> {
  const metrics = {} as Record<T, BenchmarkPrecisionRecallF1>;
  for (const key of Object.keys(counts) as T[]) {
    metrics[key] = finalizeMetrics(counts[key]);
  }
  return metrics;
}

function finalizeMetrics(counts: BenchmarkMetricCounts): BenchmarkPrecisionRecallF1 {
  const precision = ratio(counts.truePositives, counts.truePositives + counts.falsePositives);
  const recall = ratio(counts.truePositives, counts.truePositives + counts.falseNegatives);
  return {
    ...counts,
    precision,
    recall,
    f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
  };
}

function finalizeTypeAccuracy(matches: readonly BenchmarkMatchedSpan[]): BenchmarkTypeAccuracy {
  const correct = matches.filter((match) => match.typeCorrect).length;
  return {
    matched: matches.length,
    correct,
    accuracy: ratio(correct, matches.length),
  };
}

function normalizeDetectionLookup(
  detectionsByExampleId: ReadonlyMap<string, readonly PiiSpan[]> | Record<string, readonly PiiSpan[]>
): ReadonlyMap<string, readonly PiiSpan[]> {
  if (detectionsByExampleId instanceof Map) return detectionsByExampleId;
  return new Map(Object.entries(detectionsByExampleId));
}

function createTypedCountMap<T extends string>(keys: readonly T[]): Record<T, BenchmarkMetricCounts> {
  const counts = {} as Record<T, BenchmarkMetricCounts>;
  for (const key of keys) {
    counts[key] = createCounts();
  }
  return counts;
}

function createCounts(): BenchmarkMetricCounts {
  return { truePositives: 0, falsePositives: 0, falseNegatives: 0 };
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function spanOverlapBytes(
  a: Pick<BenchmarkGoldSpan, 'start' | 'end'>,
  b: Pick<PiiSpan, 'start' | 'end'>
): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

function spanLength(span: Pick<BenchmarkGoldSpan | PiiSpan, 'start' | 'end'>): number {
  return Math.max(1, span.end - span.start);
}
