const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseArgs,
  prepareLocalNerModel,
  verifyOutput,
} = require('../../scripts/prepare-ai4privacy-model');
const {
  DEFAULT_OUTPUT_DIR: BARDSAI_OUTPUT_DIR,
  parseArgs: parseBardsAiArgs,
} = require('../../scripts/prepare-bardsai-model');
const {
  DEFAULT_OUTPUT_DIR: HIKMAAI_OUTPUT_DIR,
  parseArgs: parseHikmaAiArgs,
} = require('../../scripts/prepare-hikmaai-model');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`);
}

function writeFixtureSource(root) {
  writeJson(path.join(root, 'config.json'), { model_type: 'distilbert' });
  writeJson(path.join(root, 'tokenizer.json'), {
    version: '1.0',
    model: { vocab: { '[UNK]': 0 } },
  });
  writeJson(path.join(root, 'tokenizer_config.json'), { do_lower_case: false });
  fs.mkdirSync(path.join(root, 'onnx'), { recursive: true });
  fs.writeFileSync(path.join(root, 'onnx', 'model_quantized.onnx'), Buffer.from('fake-onnx'));
}

function writeFixtureFp16(root) {
  fs.mkdirSync(path.join(root, 'onnx'), { recursive: true });
  fs.writeFileSync(path.join(root, 'onnx', 'model_fp16.onnx'), Buffer.from('fake-fp16-onnx'));
}

describe('AI4Privacy model preparation script', () => {
  let tempRoot;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-model-prep-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('parses the documented command options', () => {
    expect(
      parseArgs([
        '--source-dir',
        'source',
        '--output-dir',
        'output',
        '--model-id',
        'model/test',
        '--python',
        'python',
        '--force',
      ])
    ).toEqual(
      expect.objectContaining({
        sourceDir: 'source',
        outputDir: 'output',
        modelId: 'model/test',
        python: 'python',
        force: true,
      })
    );
  });

  test('parses the BardsAI convenience prep command with its own output default', () => {
    expect(parseBardsAiArgs(['--source-dir', 'source', '--force'])).toEqual(
      expect.objectContaining({
        sourceDir: 'source',
        outputDir: BARDSAI_OUTPUT_DIR,
        modelId: 'bardsai/eu-pii-anonimization-multilang',
        requireFp16: true,
        force: true,
      })
    );
  });

  test('parses the HikmaAI convenience prep command with its own output default', () => {
    expect(parseHikmaAiArgs(['--source-dir', 'source', '--force'])).toEqual(
      expect.objectContaining({
        sourceDir: 'source',
        outputDir: HIKMAAI_OUTPUT_DIR,
        modelId: 'HikmaAI/hikmaai-distilbert-pii',
        requireFp16: true,
        force: true,
      })
    );
  });

  test('copies required artifacts and writes size metadata without committing binaries', () => {
    const sourceDir = path.join(tempRoot, 'source');
    const outputDir = path.join(tempRoot, 'output');
    writeFixtureSource(sourceDir);

    const manifest = prepareLocalNerModel({
      sourceDir,
      outputDir,
      modelId: 'fixture/model',
    });

    expect(manifest).toEqual(
      expect.objectContaining({
        modelId: 'fixture/model',
        quantization: 'copied-prequantized',
      })
    );
    expect(manifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'config.json', bytes: expect.any(Number) }),
        expect.objectContaining({ path: 'tokenizer.json', bytes: expect.any(Number) }),
        expect.objectContaining({ path: 'tokenizer_config.json', bytes: expect.any(Number) }),
        expect.objectContaining({ path: 'onnx/model_quantized.onnx', bytes: 9 }),
      ])
    );
    expect(JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'))).toEqual(
      expect.objectContaining({ files: manifest.files })
    );
    expect(verifyOutput(outputDir)).toHaveLength(4);
  });

  test('copies optional fp16 ONNX artifact for WebGPU-capable prepared models', () => {
    const sourceDir = path.join(tempRoot, 'source');
    const outputDir = path.join(tempRoot, 'output');
    writeFixtureSource(sourceDir);
    writeFixtureFp16(sourceDir);

    const manifest = prepareLocalNerModel({
      sourceDir,
      outputDir,
      modelId: 'fixture/model',
      requireFp16: true,
    });

    expect(manifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'onnx/model_quantized.onnx', bytes: 9 }),
        expect.objectContaining({ path: 'onnx/model_fp16.onnx', bytes: 14 }),
      ])
    );
    expect(verifyOutput(outputDir, [path.join('onnx', 'model_fp16.onnx')])).toHaveLength(5);
  });

  test('fails clearly when fp16 or float ONNX is required but absent', () => {
    const sourceDir = path.join(tempRoot, 'source');
    writeFixtureSource(sourceDir);

    expect(() =>
      prepareLocalNerModel({
        sourceDir,
        outputDir: path.join(tempRoot, 'output'),
        requireFp16: true,
      })
    ).toThrow(/Missing fp16\/float ONNX model/);
  });

  test('fails clearly when required source artifacts are missing', () => {
    const sourceDir = path.join(tempRoot, 'source');
    fs.mkdirSync(sourceDir, { recursive: true });
    writeJson(path.join(sourceDir, 'config.json'), {});

    expect(() =>
      prepareLocalNerModel({
        sourceDir,
        outputDir: path.join(tempRoot, 'output'),
      })
    ).toThrow(/Missing source model artifact: .*tokenizer\.json/);
  });

  test('requires a sidecar vocabulary when tokenizer JSON does not embed one', () => {
    const sourceDir = path.join(tempRoot, 'source');
    writeFixtureSource(sourceDir);
    writeJson(path.join(sourceDir, 'tokenizer.json'), { version: '1.0', model: {} });

    expect(() =>
      prepareLocalNerModel({
        sourceDir,
        outputDir: path.join(tempRoot, 'output'),
      })
    ).toThrow(/Missing tokenizer vocabulary artifact: .*vocab\.txt/);

    fs.writeFileSync(path.join(sourceDir, 'vocab.txt'), '[UNK]\n');
    const manifest = prepareLocalNerModel({
      sourceDir,
      outputDir: path.join(tempRoot, 'output-with-vocab'),
    });

    expect(manifest.files).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'vocab.txt' })])
    );
  });

  test('protects an existing output directory unless force is set', () => {
    const sourceDir = path.join(tempRoot, 'source');
    const outputDir = path.join(tempRoot, 'output');
    writeFixtureSource(sourceDir);
    fs.mkdirSync(outputDir);

    expect(() => prepareLocalNerModel({ sourceDir, outputDir })).toThrow(
      /Rerun with --force/
    );

    expect(() => prepareLocalNerModel({ sourceDir, outputDir, force: true })).not.toThrow();
  });
});
