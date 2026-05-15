#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_CACHE_DIR = path.join(ROOT, 'benchmarks', 'cache', 'openpii');
const DEFAULT_OUTPUT = path.join(ROOT, 'benchmarks', 'corpora', 'openpii-generated.jsonl');
const DEFAULT_LIMIT = 500;
const DEFAULT_NEGATIVE_TARGET = 25;
const DEFAULT_MISC_TARGET = 50;
const SUPPORTED_ENTITY_TYPES = [
  'ADDRESS',
  'CREDIT_CARD',
  'DATE',
  'EMAIL',
  'LOCATION',
  'PERSON',
  'PHONE',
  'SSN',
];
const LANGUAGES = ['en', 'de'];
const LENGTH_BUCKETS = [
  { id: 'short', maxChars: 120 },
  { id: 'medium', maxChars: 260 },
  { id: 'long', maxChars: Infinity },
];

function usage() {
  return `
Build a benchmark corpus from AI4Privacy OpenPII JSONL exports.

Usage:
  node scripts/build-openpii-corpus.js [--input <path> ...] [--cache-dir <path>] [--out <path>] [--limit <n|all>]

Options:
  --input <path>           Local OpenPII JSONL or JSON export. Repeatable. Defaults to cached manifest files.
  --cache-dir <path>       Cache directory containing manifest.json. Default: benchmarks/cache/openpii
  --out <path>             Output JSONL corpus. Default: benchmarks/corpora/openpii-generated.jsonl
  --limit <n|all>          Maximum examples after filtering. Default: ${DEFAULT_LIMIT}
  --sample <mode>          Sampling mode: coverage or first. Default: coverage
  --negative-target <n>    Desired negative examples for coverage sampling. Default: ${DEFAULT_NEGATIVE_TARGET}
  --misc-target <n>        Desired MISC-bucket examples for coverage sampling. Default: ${DEFAULT_MISC_TARGET}
  --corpus-id <id>         Corpus id for metadata. Default: openpii-generated-v1
  --description <text>     Human-readable corpus description.
  --source-revision <rev>  Source revision recorded in metadata.
  --help                   Show this help.
`.trim();
}

function parseArgs(argv) {
  const options = {
    inputs: [],
    cacheDir: DEFAULT_CACHE_DIR,
    out: DEFAULT_OUTPUT,
    limit: DEFAULT_LIMIT,
    sample: 'coverage',
    negativeTarget: DEFAULT_NEGATIVE_TARGET,
    miscTarget: DEFAULT_MISC_TARGET,
    corpusId: 'openpii-generated-v1',
    description: undefined,
    sourceRevision: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
      index += 1;
      return value;
    };

    switch (arg) {
      case '--input':
        options.inputs.push(path.resolve(ROOT, next()));
        break;
      case '--cache-dir':
        options.cacheDir = path.resolve(ROOT, next());
        break;
      case '--out':
        options.out = path.resolve(ROOT, next());
        break;
      case '--limit': {
        const value = next();
        options.limit = value === 'all' ? Infinity : Number(value);
        if (!Number.isFinite(options.limit) && value !== 'all') throw new Error('--limit must be a number or all.');
        break;
      }
      case '--sample':
        options.sample = next();
        if (!['coverage', 'first'].includes(options.sample)) {
          throw new Error('--sample must be coverage or first.');
        }
        break;
      case '--negative-target':
        options.negativeTarget = parseNonNegativeInteger(next(), '--negative-target');
        break;
      case '--misc-target':
        options.miscTarget = parseNonNegativeInteger(next(), '--misc-target');
        break;
      case '--corpus-id':
        options.corpusId = next();
        break;
      case '--description':
        options.description = next();
        break;
      case '--source-revision':
        options.sourceRevision = next();
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function parseNonNegativeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative integer.`);
  return parsed;
}

function registerTypeScript() {
  require.extensions['.ts'] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;

    module._compile(output, filename);
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  registerTypeScript();
  const {
    OPENPII_DATASET_ID,
    OPENPII_DATASET_URL,
    createOpenPiiMetadata,
    openPiiRecordToBenchmarkExample,
  } = require('../src/benchmark/openpii-builder.ts');
  const { parseBenchmarkCorpusJsonl } = require('../src/benchmark/contracts.ts');
  const manifest = loadManifest(options.cacheDir);
  const inputs = options.inputs.length > 0 ? options.inputs : inputsFromManifest(manifest);
  if (inputs.length === 0) {
    throw new Error('No OpenPII input files found. Run the download script or pass --input <path>.');
  }

  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  const metadata = createOpenPiiMetadata({
    corpusId: options.corpusId,
    description: options.description,
    sourceName: manifest?.dataset ?? OPENPII_DATASET_ID,
    sourceUrl: manifest?.sourceUrl ?? OPENPII_DATASET_URL,
    sourceDatasetId: manifest?.dataset ?? OPENPII_DATASET_ID,
    sourceRevision: options.sourceRevision ?? manifest?.resolvedRevision ?? manifest?.revision,
    sourceSnapshotPath: manifest?.cacheDir,
    sourceDownloadedAt: manifest?.downloadedAt,
    sourceExportPath: inputs.map((input) => path.relative(ROOT, input)).join(','),
  });

  let sourceRow = 0;
  const readStats = { repairedRecords: 0 };
  const examples = [];
  const coverageSampler =
    options.sample === 'coverage' && Number.isFinite(options.limit)
      ? createCoverageSampler({
          limit: options.limit,
          negativeTarget: options.negativeTarget,
          miscTarget: options.miscTarget,
        })
      : null;
  for (const input of inputs) {
    for await (const record of readOpenPiiRecords(input, readStats)) {
      const example = openPiiRecordToBenchmarkExample(record, sourceRow);
      sourceRow += 1;
      if (!example) continue;

      if (coverageSampler) {
        addExampleToCoverageSampler(coverageSampler, example);
      } else {
        examples.push(example);
        if (options.sample === 'first' && examples.length >= options.limit) break;
      }
    }
    if (options.sample === 'first' && examples.length >= options.limit) break;
  }

  const sampledExamples = coverageSampler
    ? finishCoverageSampler(coverageSampler)
    : examples.slice(0, options.limit);

  metadata.curation = summarizeSample(sampledExamples, {
    strategy: options.sample,
    limit: options.limit,
    negativeTarget: options.negativeTarget,
    miscTarget: options.miscTarget,
  });

  const tempOut = `${options.out}.tmp`;
  const out = fs.createWriteStream(tempOut);
  out.write(`${JSON.stringify(metadata)}\n`);
  for (const example of sampledExamples) {
    out.write(`${JSON.stringify(example)}\n`);
  }

  await new Promise((resolve, reject) => {
    out.end(resolve);
    out.on('error', reject);
  });

  const corpusText = fs.readFileSync(tempOut, 'utf8');
  parseBenchmarkCorpusJsonl(corpusText);
  fs.renameSync(tempOut, options.out);
  process.stdout.write(`Wrote ${sampledExamples.length} examples to ${path.relative(ROOT, options.out)}\n`);
  if (options.sample === 'coverage' && Number.isFinite(options.limit)) {
    process.stdout.write(formatSampleSummary(metadata.curation));
  }
  if (readStats.repairedRecords > 0) {
    process.stdout.write(`Repaired ${readStats.repairedRecords} OpenPII JSONL records with embedded raw line breaks.\n`);
  }
}

function selectCoverageSample(examples, options) {
  const sampler = createCoverageSampler(options);
  for (const example of examples) {
    addExampleToCoverageSampler(sampler, example);
  }
  return finishCoverageSampler(sampler);
}

function createCoverageSampler(options) {
  const limit = Math.max(0, options.limit);
  const negativeTarget = Math.min(options.negativeTarget, limit);
  const miscTarget = Math.min(options.miscTarget, limit - negativeTarget);
  const supportedTarget = Math.max(0, limit - negativeTarget - miscTarget);
  const targets = {
    negative: negativeTarget,
    misc: miscTarget,
    supported: supportedTarget,
  };

  const selected = [];
  const selectedIds = new Set();
  const counts = {
    negative: new Map(),
    misc: new Map(),
    supported: new Map(),
  };
  const categoryCounts = {
    negative: 0,
    misc: 0,
    supported: 0,
  };

  return {
    limit,
    targets,
    selected,
    selectedIds,
    counts,
    categoryCounts,
    reserves: [],
  };
}

function addExampleToCoverageSampler(sampler, example) {
  if (sampler.limit === 0) return;
  const placement = choosePlacement(example, sampler.counts, sampler.categoryCounts, sampler.targets);
  if (placement) {
    addSelected(example, placement, sampler.selected, sampler.selectedIds, sampler.counts, sampler.categoryCounts);
    return;
  }

  if (!sampler.selectedIds.has(example.id) && sampler.reserves.length < sampler.limit * 4) {
    sampler.reserves.push(example);
  }
}

function finishCoverageSampler(sampler) {
  for (const example of sampler.reserves) {
    if (sampler.selected.length >= sampler.limit) break;
    if (sampler.selectedIds.has(example.id)) continue;
    sampler.selected.push(example);
    sampler.selectedIds.add(example.id);
  }

  return sampler.selected.slice(0, sampler.limit).sort(compareExamplesForStableCorpus);
}

function choosePlacement(example, counts, categoryCounts, targets) {
  const lengthBucket = lengthBucketFor(example.text);
  const spanTypes = [...new Set(example.goldSpans.map((span) => span.entity_type))].sort();

  if (spanTypes.length === 0) {
    return chooseBucketPlacement(
      'negative',
      `${example.language}:${lengthBucket}`,
      negativeBucketKeys(),
      counts,
      categoryCounts,
      targets
    );
  }

  if (spanTypes.includes('MISC')) {
    return chooseBucketPlacement(
      'misc',
      `${example.language}:${lengthBucket}`,
      miscBucketKeys(),
      counts,
      categoryCounts,
      targets
    );
  }

  const eligibleSupportedTypes = spanTypes.filter((type) => SUPPORTED_ENTITY_TYPES.includes(type));
  const placements = eligibleSupportedTypes
    .map((type) => ({
      category: 'supported',
      key: `${example.language}:${type}:${lengthBucket}`,
      keys: supportedBucketKeys(),
    }))
    .map((placement) => ({
      ...placement,
      bucketCount: counts.supported.get(placement.key) ?? 0,
      bucketLimit: bucketLimit(placement.key, targets.supported, placement.keys),
    }))
    .filter((placement) => placement.bucketCount < placement.bucketLimit);

  if (categoryCounts.supported >= targets.supported || placements.length === 0) return null;
  placements.sort(
    (a, b) =>
      a.bucketCount - b.bucketCount ||
      a.bucketLimit - b.bucketLimit ||
      a.key.localeCompare(b.key)
  );
  return { category: 'supported', key: placements[0].key };
}

function chooseBucketPlacement(category, key, keys, counts, categoryCounts, targets) {
  if (categoryCounts[category] >= targets[category]) return null;
  const count = counts[category].get(key) ?? 0;
  if (count >= bucketLimit(key, targets[category], keys)) return null;
  return { category, key };
}

function addSelected(example, placement, selected, selectedIds, counts, categoryCounts) {
  if (selectedIds.has(example.id)) return;
  selected.push(example);
  selectedIds.add(example.id);
  counts[placement.category].set(
    placement.key,
    (counts[placement.category].get(placement.key) ?? 0) + 1
  );
  categoryCounts[placement.category] += 1;
}

function bucketLimit(key, target, keys) {
  if (target <= 0) return 0;
  if (target < keys.length) return keys.includes(key) ? 1 : 0;
  const base = Math.floor(target / keys.length);
  const remainder = target % keys.length;
  const index = keys.indexOf(key);
  if (index === -1) return 0;
  return base + (index < remainder ? 1 : 0);
}

function supportedBucketKeys() {
  return LANGUAGES.flatMap((language) =>
    SUPPORTED_ENTITY_TYPES.flatMap((type) =>
      LENGTH_BUCKETS.map((bucket) => `${language}:${type}:${bucket.id}`)
    )
  );
}

function miscBucketKeys() {
  return LANGUAGES.flatMap((language) => LENGTH_BUCKETS.map((bucket) => `${language}:${bucket.id}`));
}

function negativeBucketKeys() {
  return miscBucketKeys();
}

function lengthBucketFor(text) {
  return LENGTH_BUCKETS.find((bucket) => text.length <= bucket.maxChars)?.id ?? 'long';
}

function summarizeSample(examples, options) {
  const byLanguage = {};
  const byLengthBucket = {};
  const byEntityType = {};
  let negativeExamples = 0;
  let miscExamples = 0;

  for (const example of examples) {
    byLanguage[example.language] = (byLanguage[example.language] ?? 0) + 1;
    const lengthBucket = lengthBucketFor(example.text);
    byLengthBucket[lengthBucket] = (byLengthBucket[lengthBucket] ?? 0) + 1;
    const spanTypes = [...new Set(example.goldSpans.map((span) => span.entity_type))].sort();
    if (spanTypes.length === 0) negativeExamples += 1;
    if (spanTypes.includes('MISC')) miscExamples += 1;
    for (const type of spanTypes) {
      byEntityType[type] = (byEntityType[type] ?? 0) + 1;
    }
  }

  return {
    strategy: options.strategy,
    targetExamples: Number.isFinite(options.limit) ? options.limit : examples.length,
    negativeTarget: options.negativeTarget,
    miscTarget: options.miscTarget,
    lengthBuckets: LENGTH_BUCKETS.map((bucket) => ({
      id: bucket.id,
      maxChars: Number.isFinite(bucket.maxChars) ? bucket.maxChars : null,
    })),
    byLanguage,
    byLengthBucket,
    byEntityType,
    negativeExamples,
    miscExamples,
  };
}

function formatSampleSummary(summary) {
  const language = Object.entries(summary.byLanguage)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
  const lengths = Object.entries(summary.byLengthBucket)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
  const types = Object.entries(summary.byEntityType)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
  return [
    `Sample summary: ${language || 'none'}`,
    `Length buckets: ${lengths || 'none'}`,
    `Entity buckets: ${types || 'none'}`,
    `Negative examples: ${summary.negativeExamples}`,
    `MISC-bucket examples: ${summary.miscExamples}`,
  ].join('\n') + '\n';
}

function compareExamplesForStableCorpus(left, right) {
  return (
    left.language.localeCompare(right.language) ||
    String(left.source.sourceFile ?? '').localeCompare(String(right.source.sourceFile ?? '')) ||
    Number(left.source.sourceRow ?? 0) - Number(right.source.sourceRow ?? 0) ||
    left.id.localeCompare(right.id)
  );
}

function loadManifest(cacheDir) {
  const manifestPath = path.join(cacheDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function inputsFromManifest(manifest) {
  if (!manifest?.files) return [];
  return manifest.files.map((file) => path.resolve(ROOT, file.path));
}

async function* readOpenPiiRecords(input, stats = { repairedRecords: 0 }) {
  const sourceFile = path.relative(ROOT, input);
  if (input.endsWith('.json')) {
    const parsed = JSON.parse(fs.readFileSync(input, 'utf8'));
    const records = Array.isArray(parsed) ? parsed : parsed.data ?? parsed.records ?? [];
    for (const [index, record] of records.entries()) {
      yield { ...record, sourceFile, sourceRow: index + 1 };
    }
    return;
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(input, 'utf8'),
    crlfDelay: Infinity,
  });

  let lineNumber = 0;
  let logicalStartLine = 0;
  let physicalLines = 0;
  let bufferedRecord = '';
  for await (const line of rl) {
    lineNumber += 1;
    if (!bufferedRecord && !line.trim()) continue;

    if (!bufferedRecord) {
      logicalStartLine = lineNumber;
      physicalLines = 1;
      bufferedRecord = line;
    } else {
      physicalLines += 1;
      bufferedRecord += `\\n${line}`;
    }

    try {
      const parsed = JSON.parse(bufferedRecord);
      if (physicalLines > 1) stats.repairedRecords += 1;
      yield { ...parsed, sourceFile, sourceRow: logicalStartLine };
      bufferedRecord = '';
      physicalLines = 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isRecoverableJsonlContinuationError(message) && physicalLines < 50) continue;
      throw new Error(`${path.relative(ROOT, input)}:${logicalStartLine}: ${message}`);
    }
  }

  if (bufferedRecord) {
    throw new Error(`${path.relative(ROOT, input)}:${logicalStartLine}: reached end of file inside an incomplete JSON record.`);
  }
}

function isRecoverableJsonlContinuationError(message) {
  return (
    message.includes('Unterminated string') ||
    message.includes('Unexpected end of JSON input')
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
