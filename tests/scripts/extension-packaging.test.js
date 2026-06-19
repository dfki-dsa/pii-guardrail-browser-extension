const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  ACTIVE_PACKAGED_MODEL_DIR,
  ACTIVE_PREPARED_MODEL_SOURCE_DIR,
  LocalNerAssetsPlugin,
  ONNX_RUNTIME_ASSETS,
  PACKAGED_ONNX_RUNTIME_DIR,
  getNerAssetCopyPatterns,
  missingOnnxRuntimeAssets,
  missingPreparedModelAssets,
  modelAssetStatusMessage,
} = require('../../scripts/extension-packaging');

function writeFile(filePath, contents = 'fixture') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function writePreparedModel(root) {
  const modelRoot = path.join(root, ACTIVE_PREPARED_MODEL_SOURCE_DIR);
  writeFile(path.join(modelRoot, 'config.json'), '{}\n');
  writeFile(path.join(modelRoot, 'tokenizer.json'), '{}\n');
  writeFile(path.join(modelRoot, 'tokenizer_config.json'), '{}\n');
  writeFile(path.join(modelRoot, 'onnx', 'model_q4f16.onnx'), 'q4f16');
  writeFile(path.join(modelRoot, 'onnx', 'model_q4f16.onnx.data'), 'q4f16-data');
}

function writeOnnxRuntime(root) {
  for (const asset of ONNX_RUNTIME_ASSETS) {
    writeFile(path.join(root, 'node_modules', 'onnxruntime-web', 'dist', asset));
  }
}

function createCompiler() {
  const taps = {};
  return {
    warnings: [],
    hooks: {
      beforeRun: {
        tap(name, callback) {
          taps.beforeRun = callback;
        },
      },
      watchRun: {
        tap(name, callback) {
          taps.watchRun = callback;
        },
      },
    },
    getInfrastructureLogger() {
      return {
        warn: (message) => {
          this.warnings.push(message);
        },
      };
    },
    runHook(name) {
      taps[name]();
    },
  };
}

describe('extension NER asset packaging', () => {
  let tempRoot;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-extension-packaging-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('detects whether prepared model assets are complete', () => {
    expect(missingPreparedModelAssets(tempRoot)).toEqual([
      'config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'onnx/model_q4f16.onnx',
      'onnx/model_q4f16.onnx.data',
    ]);

    writePreparedModel(tempRoot);

    expect(missingPreparedModelAssets(tempRoot)).toEqual([]);
  });

  test('returns copy patterns matching the transformer provider resource paths', () => {
    const patterns = getNerAssetCopyPatterns(tempRoot);
    const runtimeFile = (name) =>
      expect.objectContaining({
        from: path.join(tempRoot, 'node_modules', 'onnxruntime-web', 'dist', name),
        to: `${PACKAGED_ONNX_RUNTIME_DIR}/[name][ext]`,
      });

    expect(patterns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: path.join(tempRoot, ACTIVE_PREPARED_MODEL_SOURCE_DIR),
          to: ACTIVE_PACKAGED_MODEL_DIR,
          noErrorOnMissing: true,
          // Only the q4f16 runtime model ships; conversion intermediates and
          // inactive q8/fp16 artifacts must be filtered out.
          globOptions: {
            ignore: [
              '**/model_fp16.q4f16-intermediate.onnx',
              '**/model_fp16.onnx',
              '**/model_fp16.onnx.data',
              '**/*conversion-manifest.json',
              '**/model_fp16-external-data-manifest.json',
              '**/manifest.json',
              '**/model_quantized.onnx',
            ],
          },
        }),
        runtimeFile('ort-wasm-simd-threaded.mjs'),
        runtimeFile('ort-wasm-simd-threaded.wasm'),
        runtimeFile('ort-wasm-simd-threaded.asyncify.mjs'),
        runtimeFile('ort-wasm-simd-threaded.asyncify.wasm'),
      ])
    );
  });

  test('declares packaged NER assets as extension resources', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../manifest.json'), 'utf8')
    );
    const resources = manifest.web_accessible_resources.flatMap((entry) => entry.resources);

    expect(resources).toEqual(
      expect.arrayContaining([
        'models/ner/bardsai-eu-pii-anonimization-multilang/*',
        'models/ner/bardsai-eu-pii-anonimization-multilang/onnx/*',
        'vendor/onnxruntime-web/*',
      ])
    );
    expect(resources).not.toEqual(
      expect.arrayContaining([
        'models/ner/ai4privacy/*',
        'models/ner/hikmaai-distilbert-pii/*',
      ])
    );
  });

  test('scopes web-accessible resources to monitored chat hosts', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../manifest.json'), 'utf8')
    );
    const monitoredHosts = [
      'https://chat.openai.com/*',
      'https://chatgpt.com/*',
      'https://claude.ai/*',
      'https://gemini.google.com/*',
    ];

    expect(manifest.web_accessible_resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          matches: monitoredHosts,
        }),
      ])
    );
  });

  test('injects the clipboard interceptor page script on every monitored chat host', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../manifest.json'), 'utf8')
    );
    const monitoredHosts = [
      'https://chat.openai.com/*',
      'https://chatgpt.com/*',
      'https://claude.ai/*',
      'https://gemini.google.com/*',
    ];
    const isolatedScript = manifest.content_scripts.find((entry) =>
      entry.js.includes('content/content-script.js')
    );
    const pageScript = manifest.content_scripts.find((entry) =>
      entry.js.includes('content/clipboard-interceptor-page.js')
    );

    expect(isolatedScript.matches).toEqual(monitoredHosts);
    expect(pageScript).toMatchObject({
      matches: monitoredHosts,
      run_at: 'document_start',
      world: 'MAIN',
    });
  });

  test('warns about missing prepared model assets by default', () => {
    writeOnnxRuntime(tempRoot);
    const compiler = createCompiler();
    const plugin = new LocalNerAssetsPlugin({ rootDir: tempRoot });

    plugin.apply(compiler);
    compiler.runHook('beforeRun');

    expect(compiler.warnings).toHaveLength(1);
    expect(compiler.warnings[0]).toContain('Prepared BardsAI transformer NER model assets are missing');
    expect(compiler.warnings[0]).toContain('npm run prepare:model:bardsai');
  });

  test('fails when prepared model assets are required', () => {
    writeOnnxRuntime(tempRoot);
    const compiler = createCompiler();
    const plugin = new LocalNerAssetsPlugin({
      rootDir: tempRoot,
      requirePreparedModel: true,
    });

    plugin.apply(compiler);

    expect(() => compiler.runHook('beforeRun')).toThrow(
      /Prepared BardsAI transformer NER model assets are missing/
    );
  });

  test('fails clearly when ONNX Runtime Web package assets are missing', () => {
    expect(missingOnnxRuntimeAssets(tempRoot)).toEqual(ONNX_RUNTIME_ASSETS);

    const compiler = createCompiler();
    const plugin = new LocalNerAssetsPlugin({ rootDir: tempRoot });
    plugin.apply(compiler);

    expect(() => compiler.runHook('beforeRun')).toThrow(/Missing ONNX Runtime Web assets/);
  });

  test('does not warn when model and runtime assets are present', () => {
    writePreparedModel(tempRoot);
    writeOnnxRuntime(tempRoot);
    const compiler = createCompiler();
    const plugin = new LocalNerAssetsPlugin({ rootDir: tempRoot });

    plugin.apply(compiler);
    compiler.runHook('watchRun');

    expect(compiler.warnings).toEqual([]);
    expect(modelAssetStatusMessage(['config.json'])).toContain(ACTIVE_PREPARED_MODEL_SOURCE_DIR);
  });
});
