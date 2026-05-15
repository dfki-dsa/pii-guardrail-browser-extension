const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DEFAULT_OUTPUT_ROOT,
  parseArgs,
  expandJobs,
  convertOne,
} = require('../../scripts/convert-source-models-to-fp16');

describe('fp16 conversion script', () => {
  let tempRoot;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-fp16-convert-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('parses documented options', () => {
    expect(
      parseArgs([
        '--model',
        'bardsai',
        '--source-dir',
        'source',
        '--output-dir',
        'output',
        '--reference-file',
        'reference.onnx',
        '--python',
        'python',
        '--from-float',
        '--force',
      ])
    ).toEqual(
      expect.objectContaining({
        model: 'bardsai',
        sourceDir: 'source',
        outputDir: 'output',
        referenceFile: 'reference.onnx',
        python: 'python',
        fromFloat: true,
        force: true,
      })
    );
  });

  test('expands default all preset into prepared model directories copied by the build', () => {
    const jobs = expandJobs(parseArgs([]));

    expect(jobs.map((job) => job.modelId)).toEqual([
      'bardsai/eu-pii-anonimization-multilang',
      'HikmaAI/hikmaai-distilbert-pii',
    ]);
    expect(DEFAULT_OUTPUT_ROOT).toBe(path.join('generated', 'models', 'ner'));
    expect(jobs.every((job) => job.outputDir.startsWith(DEFAULT_OUTPUT_ROOT))).toBe(true);
    expect(jobs.every((job) => !job.outputDir.startsWith(path.join('dist', 'models')))).toBe(true);
  });

  test('copies a source fp16 model when present to match existing fp16 artifacts', () => {
    const sourceDir = path.join(tempRoot, 'source');
    const outputDir = path.join(tempRoot, 'output');
    fs.mkdirSync(path.join(sourceDir, 'onnx'), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'onnx', 'model_fp16.onnx'), Buffer.from('fake-fp16'));

    const result = convertOne({
      sourceDir,
      outputDir,
      modelId: 'fixture/model',
      force: false,
    });

    expect(result).toEqual(expect.objectContaining({ method: 'copied-existing-fp16' }));
    expect(fs.readFileSync(path.join(outputDir, 'onnx', 'model_fp16.onnx'), 'utf8')).toBe('fake-fp16');
    expect(fs.existsSync(path.join(outputDir, 'fp16-conversion-manifest.json'))).toBe(true);
  });

  test('refuses to replace conversion output unless force is set', () => {
    const sourceDir = path.join(tempRoot, 'source');
    const outputDir = path.join(tempRoot, 'output');
    fs.mkdirSync(path.join(sourceDir, 'onnx'), { recursive: true });
    fs.mkdirSync(path.join(outputDir, 'onnx'), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'onnx', 'model_fp16.onnx'), Buffer.from('new-fp16'));
    fs.writeFileSync(path.join(outputDir, 'onnx', 'model_fp16.onnx'), Buffer.from('old-fp16'));

    expect(() => convertOne({ sourceDir, outputDir })).toThrow(/already exists/);
    expect(() => convertOne({ sourceDir, outputDir, force: true })).not.toThrow();
  });
});
