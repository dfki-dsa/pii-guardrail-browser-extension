#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_MODEL_ID = 'Isotonic/distilbert_finetuned_ai4privacy_v2';
const DEFAULT_OUTPUT_DIR = path.join('generated', 'models', 'ner', 'ai4privacy');
const DEFAULT_PYTHON = 'python3';

const REQUIRED_JSON_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json'];
const OPTIONAL_VOCABULARY_FILES = ['vocab.txt', 'special_tokens_map.json'];
const REQUIRED_OUTPUT_FILES = [
  ...REQUIRED_JSON_FILES,
  path.join('onnx', 'model_quantized.onnx'),
];

const QUANTIZED_ONNX_CANDIDATES = [
  path.join('onnx', 'model_quantized.onnx'),
  path.join('onnx', 'model_quantized_int8.onnx'),
  'model_quantized.onnx',
];

const FLOAT_ONNX_CANDIDATES = [
  path.join('onnx', 'model.onnx'),
  path.join('onnx', 'model_fp32.onnx'),
  'model.onnx',
];

const FP16_ONNX_CANDIDATES = [
  path.join('onnx', 'model_fp16.onnx'),
  'model_fp16.onnx',
];

function usage() {
  return `
Prepare local AI4Privacy NER model assets for the Chrome extension.

Usage:
  npm run prepare:model:ai4privacy -- --source-dir <dir> [--output-dir <dir>]

Options:
  --source-dir <dir>   Directory containing exported model files.
  --output-dir <dir>   Generated runtime directory. Default: ${DEFAULT_OUTPUT_DIR}
  --model-id <id>      Source model id for metadata. Default: ${DEFAULT_MODEL_ID}
  --python <command>   Python command for ONNX dynamic quantization. Default: ${DEFAULT_PYTHON}
  --force              Remove an existing output directory before writing.
  --help               Show this help.

The source directory must include config.json, tokenizer.json, tokenizer_config.json,
and either an already quantized ONNX model or a float ONNX model that can be
quantized with onnx, onnxruntime, and sympy installed in Python. If tokenizer.json
does not embed its vocabulary, include vocab.txt beside it.
`.trim();
}

function parseArgs(argv) {
  const options = {
    modelId: DEFAULT_MODEL_ID,
    outputDir: DEFAULT_OUTPUT_DIR,
    python: DEFAULT_PYTHON,
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
      case '--model-id':
        options.modelId = next();
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

function resolvePath(root, relativePath) {
  return path.resolve(root, relativePath);
}

function ensureJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid JSON artifact ${filePath}: ${error.message}`);
  }
}

function tokenizerHasEmbeddedVocabulary(tokenizerJson) {
  const vocab = tokenizerJson && tokenizerJson.model && tokenizerJson.model.vocab;
  if (Array.isArray(vocab)) return vocab.length > 0;
  return Boolean(vocab && typeof vocab === 'object' && Object.keys(vocab).length > 0);
}

function ensureReadableFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
}

function firstExistingFile(root, candidates) {
  return candidates.map((candidate) => resolvePath(root, candidate)).find((candidate) => {
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  });
}

function copyFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function quantizeOnnxModel(inputPath, outputPath, pythonCommand) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const inputLiteral = JSON.stringify(inputPath);
  const outputLiteral = JSON.stringify(outputPath);

  const code = `
from onnxruntime.quantization import QuantType, quantize_dynamic
quantize_dynamic(${inputLiteral}, ${outputLiteral}, weight_type=QuantType.QInt8)
`.trim();

  const result = spawnSync(pythonCommand, ['-c', code], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || '').trim();
    throw new Error(
      [
        `Failed to quantize ONNX model with ${pythonCommand}.`,
        'Install onnx, onnxruntime, and sympy in that Python environment or provide an already quantized model_quantized.onnx.',
        details,
      ]
        .filter(Boolean)
        .join(' ')
    );
  }
}

function convertOnnxModelToFp16(inputPath, outputPath, pythonCommand) {
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
        'Install onnx and onnxruntime in that Python environment or provide an already converted model_fp16.onnx.',
        details,
      ]
        .filter(Boolean)
        .join(' ')
    );
  }
}

function fileMetadata(filePath, outputRoot) {
  const stat = fs.statSync(filePath);
  return {
    path: path.relative(outputRoot, filePath).split(path.sep).join('/'),
    bytes: stat.size,
  };
}

function collectOutputFiles(root, current = root) {
  const files = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const entryPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectOutputFiles(root, entryPath));
    } else if (entry.isFile()) {
      files.push(fileMetadata(entryPath, root));
    }
  }
  return files;
}

function verifyOutput(outputDir, extraRequiredFiles = []) {
  const outputRoot = path.resolve(outputDir);
  const files = [];

  for (const relativePath of [...REQUIRED_OUTPUT_FILES, ...extraRequiredFiles]) {
    const filePath = resolvePath(outputRoot, relativePath);
    ensureReadableFile(filePath, 'prepared model artifact');
    if (relativePath.endsWith('.json')) {
      ensureJsonFile(filePath);
    }
    files.push(fileMetadata(filePath, outputRoot));
  }

  return files;
}

function prepareLocalNerModel(options) {
  if (!options.sourceDir) {
    throw new Error('Missing --source-dir. Export or download the source model first, then rerun this command.');
  }

  const sourceRoot = path.resolve(options.sourceDir);
  const outputRoot = path.resolve(options.outputDir || DEFAULT_OUTPUT_DIR);

  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new Error(`Source model directory does not exist: ${sourceRoot}`);
  }

  if (fs.existsSync(outputRoot)) {
    if (!options.force) {
      throw new Error(`Output directory already exists: ${outputRoot}. Rerun with --force to replace it.`);
    }
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }

  fs.mkdirSync(outputRoot, { recursive: true });

  for (const file of REQUIRED_JSON_FILES) {
    const source = resolvePath(sourceRoot, file);
    ensureReadableFile(source, 'source model artifact');
    const parsed = ensureJsonFile(source);
    if (file === 'tokenizer.json' && !tokenizerHasEmbeddedVocabulary(parsed)) {
      ensureReadableFile(resolvePath(sourceRoot, 'vocab.txt'), 'tokenizer vocabulary artifact');
    }
    copyFile(source, resolvePath(outputRoot, file));
  }

  for (const file of OPTIONAL_VOCABULARY_FILES) {
    const source = resolvePath(sourceRoot, file);
    if (fs.existsSync(source) && fs.statSync(source).isFile()) {
      copyFile(source, resolvePath(outputRoot, file));
    }
  }

  const quantizedSource = firstExistingFile(sourceRoot, QUANTIZED_ONNX_CANDIDATES);
  const quantizedOutput = resolvePath(outputRoot, path.join('onnx', 'model_quantized.onnx'));

  let quantization = 'copied-prequantized';
  if (quantizedSource) {
    copyFile(quantizedSource, quantizedOutput);
  } else {
    const floatSource = firstExistingFile(sourceRoot, FLOAT_ONNX_CANDIDATES);
    if (!floatSource) {
      throw new Error(
        `Missing ONNX model. Expected one of: ${[...QUANTIZED_ONNX_CANDIDATES, ...FLOAT_ONNX_CANDIDATES].join(', ')}`
      );
    }
    quantizeOnnxModel(floatSource, quantizedOutput, options.python || DEFAULT_PYTHON);
    quantization = 'dynamic-qint8';
  }

  const fp16Source = firstExistingFile(sourceRoot, FP16_ONNX_CANDIDATES);
  if (fp16Source) {
    copyFile(fp16Source, resolvePath(outputRoot, path.join('onnx', 'model_fp16.onnx')));
  } else if (options.requireFp16) {
    const floatSource = firstExistingFile(sourceRoot, FLOAT_ONNX_CANDIDATES);
    if (!floatSource) {
      throw new Error(
        `Missing fp16/float ONNX model. Expected one of: ${[...FP16_ONNX_CANDIDATES, ...FLOAT_ONNX_CANDIDATES].join(', ')}`
      );
    }
    convertOnnxModelToFp16(
      floatSource,
      resolvePath(outputRoot, path.join('onnx', 'model_fp16.onnx')),
      options.python || DEFAULT_PYTHON
    );
  }

  const files = collectOutputFiles(outputRoot).sort((a, b) => a.path.localeCompare(b.path));
  verifyOutput(
    outputRoot,
    options.requireFp16 ? [path.join('onnx', 'model_fp16.onnx')] : []
  );
  const manifest = {
    modelId: options.modelId || DEFAULT_MODEL_ID,
    generatedAt: new Date().toISOString(),
    sourceDir: sourceRoot,
    quantization,
    files,
  };

  fs.writeFileSync(
    resolvePath(outputRoot, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  return manifest;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(1)} MiB`;
}

function printManifest(manifest) {
  console.log(`Prepared ${manifest.modelId}`);
  console.log(`Quantization: ${manifest.quantization}`);
  console.log('Artifacts:');
  for (const file of manifest.files) {
    console.log(`- ${file.path}: ${formatBytes(file.bytes)}`);
  }
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }

  const manifest = prepareLocalNerModel(options);
  printManifest(manifest);
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
  DEFAULT_MODEL_ID,
  DEFAULT_OUTPUT_DIR,
  REQUIRED_OUTPUT_FILES,
  parseArgs,
  prepareLocalNerModel,
  verifyOutput,
};
