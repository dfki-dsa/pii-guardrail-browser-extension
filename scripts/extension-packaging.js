const fs = require('fs');
const path = require('path');

const PREPARED_MODEL_SOURCE_DIR = path.join('generated', 'models', 'ner', 'ai4privacy');
const PREPARED_BARDSAI_MODEL_SOURCE_DIR = path.join(
  'generated',
  'models',
  'ner',
  'bardsai-eu-pii-anonimization-multilang'
);
const PACKAGED_MODEL_DIR = 'models/ner/ai4privacy';
const PACKAGED_BARDSAI_MODEL_DIR = 'models/ner/bardsai-eu-pii-anonimization-multilang';
const PACKAGED_ONNX_RUNTIME_DIR = 'vendor/onnxruntime-web';
const ACTIVE_PREPARED_MODEL_SOURCE_DIR = PREPARED_BARDSAI_MODEL_SOURCE_DIR;
const ACTIVE_PACKAGED_MODEL_DIR = PACKAGED_BARDSAI_MODEL_DIR;

const REQUIRED_MODEL_ASSETS = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  // CPU/WASM fallback and WebGPU default: q4f16 external data.
  path.join('onnx', 'model_q4f16.onnx'),
  path.join('onnx', 'model_q4f16.onnx.data'),
];

// Conversion inputs/intermediates and inactive artifacts that may sit next to
// the prepared model assets but must never ship in the extension.
const EXCLUDED_MODEL_ASSET_GLOBS = [
  '**/model_fp16.q4f16-intermediate.onnx',
  '**/model_fp16.onnx',
  '**/model_fp16.onnx.data',
  '**/*conversion-manifest.json',
  '**/model_fp16-external-data-manifest.json',
  '**/manifest.json',
  '**/model_quantized.onnx',
];

const ONNX_RUNTIME_ASSETS = [
  // CPU/WASM path: ner-provider.ts pins wasmPaths to these when the
  // selected device is 'wasm'. The non-asyncify build has the known-good
  // CPU behavior; the asyncify build was producing degraded logits on some
  // Chrome+CPU combos.
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  // WebGPU path: ort.webgpu.bundle.min.mjs (bundled inside transformers.js
  // v4) only references the asyncify wasm pair, which is the build that
  // exports `webgpuInit`. The CPU degradation concern doesn't apply on the
  // WebGPU path since matmuls run on the GPU; the wasm is only orchestration.
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
];

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function resolveFromRoot(rootDir, relativePath) {
  return path.resolve(rootDir, relativePath);
}

function missingPreparedModelAssets(rootDir = process.cwd()) {
  const sourceRoot = resolveFromRoot(rootDir, ACTIVE_PREPARED_MODEL_SOURCE_DIR);
  return REQUIRED_MODEL_ASSETS.filter((relativePath) => {
    const candidate = path.join(sourceRoot, relativePath);
    return !fs.existsSync(candidate) || !fs.statSync(candidate).isFile();
  }).map(toPosixPath);
}

function missingOnnxRuntimeAssets(rootDir = process.cwd()) {
  const runtimeRoot = resolveFromRoot(rootDir, path.join('node_modules', 'onnxruntime-web', 'dist'));
  return ONNX_RUNTIME_ASSETS.filter((fileName) => {
    const candidate = path.join(runtimeRoot, fileName);
    return !fs.existsSync(candidate) || !fs.statSync(candidate).isFile();
  });
}

function modelAssetStatusMessage(missingAssets) {
  return [
    'Prepared BardsAI transformer NER model assets are missing, so the extension build will package regex/fixture NER support only.',
    `Missing from ${ACTIVE_PREPARED_MODEL_SOURCE_DIR}: ${missingAssets.join(', ')}.`,
    'Run `npm run prepare:model:bardsai -- --source-dir <dir>` before building to package the local model.',
  ].join(' ');
}

function getNerAssetCopyPatterns(rootDir = process.cwd()) {
  return [
    {
      from: resolveFromRoot(rootDir, ACTIVE_PREPARED_MODEL_SOURCE_DIR),
      to: ACTIVE_PACKAGED_MODEL_DIR,
      noErrorOnMissing: true,
      globOptions: { ignore: EXCLUDED_MODEL_ASSET_GLOBS },
    },
    ...ONNX_RUNTIME_ASSETS.map((fileName) => ({
      from: resolveFromRoot(rootDir, path.join('node_modules', 'onnxruntime-web', 'dist', fileName)),
      to: `${PACKAGED_ONNX_RUNTIME_DIR}/[name][ext]`,
    })),
  ];
}

class LocalNerAssetsPlugin {
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.cwd();
    this.requirePreparedModel = Boolean(options.requirePreparedModel);
  }

  apply(compiler) {
    const checkAssets = () => {
      const missingRuntimeAssets = missingOnnxRuntimeAssets(this.rootDir);
      if (missingRuntimeAssets.length > 0) {
        throw new Error(
          `Missing ONNX Runtime Web assets in node_modules/onnxruntime-web/dist: ${missingRuntimeAssets.join(', ')}. Run npm install before building.`
        );
      }

      const missingModelAssets = missingPreparedModelAssets(this.rootDir);
      if (missingModelAssets.length === 0) return;

      const message = modelAssetStatusMessage(missingModelAssets);
      if (this.requirePreparedModel) {
        throw new Error(message);
      }

      const logger = compiler.getInfrastructureLogger
        ? compiler.getInfrastructureLogger('LocalNerAssetsPlugin')
        : null;
      if (logger && typeof logger.warn === 'function') {
        logger.warn(message);
      } else {
        console.warn(message);
      }
    };

    compiler.hooks.beforeRun.tap('LocalNerAssetsPlugin', checkAssets);
    compiler.hooks.watchRun.tap('LocalNerAssetsPlugin', checkAssets);
  }
}

module.exports = {
  ACTIVE_PACKAGED_MODEL_DIR,
  ACTIVE_PREPARED_MODEL_SOURCE_DIR,
  EXCLUDED_MODEL_ASSET_GLOBS,
  LocalNerAssetsPlugin,
  ONNX_RUNTIME_ASSETS,
  PACKAGED_BARDSAI_MODEL_DIR,
  PACKAGED_MODEL_DIR,
  PACKAGED_ONNX_RUNTIME_DIR,
  PREPARED_BARDSAI_MODEL_SOURCE_DIR,
  PREPARED_MODEL_SOURCE_DIR,
  REQUIRED_MODEL_ASSETS,
  getNerAssetCopyPatterns,
  missingOnnxRuntimeAssets,
  missingPreparedModelAssets,
  modelAssetStatusMessage,
};
