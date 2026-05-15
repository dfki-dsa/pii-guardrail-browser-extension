import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createBenchmarkDetectionConfig,
  parseBenchmarkCliArgs,
  runBenchmarkDetection,
  validateBenchmarkModelAssets,
} from '../../src/benchmark/detection-harness';
import type { BenchmarkCorpusMetadata, BenchmarkExample } from '../../src/benchmark/contracts';
import { stringIndexToByteOffset } from '../../src/shared/text-offsets';

function metadata(): BenchmarkCorpusMetadata {
  return {
    recordType: 'metadata',
    schemaVersion: 1,
    corpusId: 'harness-fixture',
    description: 'Detection harness fixture',
    createdAt: '2026-05-04T00:00:00.000Z',
    source: {
      name: 'fixture',
      url: 'https://example.test/openpii',
      datasetId: 'fixture/openpii',
    },
    spanOffsetUnit: 'utf8-bytes',
    scoring: 'span-tolerant-v1',
  };
}

function example(id: string, text: string): BenchmarkExample {
  const pii = 'Ada Lovelace';
  const start = stringIndexToByteOffset(text, text.indexOf(pii));
  const end = start + stringIndexToByteOffset(pii, pii.length);

  return {
    recordType: 'example',
    id,
    language: 'en',
    lengthBucket: 'short',
    text,
    goldSpans: [{ start, end, entity_type: 'PERSON', text: pii }],
    source: {
      dataset: 'fixture/openpii',
      recordId: id,
      split: 'validation',
      sourceRow: Number(id.replace(/\D/g, '')) || 0,
    },
  };
}

function writeCorpus(root: string): string {
  const corpusPath = path.join(root, 'corpus.jsonl');
  const records = [
    metadata(),
    example('example-1', 'Ada Lovelace can be reached at ada@example.test.'),
    example('example-2', 'Please ask Ada Lovelace for approval.'),
  ];
  fs.writeFileSync(corpusPath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
  return corpusPath;
}

describe('benchmark detection harness', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-benchmark-harness-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('parses documented CLI arguments', () => {
    expect(
      parseBenchmarkCliArgs(
        ['--corpus', 'fixtures/corpus.jsonl', '--model', 'bardsai', '--out', 'out/report.json'],
        tempRoot
      )
    ).toEqual(
      expect.objectContaining({
        corpusPath: path.join(tempRoot, 'fixtures/corpus.jsonl'),
        model: 'bardsai',
        outputPath: path.join(tempRoot, 'out/report.json'),
        regexOnly: false,
      })
    );
  });

  test('rejects unknown model names clearly', () => {
    expect(() => parseBenchmarkCliArgs(['--model', 'missing'], tempRoot)).toThrow(
      /Unknown model "missing"/
    );
  });

  test('creates explicit regex-only config that disables NER', () => {
    expect(createBenchmarkDetectionConfig({ model: 'ai4privacy', regexOnly: true })).toEqual(
      expect.objectContaining({
        ner_provider: 'off',
        ner_model: 'ai4privacy',
        ner_enabled: false,
        min_confidence: expect.any(Number),
      })
    );
  });

  test('fails model-backed runs before detection when local model assets are missing', () => {
    expect(() => validateBenchmarkModelAssets(tempRoot, 'ai4privacy')).toThrow(
      /Missing local NER assets for model "ai4privacy".*--regex-only/
    );
  });

  test('aborts model-backed runs when the NER provider becomes unavailable on the first example', async () => {
    const corpusPath = writeCorpus(tempRoot);
    const modelDir = path.join(tempRoot, 'generated', 'models', 'ner', 'ai4privacy', 'onnx');
    fs.mkdirSync(modelDir, { recursive: true });
    fs.writeFileSync(path.join(modelDir, '..', 'config.json'), '{}');
    fs.writeFileSync(path.join(modelDir, '..', 'tokenizer.json'), '{}');
    fs.writeFileSync(path.join(modelDir, '..', 'tokenizer_config.json'), '{}');
    fs.writeFileSync(path.join(modelDir, 'model_quantized.onnx'), 'stub');
    const ortDir = path.join(tempRoot, 'node_modules', 'onnxruntime-web', 'dist');
    fs.mkdirSync(ortDir, { recursive: true });
    for (const fileName of [
      'ort-wasm-simd-threaded.mjs',
      'ort-wasm-simd-threaded.wasm',
      'ort-wasm-simd-threaded.asyncify.mjs',
      'ort-wasm-simd-threaded.asyncify.wasm',
    ]) {
      fs.writeFileSync(path.join(ortDir, fileName), 'stub');
    }

    let calls = 0;
    await expect(
      runBenchmarkDetection({
        corpusPath,
        rootDir: tempRoot,
        model: 'ai4privacy',
        detector: async () => {
          calls += 1;
          return { spans: [] };
        },
        getProviderStatus: () => ({
          mode: 'transformers',
          state: 'unavailable',
          model: 'ai4privacy',
          modelLabel: 'AI4Privacy prototype',
          message: 'file model.onnx not found locally',
        }),
      })
    ).rejects.toThrow(/NER provider failed to load.*--regex-only/);
    expect(calls).toBe(1);
  });

  test('runs examples sequentially and writes the raw output contract in regex-only mode', async () => {
    const corpusPath = writeCorpus(tempRoot);
    const outputPath = path.join(tempRoot, 'result.json');
    const calls: string[] = [];
    let clock = 0;

    const result = await runBenchmarkDetection({
      corpusPath,
      outputPath,
      rootDir: tempRoot,
      regexOnly: true,
      now: () => {
        clock += 3;
        return clock;
      },
      detector: async (text, config) => {
        calls.push(text);
        expect(config).toEqual(expect.objectContaining({ ner_provider: 'off', ner_enabled: false }));
        const start = stringIndexToByteOffset(text, text.indexOf('Ada Lovelace'));
        return {
          spans: [
            {
              start,
              end: start + 12,
              entity_type: 'PERSON',
              score: 0.99,
              text: 'Ada Lovelace',
              source: 'regex',
            },
          ],
        };
      },
    });

    expect(calls).toEqual([
      'Ada Lovelace can be reached at ada@example.test.',
      'Please ask Ada Lovelace for approval.',
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        corpus: {
          metadata: expect.objectContaining({ corpusId: 'harness-fixture' }),
          exampleCount: 2,
        },
        sourceExamples: expect.arrayContaining([
          expect.objectContaining({ id: 'example-1' }),
          expect.objectContaining({ id: 'example-2' }),
        ]),
        mode: 'regex-only',
        config: expect.objectContaining({ ner_provider: 'off', ner_enabled: false }),
        timings: expect.objectContaining({ totalWallMs: expect.any(Number) }),
        examples: [
          expect.objectContaining({ id: 'example-1', spans: [expect.any(Object)] }),
          expect.objectContaining({ id: 'example-2', spans: [expect.any(Object)] }),
        ],
      })
    );
    expect(JSON.parse(fs.readFileSync(outputPath, 'utf8'))).toEqual(
      expect.objectContaining({
        mode: 'regex-only',
        score: expect.objectContaining({
          headline: expect.objectContaining({ truePositives: 2 }),
        }),
        latency: expect.objectContaining({
          perExampleMs: expect.objectContaining({ averageMs: expect.any(Number) }),
        }),
        examples: expect.arrayContaining([
          expect.objectContaining({
            id: 'example-1',
            timings: expect.objectContaining({ totalMs: 3 }),
          }),
        ]),
      })
    );
  });
});
