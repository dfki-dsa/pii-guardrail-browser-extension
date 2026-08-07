#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_OUTPUT_DIR = path.join(
  'generated',
  'models',
  'ner',
  'bardsai-eu-pii-anonimization-multilang'
);

const REQUIRED_BASELINE_ASSETS = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  path.join('onnx', 'model_fp16.onnx'),
  path.join('onnx', 'model_fp16.onnx.data'),
];

function usage() {
  return `
Build the shippable BardsAI model from a prepared external-data fp16 baseline.

Usage:
  npm run optimize:model:bardsai -- --source-dir <prepared-baseline> [options]

Options:
  --source-dir <dir>   Prepared BardsAI baseline with model_fp16.onnx and .data. Required.
  --output-dir <dir>   Final optimized model directory. Default: ${DEFAULT_OUTPUT_DIR}
  --python <command>   Python with numpy, onnx, onnxruntime, onnx-ir, and tokenizers. Default: python3.
  --force              Replace the explicit output directory if it already exists.
  --help               Show this help.

The command prunes the vocabulary, int8-quantizes its embedding table, produces
the q4f16 runtime artifact, and compares the final fp16 graph with the baseline.
`.trim();
}

function parseArgs(argv) {
  const options = {
    outputDir: DEFAULT_OUTPUT_DIR,
    python: 'python3',
    force: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value.`);
      }
      i += 1;
      return value;
    };

    switch (arg) {
      case '--source-dir':
      case '-s':
        options.sourceDir = next();
        break;
      case '--output-dir':
      case '-o':
        options.outputDir = next();
        break;
      case '--python':
        options.python = next();
        break;
      case '--force':
        options.force = true;
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

function validateOptions(options) {
  if (!options.sourceDir) {
    throw new Error('Missing --source-dir.');
  }

  const sourceDir = path.resolve(options.sourceDir);
  const outputDir = path.resolve(options.outputDir);
  if (sourceDir === outputDir) {
    throw new Error('--source-dir and --output-dir must be distinct.');
  }
  if (outputDir === path.parse(outputDir).root) {
    throw new Error('--output-dir must not be a filesystem root.');
  }

  for (const asset of REQUIRED_BASELINE_ASSETS) {
    const filePath = path.join(sourceDir, asset);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`Missing prepared baseline asset: ${filePath}`);
    }
  }

  return { ...options, sourceDir, outputDir };
}

function run(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.`);
  }
}

function copyDirectory(sourceDir, outputDir) {
  fs.cpSync(sourceDir, outputDir, { recursive: true });
}

function replaceOutputDirectory(stagedOutputDir, outputDir) {
  if (!fs.existsSync(outputDir)) {
    fs.renameSync(stagedOutputDir, outputDir);
    return;
  }

  const backupDir = fs.mkdtempSync(path.join(
    path.dirname(outputDir),
    `.${path.basename(outputDir)}.previous-`
  ));
  fs.rmdirSync(backupDir);
  fs.renameSync(outputDir, backupDir);
  try {
    fs.renameSync(stagedOutputDir, outputDir);
  } catch (error) {
    fs.renameSync(backupDir, outputDir);
    throw error;
  }
  fs.rmSync(backupDir, { recursive: true, force: true });
}

function optimizeBardsAiModel(options) {
  const resolved = validateOptions(options);
  if (fs.existsSync(resolved.outputDir)) {
    if (!resolved.force) {
      throw new Error(`Output directory already exists: ${resolved.outputDir}. Rerun with --force to replace it.`);
    }
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-guardrail-bardsai-optimize-'));
  fs.mkdirSync(path.dirname(resolved.outputDir), { recursive: true });
  const stagingRoot = fs.mkdtempSync(path.join(
    path.dirname(resolved.outputDir),
    `.${path.basename(resolved.outputDir)}.building-`
  ));
  const stagedOutputDir = path.join(stagingRoot, 'model');
  const prunedDir = path.join(workDir, 'pruned-fp16');
  const int8Dir = path.join(workDir, 'pruned-int8');
  const root = path.resolve(__dirname, '..');

  try {
    run(resolved.python, [
      path.join(root, 'tools', 'prune_vocab.py'),
      '--source-dir', resolved.sourceDir,
      '--output-dir', prunedDir,
    ]);
    run(resolved.python, [
      path.join(root, 'tools', 'quantize_embeddings_int8.py'),
      '--input-dir', prunedDir,
      '--output-dir', int8Dir,
    ]);

    copyDirectory(prunedDir, stagedOutputDir);
    const outputOnnxDir = path.join(stagedOutputDir, 'onnx');
    fs.copyFileSync(path.join(int8Dir, 'onnx', 'model_fp16.onnx'), path.join(outputOnnxDir, 'model_fp16.onnx'));
    fs.copyFileSync(path.join(int8Dir, 'onnx', 'model_fp16.onnx.data'), path.join(outputOnnxDir, 'model_fp16.onnx.data'));

    run(process.execPath, [
      path.join(root, 'scripts', 'convert-source-models-to-q4f16.js'),
      '--source-dir', stagedOutputDir,
      '--output-dir', stagedOutputDir,
      '--python', resolved.python,
    ]);
    run(resolved.python, [
      path.join(root, 'tools', 'validate_pruned_model.py'),
      '--baseline-dir', resolved.sourceDir,
      '--pruned-dir', stagedOutputDir,
      '--pruned-onnx', path.join(outputOnnxDir, 'model_fp16.onnx'),
    ]);
    replaceOutputDirectory(stagedOutputDir, resolved.outputDir);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }

  return resolved.outputDir;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  const outputDir = optimizeBardsAiModel(options);
  console.log(`Prepared optimized BardsAI model: ${outputDir}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_OUTPUT_DIR,
  REQUIRED_BASELINE_ASSETS,
  optimizeBardsAiModel,
  parseArgs,
  replaceOutputDirectory,
  validateOptions,
};
