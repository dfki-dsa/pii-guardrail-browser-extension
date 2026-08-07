const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('child_process', () => ({ spawnSync: jest.fn() }));

const childProcess = require('child_process');

const {
  DEFAULT_OUTPUT_DIR,
  optimizeBardsAiModel,
  parseArgs,
  validateOptions,
} = require('../../scripts/optimize-bardsai-model');

function writeFile(filePath, contents = 'fixture') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function writePreparedBaseline(root) {
  writeFile(path.join(root, 'config.json'));
  writeFile(path.join(root, 'tokenizer.json'));
  writeFile(path.join(root, 'tokenizer_config.json'));
  writeFile(path.join(root, 'onnx', 'model_fp16.onnx'));
  writeFile(path.join(root, 'onnx', 'model_fp16.onnx.data'));
}

function optionValue(args, option) {
  return args[args.indexOf(option) + 1];
}

describe('BardsAI model optimization command', () => {
  test('parses the reproducible model-build options', () => {
    expect(
      parseArgs([
        '--source-dir',
        'prepared-baseline',
        '--output-dir',
        'optimized-runtime',
        '--python',
        'python3.12',
        '--force',
      ])
    ).toEqual({
      sourceDir: 'prepared-baseline',
      outputDir: 'optimized-runtime',
      python: 'python3.12',
      force: true,
      help: false,
    });
  });

  test('defaults to the documented optimized BardsAI output directory', () => {
    expect(parseArgs(['--source-dir', 'prepared-baseline'])).toEqual(
      expect.objectContaining({
        outputDir: DEFAULT_OUTPUT_DIR,
        force: false,
      })
    );
  });

  test('requires a prepared baseline and a distinct output directory', () => {
    expect(() => validateOptions(parseArgs([]))).toThrow(/--source-dir/);
    expect(() =>
      validateOptions(parseArgs(['--source-dir', 'same', '--output-dir', 'same']))
    ).toThrow(/must be distinct/);
  });

  test('rejects unknown options', () => {
    expect(() => parseArgs(['--source-dir', 'prepared-baseline', '--unexpected'])).toThrow(
      /Unknown option/
    );
  });

  test('builds the final model in a staged directory before replacing the output', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-optimize-test-'));
    const sourceDir = path.join(tempRoot, 'baseline');
    const outputDir = path.join(tempRoot, 'runtime');
    writePreparedBaseline(sourceDir);

    childProcess.spawnSync.mockImplementation((command, args) => {
      const script = args[0];
      if (script.endsWith('prune_vocab.py')) {
        const prunedDir = optionValue(args, '--output-dir');
        fs.cpSync(sourceDir, prunedDir, { recursive: true });
      } else if (script.endsWith('quantize_embeddings_int8.py')) {
        const int8Dir = optionValue(args, '--output-dir');
        writeFile(path.join(int8Dir, 'onnx', 'model_fp16.onnx'), 'int8-model');
        writeFile(path.join(int8Dir, 'onnx', 'model_fp16.onnx.data'), 'int8-data');
      } else if (script.endsWith('convert-source-models-to-q4f16.js')) {
        const runtimeDir = optionValue(args, '--output-dir');
        writeFile(path.join(runtimeDir, 'onnx', 'model_q4f16.onnx'));
        writeFile(path.join(runtimeDir, 'onnx', 'model_q4f16.onnx.data'));
      }
      return { status: 0 };
    });

    expect(optimizeBardsAiModel({ sourceDir, outputDir, python: 'python' })).toBe(
      path.resolve(outputDir)
    );
    expect(fs.readFileSync(path.join(sourceDir, 'onnx', 'model_fp16.onnx'), 'utf8')).toBe('fixture');
    expect(fs.readFileSync(path.join(outputDir, 'onnx', 'model_fp16.onnx'), 'utf8')).toBe('int8-model');
    expect(fs.existsSync(path.join(outputDir, 'onnx', 'model_q4f16.onnx.data'))).toBe(true);

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('keeps a prior output intact when a forced regeneration fails', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-optimize-test-'));
    const sourceDir = path.join(tempRoot, 'baseline');
    const outputDir = path.join(tempRoot, 'runtime');
    writePreparedBaseline(sourceDir);
    writeFile(path.join(outputDir, 'onnx', 'model_q4f16.onnx.data'), 'previous-model');
    childProcess.spawnSync.mockReturnValue({ status: 1 });

    expect(() => optimizeBardsAiModel({ sourceDir, outputDir, python: 'python', force: true })).toThrow(
      /failed with exit code 1/
    );
    expect(fs.readFileSync(path.join(outputDir, 'onnx', 'model_q4f16.onnx.data'), 'utf8')).toBe(
      'previous-model'
    );

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
});
