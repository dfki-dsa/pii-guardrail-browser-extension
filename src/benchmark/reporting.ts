import type { BenchmarkExample, BenchmarkGoldSpan } from './contracts';
import {
  scoreBenchmarkDetections,
  type BenchmarkMatchedSpan,
  type BenchmarkPrecisionRecallF1,
  type BenchmarkScoreResult,
  type BenchmarkUnmatchedDetectedSpan,
  type BenchmarkUnmatchedGoldSpan,
  type BenchmarkTypeAccuracy,
} from './scorer';
import type { BenchmarkDetectionRunResult } from './detection-harness';
import type { EntityType, PiiSpan } from '../shared/message-types';

export interface BenchmarkLatencySummary {
  totalWallMs: number;
  perExampleMs: LatencyDistribution;
  nerMs?: LatencyDistribution;
  modelLoadMs?: number;
}

export interface LatencyDistribution {
  count: number;
  totalMs: number;
  averageMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface BenchmarkReportSample {
  exampleId: string;
  entityType: EntityType;
  spanText: string;
  start: number;
  end: number;
  context: string;
  detectedEntityType?: EntityType;
  score?: number;
}

export interface BenchmarkExampleReport {
  id: string;
  language: BenchmarkExample['language'];
  lengthBucket: BenchmarkExample['lengthBucket'];
  goldSpans: BenchmarkGoldSpan[];
  detectedSpans: PiiSpan[];
  timings: BenchmarkDetectionRunResult['examples'][number]['timings'];
  matches: BenchmarkMatchedSpan[];
  falseNegatives: BenchmarkUnmatchedGoldSpan[];
  falsePositives: BenchmarkUnmatchedDetectedSpan[];
}

export interface BenchmarkReport {
  corpus: BenchmarkDetectionRunResult['corpus'];
  mode: BenchmarkDetectionRunResult['mode'];
  config: BenchmarkDetectionRunResult['config'];
  provider: BenchmarkDetectionRunResult['provider'];
  score: BenchmarkScoreResult;
  latency: BenchmarkLatencySummary;
  samples: {
    falseNegatives: BenchmarkReportSample[];
    falsePositives: BenchmarkReportSample[];
  };
  examples: BenchmarkExampleReport[];
}

export function createBenchmarkReport(result: BenchmarkDetectionRunResult): BenchmarkReport {
  const detectionsByExampleId = new Map(
    result.examples.map((example) => [example.id, example.spans] as const)
  );
  const score = scoreBenchmarkDetections(result.sourceExamples, detectionsByExampleId);
  const examplesById = new Map(result.sourceExamples.map((example) => [example.id, example] as const));
  const matchesById = groupByExampleId(score.matches);
  const falseNegativesById = groupByExampleId(score.falseNegatives);
  const falsePositivesById = groupByExampleId(score.falsePositives);

  return {
    corpus: result.corpus,
    mode: result.mode,
    config: result.config,
    provider: result.provider,
    score,
    latency: summarizeLatency(result),
    samples: {
      falseNegatives: score.samples.falseNegatives.map((sample) =>
        formatFalseNegativeSample(requireExample(examplesById, sample.exampleId), sample)
      ),
      falsePositives: score.samples.falsePositives.map((sample) =>
        formatFalsePositiveSample(requireExample(examplesById, sample.exampleId), sample)
      ),
    },
    examples: result.sourceExamples.map((example) => {
      const detected = result.examples.find((item) => item.id === example.id);
      return {
        id: example.id,
        language: example.language,
        lengthBucket: example.lengthBucket,
        goldSpans: example.goldSpans,
        detectedSpans: detected?.spans ?? [],
        timings: detected?.timings ?? { totalMs: 0 },
        matches: matchesById.get(example.id) ?? [],
        falseNegatives: falseNegativesById.get(example.id) ?? [],
        falsePositives: falsePositivesById.get(example.id) ?? [],
      };
    }),
  };
}

export function formatBenchmarkReport(report: BenchmarkReport): string {
  return [
    'OpenPII benchmark',
    `Corpus: ${report.corpus.metadata.corpusId} (${report.corpus.exampleCount} examples, schema ${report.corpus.metadata.schemaVersion})`,
    `Source: ${report.corpus.metadata.source.datasetId}${report.corpus.metadata.source.revision ? ` @ ${report.corpus.metadata.source.revision}` : ''}`,
    `Offsets: ${report.corpus.metadata.spanOffsetUnit}; scoring: ${report.corpus.metadata.scoring}`,
    '',
    'Effective config',
    `Mode: ${report.mode}`,
    `Provider: ${report.config.ner_provider}; model: ${report.config.ner_model}; NER enabled: ${report.config.ner_enabled ? 'yes' : 'no'}`,
    `Min confidence: ${formatNumber(report.config.min_confidence)}; context boost: ${formatNumber(report.config.context_boost)}; context window: ${report.config.context_window}`,
    `Provider status: ${report.provider.state}${report.provider.message ? ` (${report.provider.message})` : ''}`,
    '',
    'Headline quality',
    `Micro span P/R/F1: ${formatPercent(report.score.headline.precision)} / ${formatPercent(report.score.headline.recall)} / ${formatPercent(report.score.headline.f1)} (${formatCounts(report.score.headline)})`,
    `Type accuracy on matched spans: ${formatTypeAccuracy(report.score.typeAccuracy)}`,
    '',
    'Breakdowns',
    `Language: ${formatMetricMap(report.score.byLanguage)}`,
    `Length: ${formatMetricMap(report.score.byLengthBucket)}`,
    `Entity: ${formatMetricMap(report.score.byEntityType, { onlyNonZero: true }) || 'no scored entity spans'}`,
    '',
    'Negative and miscellaneous',
    `Negative examples: ${report.score.negative.passed}/${report.score.negative.examples} passed (${formatPercent(report.score.negative.passRate)}); false positives/example ${formatNumber(report.score.negative.falsePositiveRate)}`,
    `Misc bucket: ${report.score.misc.examples} examples, ${report.score.misc.goldSpans} gold spans, F1 ${formatPercent(report.score.misc.metrics.f1)}, type accuracy ${formatTypeAccuracy(report.score.misc.typeAccuracy)}`,
    '',
    'Latency',
    `Total wall time: ${formatMs(report.latency.totalWallMs)}`,
    `Per example: avg ${formatMs(report.latency.perExampleMs.averageMs)}, p50 ${formatMs(report.latency.perExampleMs.p50Ms)}, p95 ${formatMs(report.latency.perExampleMs.p95Ms)}, max ${formatMs(report.latency.perExampleMs.maxMs)}`,
    report.latency.nerMs
      ? `NER timing: avg ${formatMs(report.latency.nerMs.averageMs)}, p50 ${formatMs(report.latency.nerMs.p50Ms)}, p95 ${formatMs(report.latency.nerMs.p95Ms)}, max ${formatMs(report.latency.nerMs.maxMs)}`
      : 'NER timing: unavailable',
    typeof report.latency.modelLoadMs === 'number'
      ? `Last provider model load: ${formatMs(report.latency.modelLoadMs)}`
      : 'Last provider model load: unavailable',
    '',
    'False negative samples',
    formatSamples(report.samples.falseNegatives, 'none'),
    '',
    'False positive samples',
    formatSamples(report.samples.falsePositives, 'none'),
  ].join('\n');
}

function summarizeLatency(result: BenchmarkDetectionRunResult): BenchmarkLatencySummary {
  const nerValues = result.examples
    .map((example) => example.timings.nerMs)
    .filter((value): value is number => typeof value === 'number');

  return {
    totalWallMs: result.timings.totalWallMs,
    perExampleMs: distribution(result.examples.map((example) => example.timings.totalMs)),
    ...(nerValues.length > 0 ? { nerMs: distribution(nerValues) } : {}),
    ...(typeof result.provider.timings?.loadMs === 'number'
      ? { modelLoadMs: result.provider.timings.loadMs }
      : {}),
  };
}

function distribution(values: readonly number[]): LatencyDistribution {
  const sorted = [...values].sort((a, b) => a - b);
  const totalMs = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    totalMs,
    averageMs: sorted.length === 0 ? 0 : totalMs / sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted.at(-1) ?? 0,
  };
}

function percentile(sortedValues: readonly number[], percentileRank: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * percentileRank) - 1));
  return sortedValues[index];
}

function groupByExampleId<T extends { exampleId: string }>(items: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const bucket = grouped.get(item.exampleId) ?? [];
    bucket.push(item);
    grouped.set(item.exampleId, bucket);
  }
  return grouped;
}

function requireExample(examplesById: ReadonlyMap<string, BenchmarkExample>, id: string): BenchmarkExample {
  const example = examplesById.get(id);
  if (!example) throw new Error(`Missing benchmark example "${id}" while formatting report.`);
  return example;
}

function formatFalseNegativeSample(
  example: BenchmarkExample,
  sample: BenchmarkUnmatchedGoldSpan
): BenchmarkReportSample {
  return {
    exampleId: sample.exampleId,
    entityType: sample.gold.entity_type,
    spanText: sample.gold.text,
    start: sample.gold.start,
    end: sample.gold.end,
    context: compactContext(example.text, sample.gold.text),
  };
}

function formatFalsePositiveSample(
  example: BenchmarkExample,
  sample: BenchmarkUnmatchedDetectedSpan
): BenchmarkReportSample {
  return {
    exampleId: sample.exampleId,
    entityType: sample.detected.entity_type,
    detectedEntityType: sample.detected.entity_type,
    spanText: sample.detected.text,
    start: sample.detected.start,
    end: sample.detected.end,
    score: sample.detected.score,
    context: compactContext(example.text, sample.detected.text),
  };
}

function compactContext(text: string, spanText: string, radius = 48): string {
  const compactText = text.replace(/\s+/g, ' ').trim();
  const compactSpan = spanText.replace(/\s+/g, ' ').trim();
  const index = compactSpan.length > 0 ? compactText.indexOf(compactSpan) : -1;
  if (index < 0) return truncate(compactText, radius * 2);

  const start = Math.max(0, index - radius);
  const end = Math.min(compactText.length, index + compactSpan.length + radius);
  return `${start > 0 ? '...' : ''}${compactText.slice(start, end)}${end < compactText.length ? '...' : ''}`;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatMetricMap<T extends string>(
  metrics: Record<T, BenchmarkPrecisionRecallF1>,
  options: { onlyNonZero?: boolean } = {}
): string {
  return (Object.entries(metrics) as [T, BenchmarkPrecisionRecallF1][])
    .filter(([, metric]) => !options.onlyNonZero || metric.truePositives + metric.falsePositives + metric.falseNegatives > 0)
    .map(([key, metric]) => `${key} ${formatPercent(metric.f1)} (${formatCounts(metric)})`)
    .join('; ');
}

function formatSamples(samples: readonly BenchmarkReportSample[], emptyText: string): string {
  if (samples.length === 0) return emptyText;
  return samples
    .map((sample) => {
      const detected = sample.detectedEntityType && sample.detectedEntityType !== sample.entityType
        ? `, detected ${sample.detectedEntityType}`
        : '';
      const score = typeof sample.score === 'number' ? `, score ${formatNumber(sample.score)}` : '';
      return `- ${sample.exampleId} ${sample.entityType} "${truncate(sample.spanText, 60)}" [${sample.start}-${sample.end}${detected}${score}] :: ${sample.context}`;
    })
    .join('\n');
}

function formatCounts(metric: BenchmarkPrecisionRecallF1): string {
  return `TP ${metric.truePositives}, FP ${metric.falsePositives}, FN ${metric.falseNegatives}`;
}

function formatTypeAccuracy(typeAccuracy: BenchmarkTypeAccuracy): string {
  return `${formatPercent(typeAccuracy.accuracy)} (${typeAccuracy.correct}/${typeAccuracy.matched})`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number | undefined): string {
  return typeof value === 'number' ? Number(value.toFixed(3)).toString() : 'n/a';
}

function formatMs(value: number): string {
  return `${Math.round(value)} ms`;
}
