#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const DEFAULT_PYTHON = 'python3';
const DEFAULT_OUTPUT_ROOT = path.join('generated', 'models', 'ner');

const MODEL_PRESETS = {
  bardsai: {
    modelId: 'bardsai/eu-pii-anonimization-multilang',
    sourceDir: path.join('.model-sources', 'bardsai-eu-pii-anonimization-multilang'),
    outputDir: path.join(DEFAULT_OUTPUT_ROOT, 'bardsai-eu-pii-anonimization-multilang'),
    referenceFile: path.join(
      'dist',
      'models',
      'ner',
      'bardsai-eu-pii-anonimization-multilang',
      'onnx',
      'model_fp16.onnx'
    ),
  },
  hikmaai: {
    modelId: 'HikmaAI/hikmaai-distilbert-pii',
    sourceDir: path.join('.model-sources', 'hikmaai-distilbert-pii'),
    outputDir: path.join(DEFAULT_OUTPUT_ROOT, 'hikmaai-distilbert-pii'),
    referenceFile: path.join(
      'dist',
      'models',
      'ner',
      'hikmaai-distilbert-pii',
      'onnx',
      'model_fp16.onnx'
    ),
  },
};

const FLOAT_ONNX_CANDIDATES = [
  path.join('onnx', 'model.onnx'),
  path.join('onnx', 'model_fp32.onnx'),
  'model.onnx',
];

const EXISTING_FP16_CANDIDATES = [
  path.join('onnx', 'model_fp16.onnx'),
  'model_fp16.onnx',
];

function usage() {
  return `
Convert source ONNX NER models to fp16 for WebGPU in the prepared model directories used by the build.

Usage:
  npm run convert:model:fp16 -- [--model all|bardsai|hikmaai] [--force]
  node scripts/convert-source-models-to-fp16.js --source-dir <dir> --output-dir <dir> [options]

Options:
  --model <name>          Preset to convert: all, bardsai, hikmaai. Default: all.
  --source-dir <dir>      Source model directory for a custom/single conversion.
  --input <file>          Float ONNX input. Overrides --source-dir candidate lookup.
  --output-dir <dir>      Output model directory. Writes onnx/model_fp16.onnx inside it.
  --output-file <file>    Exact fp16 output path. Overrides --output-dir.
  --reference-file <file> Compare the generated/copied fp16 model to an existing fp16 file.
  --python <command>      Python command with onnx and onnxruntime installed. Default: ${DEFAULT_PYTHON}
  --from-float            Always convert from the float ONNX source, even if source already has model_fp16.onnx.
  --force                 Allow replacing this script's output path. Never touches existing runtime fp16 models unless you explicitly point output there.
  --help                  Show this help.

Default preset outputs go under ${DEFAULT_OUTPUT_ROOT}, which webpack copies into dist/models during npm run build:ext.
Existing fp16 outputs are not overwritten unless --force is passed; dist/models is never written by this script unless you explicitly point --output-dir/--output-file there.
If a source directory already contains onnx/model_fp16.onnx, the script copies that artifact by default because that best matches the existing fp16 model.
Use --from-float to test a fresh conversion from onnx/model.onnx.
`.trim();
}

function parseArgs(argv) {
  const options = {
    model: 'all',
    python: DEFAULT_PYTHON,
    fromFloat: false,
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
      case '--model':
        options.model = next();
        break;
      case '--source-dir':
      case '-s':
        options.sourceDir = next();
        break;
      case '--input':
      case '-i':
        options.input = next();
        break;
      case '--output-dir':
      case '-o':
        options.outputDir = next();
        break;
      case '--output-file':
        options.outputFile = next();
        break;
      case '--reference-file':
        options.referenceFile = next();
        break;
      case '--python':
        options.python = next();
        break;
      case '--from-float':
        options.fromFloat = true;
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

function ensureReadableFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
}

function firstExistingFile(root, candidates) {
  return candidates
    .map((candidate) => path.resolve(root, candidate))
    .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function fileMetadata(filePath) {
  const stat = fs.statSync(filePath);
  return {
    path: filePath,
    bytes: stat.size,
    sha256: sha256(filePath),
  };
}

function convertFloatOnnxToFp16(inputPath, outputPath, pythonCommand) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const inputLiteral = JSON.stringify(inputPath);
  const outputLiteral = JSON.stringify(outputPath);

  const code = `
import onnx
from onnxruntime.transformers.float16 import convert_float_to_float16
model = onnx.load(${inputLiteral})
model_fp16 = convert_float_to_float16(model, keep_io_types=True)
onnx.save(model_fp16, ${outputLiteral})
`.trim();

  const result = spawnSync(pythonCommand, ['-c', code], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || '').trim();
    throw new Error(
      [
        `Failed to convert ONNX model to fp16 with ${pythonCommand}.`,
        'Install onnx and onnxruntime in that Python environment.',
        details,
      ]
        .filter(Boolean)
        .join(' ')
    );
  }
}

function convertOne(options) {
  const sourceRoot = options.sourceDir ? path.resolve(options.sourceDir) : undefined;
  const outputFile = path.resolve(
    options.outputFile || path.join(options.outputDir, 'onnx', 'model_fp16.onnx')
  );

  if (fs.existsSync(outputFile) && !options.force) {
    throw new Error(`Output fp16 model already exists: ${outputFile}. Rerun with --force or choose a new --output-dir.`);
  }

  let method;
  let inputFile;

  if (!options.fromFloat && sourceRoot) {
    const existingFp16 = firstExistingFile(sourceRoot, EXISTING_FP16_CANDIDATES);
    if (existingFp16) {
      method = 'copied-existing-fp16';
      inputFile = existingFp16;
      fs.mkdirSync(path.dirname(outputFile), { recursive: true });
      fs.copyFileSync(existingFp16, outputFile);
    }
  }

  if (!inputFile) {
    inputFile = options.input ? path.resolve(options.input) : undefined;
    if (!inputFile && sourceRoot) {
      inputFile = firstExistingFile(sourceRoot, FLOAT_ONNX_CANDIDATES);
    }
    if (!inputFile) {
      throw new Error('Missing float ONNX input. Provide --input or a --source-dir containing onnx/model.onnx.');
    }
    ensureReadableFile(inputFile, 'float ONNX input');
    method = 'converted-float-to-fp16';
    convertFloatOnnxToFp16(inputFile, outputFile, options.python || DEFAULT_PYTHON);
  }

  const output = fileMetadata(outputFile);
  const result = {
    modelId: options.modelId,
    method,
    input: inputFile,
    output,
  };

  if (options.referenceFile && fs.existsSync(options.referenceFile)) {
    const reference = fileMetadata(path.resolve(options.referenceFile));
    result.reference = reference;
    result.matchesReference = output.sha256 === reference.sha256;
  }

  const manifestPath = path.join(path.dirname(path.dirname(outputFile)), 'fp16-conversion-manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), ...result }, null, 2)}\n`);
  result.manifestPath = manifestPath;

  return result;
}

function expandJobs(options) {
  if (options.sourceDir || options.input) {
    if (!options.outputDir && !options.outputFile) {
      throw new Error('Custom conversion requires --output-dir or --output-file.');
    }
    return [options];
  }

  if (options.model === 'all') {
    if (options.outputDir || options.outputFile) {
      throw new Error('Use --model <name> with --output-dir/--output-file, or omit output options for --model all.');
    }
    return Object.values(MODEL_PRESETS).map((preset) => ({ ...options, ...preset }));
  }

  const preset = MODEL_PRESETS[options.model];
  if (!preset) {
    throw new Error(`Unknown --model ${options.model}. Expected one of: all, ${Object.keys(MODEL_PRESETS).join(', ')}.`);
  }

  return [{
    ...options,
    modelId: preset.modelId,
    sourceDir: options.sourceDir || preset.sourceDir,
    outputDir: options.outputDir || preset.outputDir,
    referenceFile: options.referenceFile || preset.referenceFile,
  }];
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(1)} MiB`;
}

function printResult(result) {
  console.log(`Prepared fp16 model${result.modelId ? ` for ${result.modelId}` : ''}`);
  console.log(`Method: ${result.method}`);
  console.log(`Input: ${result.input}`);
  console.log(`Output: ${result.output.path} (${formatBytes(result.output.bytes)})`);
  if (result.reference) {
    console.log(`Reference: ${result.reference.path} (${formatBytes(result.reference.bytes)})`);
    console.log(`Matches reference: ${result.matchesReference ? 'yes' : 'no'}`);
  }
  console.log(`Manifest: ${result.manifestPath}`);
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return [];
  }

  const jobs = expandJobs(options);
  const results = jobs.map(convertOne);
  results.forEach(printResult);
  return results;
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
  DEFAULT_OUTPUT_ROOT,
  MODEL_PRESETS,
  parseArgs,
  expandJobs,
  convertOne,
  convertFloatOnnxToFp16,
};
