#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const DEFAULT_PYTHON = 'python3';
const DEFAULT_OUTPUT_ROOT = path.join('generated', 'models', 'ner');
const DEFAULT_BITS = 4;
const DEFAULT_BLOCK_SIZE = 32;
const DEFAULT_SYMMETRIC = true;
const DEFAULT_QUANT_FORMAT = 'QOperator';
const DEFAULT_OP_TYPES_TO_QUANTIZE = ['MatMul'];
const Q4F16_MANIFEST_FILE = 'q4f16-conversion-manifest.json';

const MODEL_PRESETS = {
  bardsai: {
    modelId: 'bardsai/eu-pii-anonimization-multilang',
    sourceDir: path.join('.model-sources', 'bardsai-eu-pii-anonimization-multilang'),
    outputDir: path.join(DEFAULT_OUTPUT_ROOT, 'bardsai-eu-pii-anonimization-multilang'),
  },
};

const FP16_ONNX_CANDIDATES = [
  path.join('onnx', 'model_fp16.onnx'),
  'model_fp16.onnx',
];

const FLOAT_ONNX_CANDIDATES = [
  path.join('onnx', 'model.onnx'),
  path.join('onnx', 'model_fp32.onnx'),
  'model.onnx',
];

function usage() {
  return `
Convert BardsAI source ONNX assets to an experimental q4f16 WebGPU artifact with ONNX Runtime MatMulNBits.

Usage:
  npm run convert:model:q4f16 -- [--model bardsai] [--force]
  node scripts/convert-source-models-to-q4f16.js --source-dir <dir> --output-dir <dir> [options]

Options:
  --model <name>          Preset to convert: bardsai. Default: bardsai.
  --source-dir <dir>      Source model directory for a custom/single conversion.
  --input <file>          Exact fp16 ONNX input. Overrides --source-dir fp16 candidate lookup.
  --output-dir <dir>      Output model directory. Writes onnx/model_q4f16.onnx inside it.
  --output-file <file>    Exact q4f16 output path. Overrides --output-dir.
  --python <command>      Python command with onnx, onnxruntime, and onnx-ir installed. Default: ${DEFAULT_PYTHON}
  --block-size <n>        MatMulNBits block size. Must be a power of 2 and >= 16. Default: ${DEFAULT_BLOCK_SIZE}
  --symmetric             Use symmetric int4 weights. This is enabled by default.
  --no-symmetric          Use asymmetric uint4 weights.
  --accuracy-level <n>    Optional MatMulNBits accuracy_level attribute.
  --force                 Allow replacing the q4f16 output path.
  --help                  Show this help.

Default BardsAI output:
  ${path.join(MODEL_PRESETS.bardsai.outputDir, 'onnx', 'model_q4f16.onnx')}

The script starts from onnx/model_fp16.onnx when available. If only onnx/model.onnx is available, it creates or reuses a q4f16-only fp16 intermediate next to the q4f16 output and leaves the stable fp16 workflow untouched.
`.trim();
}

function parseIntegerOption(arg, rawValue) {
  if (!/^-?\d+$/.test(rawValue)) {
    throw new Error(`${arg} requires an integer value.`);
  }
  return Number.parseInt(rawValue, 10);
}

function parseArgs(argv) {
  const options = {
    model: 'bardsai',
    python: DEFAULT_PYTHON,
    blockSize: DEFAULT_BLOCK_SIZE,
    symmetric: DEFAULT_SYMMETRIC,
    accuracyLevel: undefined,
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
      case '--python':
        options.python = next();
        break;
      case '--block-size':
        options.blockSize = parseIntegerOption(arg, next());
        break;
      case '--symmetric':
        options.symmetric = true;
        break;
      case '--no-symmetric':
        options.symmetric = false;
        break;
      case '--accuracy-level':
        options.accuracyLevel = parseIntegerOption(arg, next());
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

  validateQuantizationOptions(options);
  return options;
}

function validateQuantizationOptions(options) {
  if (options.blockSize < 16 || (options.blockSize & (options.blockSize - 1)) !== 0) {
    throw new Error('--block-size must be a power of 2 and at least 16.');
  }
  if (options.accuracyLevel !== undefined && options.accuracyLevel < 0) {
    throw new Error('--accuracy-level must be zero or a positive integer.');
  }
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

function runPythonCode(pythonCommand, code, action, spawnSyncImpl = spawnSync) {
  const result = spawnSyncImpl(pythonCommand, ['-c', code], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    throw new Error(`Failed to ${action} with ${pythonCommand}: ${result.error.message}`);
  }

  return result;
}

function pythonFailureDetails(result) {
  return (result.stderr || result.stdout || '').trim();
}

function formatPythonSetupError(pythonCommand, details) {
  const missingOnnxIr = /No module named ['"]onnx_ir['"]|onnx-ir|onnx_ir/.test(details);
  return [
    `Python setup is missing ONNX Runtime MatMulNBits quantization support for ${pythonCommand}.`,
    'Install or upgrade onnxruntime in that Python environment and ensure onnx is installed.',
    missingOnnxIr
      ? 'The MatMulNBits quantizer also needs the onnx-ir package, imported as onnx_ir.'
      : 'The required import is onnxruntime.quantization.matmul_nbits_quantizer.',
    details,
  ]
    .filter(Boolean)
    .join(' ');
}

function assertQ4f16PythonSetup(pythonCommand, spawnSyncImpl = spawnSync) {
  const code = `
import sys
try:
    import onnx
    from onnxruntime.quantization import matmul_nbits_quantizer, quant_utils
except ModuleNotFoundError as exc:
    print(f"MODULE_NOT_FOUND:{exc.name}", file=sys.stderr)
    raise
except ImportError as exc:
    print(f"IMPORT_ERROR:{exc}", file=sys.stderr)
    raise

required = [
    ("matmul_nbits_quantizer", matmul_nbits_quantizer, "DefaultWeightOnlyQuantConfig"),
    ("matmul_nbits_quantizer", matmul_nbits_quantizer, "MatMulNBitsQuantizer"),
    ("quant_utils", quant_utils, "QuantFormat"),
]
missing = [f"{module}.{name}" for module, obj, name in required if not hasattr(obj, name)]
if missing:
    raise ImportError("Missing MatMulNBits quantizer API: " + ", ".join(missing))
`.trim();

  const result = runPythonCode(pythonCommand, code, 'check q4f16 Python setup', spawnSyncImpl);
  if (result.status !== 0) {
    throw new Error(formatPythonSetupError(pythonCommand, pythonFailureDetails(result)));
  }
}

function convertFloatOnnxToFp16(inputPath, outputPath, pythonCommand, spawnSyncImpl = spawnSync) {
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

  const result = runPythonCode(pythonCommand, code, 'convert ONNX model to fp16', spawnSyncImpl);
  if (result.status !== 0) {
    const details = pythonFailureDetails(result);
    throw new Error(
      [
        `Failed to create fp16 intermediate with ${pythonCommand}.`,
        'Install onnx and onnxruntime in that Python environment, or provide onnx/model_fp16.onnx.',
        details,
      ]
        .filter(Boolean)
        .join(' ')
    );
  }
}

function quantizeFp16OnnxToQ4f16(inputPath, outputPath, options) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const inputLiteral = JSON.stringify(inputPath);
  const outputLiteral = JSON.stringify(outputPath);
  const accuracyLevelLiteral =
    options.accuracyLevel === undefined ? 'None' : JSON.stringify(options.accuracyLevel);

  const code = `
import onnx
from onnxruntime.quantization import matmul_nbits_quantizer, quant_utils

model = onnx.load(${inputLiteral})
quant_config = matmul_nbits_quantizer.DefaultWeightOnlyQuantConfig(
    block_size=${JSON.stringify(options.blockSize)},
    is_symmetric=${options.symmetric ? 'True' : 'False'},
    accuracy_level=${accuracyLevelLiteral},
    quant_format=quant_utils.QuantFormat.QOperator,
    op_types_to_quantize=("MatMul",),
    bits=${DEFAULT_BITS},
)
quant_kwargs = dict(
    model=model,
    block_size=${JSON.stringify(options.blockSize)},
    is_symmetric=${options.symmetric ? 'True' : 'False'},
    accuracy_level=${accuracyLevelLiteral},
    algo_config=quant_config,
)
# onnxruntime >= 1.22 moved the bits argument into the algo config; older
# versions require it on the quantizer itself. Support both.
import inspect
if "bits" in inspect.signature(matmul_nbits_quantizer.MatMulNBitsQuantizer.__init__).parameters:
    quant_kwargs["bits"] = ${DEFAULT_BITS}
quant = matmul_nbits_quantizer.MatMulNBitsQuantizer(**quant_kwargs)
quant.process()
quant.model.save_model_to_file(${outputLiteral}, True)
`.trim();

  const result = runPythonCode(
    options.python || DEFAULT_PYTHON,
    code,
    'quantize ONNX model to q4f16',
    options.spawnSyncImpl
  );
  if (result.status !== 0) {
    const details = pythonFailureDetails(result);
    throw new Error(
      [
        `Failed to quantize ONNX model to q4f16 with ${options.python || DEFAULT_PYTHON}.`,
        'The q4f16 path uses onnxruntime.quantization.matmul_nbits_quantizer with QOperator MatMulNBits.',
        details,
      ]
        .filter(Boolean)
        .join(' ')
    );
  }
}

function validateQ4f16Output(outputPath, options = {}) {
  const outputLiteral = JSON.stringify(outputPath);
  // The recorded location must match the `path` the runtime passes to ONNX
  // Runtime via session_options.externalData (see NerExternalDataAsset).
  const locationLiteral = JSON.stringify(`${path.basename(outputPath)}.data`);
  const code = `
import json
import onnx

output_path = ${outputLiteral}
location = ${locationLiteral}

graph_only = onnx.load(output_path, load_external_data=False)
locations = set()
for tensor in graph_only.graph.initializer:
    if tensor.data_location == onnx.TensorProto.EXTERNAL:
        locations.update(
            entry.value for entry in tensor.external_data if entry.key == "location"
        )
if locations != {location}:
    raise RuntimeError(
        f"external-data locations {sorted(locations)} != [{location}]; the runtime resolves q4f16 weights via session_options.externalData"
    )

model = onnx.load(output_path)
onnx.checker.check_model(model)
count = sum(1 for node in model.graph.node if node.domain == "com.microsoft" and node.op_type == "MatMulNBits")
if count < 1:
    raise RuntimeError("Expected at least one com.microsoft::MatMulNBits node in the generated q4f16 graph.")
print(json.dumps({"onnxChecker": "passed", "matMulNBitsNodeCount": count, "externalTensorLocations": sorted(locations)}))
`.trim();

  const result = runPythonCode(
    options.python || DEFAULT_PYTHON,
    code,
    'validate generated q4f16 ONNX model',
    options.spawnSyncImpl
  );
  if (result.status !== 0) {
    const details = pythonFailureDetails(result);
    throw new Error(
      [
        `Generated q4f16 ONNX validation failed for ${outputPath}.`,
        'onnx.checker.check_model must pass, the graph must contain com.microsoft::MatMulNBits, and all external tensors must record the <output>.data location the runtime expects.',
        details,
      ]
        .filter(Boolean)
        .join(' ')
    );
  }

  try {
    return JSON.parse((result.stdout || '').trim());
  } catch (error) {
    throw new Error(`Unable to parse q4f16 validation output from ${options.python || DEFAULT_PYTHON}: ${error.message}`);
  }
}

function q4f16QuantizationMetadata(options) {
  return {
    bits: DEFAULT_BITS,
    blockSize: options.blockSize,
    symmetric: options.symmetric,
    quantFormat: DEFAULT_QUANT_FORMAT,
    opTypesToQuantize: DEFAULT_OP_TYPES_TO_QUANTIZE,
    accuracyLevel: options.accuracyLevel ?? null,
  };
}

function resolveFp16Input(options, outputFile) {
  if (options.input) {
    const inputFile = path.resolve(options.input);
    ensureReadableFile(inputFile, 'fp16 ONNX input');
    return {
      inputFile,
      method: 'quantized-existing-fp16-to-q4f16',
      fp16InputSource: 'explicit-input',
    };
  }

  const sourceRoot = options.sourceDir ? path.resolve(options.sourceDir) : undefined;
  if (!sourceRoot) {
    throw new Error('Missing source ONNX assets. Provide --source-dir or --input.');
  }

  const existingFp16 = firstExistingFile(sourceRoot, FP16_ONNX_CANDIDATES);
  if (existingFp16) {
    return {
      inputFile: existingFp16,
      method: 'quantized-existing-fp16-to-q4f16',
      fp16InputSource: 'source-fp16',
    };
  }

  const floatInput = firstExistingFile(sourceRoot, FLOAT_ONNX_CANDIDATES);
  if (!floatInput) {
    throw new Error(
      `Missing fp16/float ONNX input. Expected one of: ${[...FP16_ONNX_CANDIDATES, ...FLOAT_ONNX_CANDIDATES].join(', ')}`
    );
  }

  const intermediateFile = path.join(path.dirname(outputFile), 'model_fp16.q4f16-intermediate.onnx');
  return {
    inputFile: intermediateFile,
    method: 'converted-float-to-fp16-then-q4f16',
    fp16InputSource: 'generated-intermediate',
    floatInput,
    intermediateFile,
  };
}

function convertOne(options) {
  const outputFile = path.resolve(
    options.outputFile || path.join(options.outputDir, 'onnx', 'model_q4f16.onnx')
  );

  const externalDataFile = path.join(
    path.dirname(outputFile),
    `${path.basename(outputFile)}.data`
  );

  if (fs.existsSync(outputFile) && !options.force) {
    throw new Error(`Output q4f16 model already exists: ${outputFile}. Rerun with --force or choose a new --output-dir.`);
  }
  if (fs.existsSync(externalDataFile) && !options.force) {
    throw new Error(`Output q4f16 external data already exists: ${externalDataFile}. Rerun with --force or choose a new --output-dir.`);
  }

  const resolved = resolveFp16Input(options, outputFile);
  assertQ4f16PythonSetup(options.python || DEFAULT_PYTHON, options.spawnSyncImpl);

  let intermediate;
  if (resolved.intermediateFile) {
    if (!fs.existsSync(resolved.intermediateFile) || options.force) {
      convertFloatOnnxToFp16(
        resolved.floatInput,
        resolved.intermediateFile,
        options.python || DEFAULT_PYTHON,
        options.spawnSyncImpl
      );
      intermediate = {
        generated: true,
        source: resolved.floatInput,
        output: fileMetadata(resolved.intermediateFile),
      };
    } else {
      intermediate = {
        generated: false,
        source: resolved.floatInput,
        output: fileMetadata(resolved.intermediateFile),
      };
    }
  }

  quantizeFp16OnnxToQ4f16(resolved.inputFile, outputFile, options);
  if (!fs.existsSync(externalDataFile)) {
    throw new Error(
      `Quantization did not produce the external-data sidecar: ${externalDataFile}. The runtime loads q4f16 weights via session_options.externalData, so an embedded-weights output is not usable.`
    );
  }
  const validation = validateQ4f16Output(outputFile, options);

  const output = fileMetadata(outputFile);
  const result = {
    modelId: options.modelId,
    method: resolved.method,
    input: resolved.inputFile,
    fp16InputSource: resolved.fp16InputSource,
    output,
    externalData: fileMetadata(externalDataFile),
    quantization: q4f16QuantizationMetadata(options),
    validation,
  };

  if (intermediate) {
    result.fp16Intermediate = intermediate;
  }

  const manifestPath = path.join(path.dirname(path.dirname(outputFile)), Q4F16_MANIFEST_FILE);
  const manifest = {
    generatedAt: new Date().toISOString(),
    ...result,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  result.manifestPath = manifestPath;

  return result;
}

function expandJobs(options) {
  if (options.sourceDir || options.input) {
    if (!options.outputDir && !options.outputFile) {
      throw new Error('Custom q4f16 conversion requires --output-dir or --output-file.');
    }
    return [options];
  }

  const preset = MODEL_PRESETS[options.model];
  if (!preset) {
    throw new Error(`Unknown --model ${options.model}. Expected one of: ${Object.keys(MODEL_PRESETS).join(', ')}.`);
  }

  return [{
    ...options,
    modelId: preset.modelId,
    sourceDir: options.sourceDir || preset.sourceDir,
    outputDir: options.outputDir || preset.outputDir,
  }];
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(1)} MiB`;
}

function printResult(result) {
  console.log(`Prepared q4f16 model${result.modelId ? ` for ${result.modelId}` : ''}`);
  console.log(`Method: ${result.method}`);
  console.log(`Input: ${result.input}`);
  if (result.fp16Intermediate) {
    console.log(`FP16 intermediate: ${result.fp16Intermediate.output.path}`);
  }
  console.log(`Output: ${result.output.path} (${formatBytes(result.output.bytes)})`);
  console.log(`Weights: ${result.externalData.path} (${formatBytes(result.externalData.bytes)})`);
  console.log(`MatMulNBits nodes: ${result.validation.matMulNBitsNodeCount}`);
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
  DEFAULT_BITS,
  DEFAULT_BLOCK_SIZE,
  DEFAULT_OUTPUT_ROOT,
  DEFAULT_SYMMETRIC,
  MODEL_PRESETS,
  Q4F16_MANIFEST_FILE,
  parseArgs,
  expandJobs,
  convertOne,
  assertQ4f16PythonSetup,
  convertFloatOnnxToFp16,
  quantizeFp16OnnxToQ4f16,
  validateQ4f16Output,
};
