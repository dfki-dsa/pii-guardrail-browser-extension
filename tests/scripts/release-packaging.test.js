const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');

const {
  createReleasePackage,
  isForbiddenPackageEntry,
  listPackageEntries,
  sha256File,
} = require('../../scripts/package-release');
const {
  ACTIVE_PREPARED_MODEL_SOURCE_DIR,
  ONNX_RUNTIME_ASSETS,
  REQUIRED_MODEL_ASSETS,
} = require('../../scripts/extension-packaging');

function writeFile(filePath, contents = 'fixture') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function writeReleaseMetadata(root, version = '0.2.0') {
  writeFile(path.join(root, 'package.json'), `${JSON.stringify({ name: 'privacy-guardrail', version }, null, 2)}\n`);
  writeFile(
    path.join(root, 'package-lock.json'),
    `${JSON.stringify({ name: 'privacy-guardrail', version, packages: { '': { version } } }, null, 2)}\n`
  );
  writeFile(path.join(root, 'manifest.json'), `${JSON.stringify({ manifest_version: 3, version }, null, 2)}\n`);
  writeFile(path.join(root, 'CHANGELOG.md'), `# Changelog\n\n## [${version}]\n\n- Beta release.\n`);
}

function writePreparedAssets(root) {
  const modelRoot = path.join(root, ACTIVE_PREPARED_MODEL_SOURCE_DIR);
  for (const asset of REQUIRED_MODEL_ASSETS) {
    writeFile(path.join(modelRoot, asset), 'model');
  }
  for (const asset of ONNX_RUNTIME_ASSETS) {
    writeFile(path.join(root, 'node_modules', 'onnxruntime-web', 'dist', asset), 'runtime');
  }
}

function writeDist(root) {
  writeFile(path.join(root, 'dist', 'manifest.json'), '{"manifest_version":3}\n');
  writeFile(path.join(root, 'dist', 'background', 'service-worker.js'), 'worker');
  writeFile(path.join(root, 'dist', 'background', 'service-worker.js.map'), 'source map');
  writeFile(path.join(root, 'dist', 'models', 'ner', 'bardsai-eu-pii-anonimization-multilang', 'config.json'), '{}\n');
  writeFile(path.join(root, 'dist', 'vendor', 'onnxruntime-web', 'ort-wasm-simd-threaded.wasm'), 'wasm');
  writeFile(path.join(root, 'dist', 'docs', 'issues', 'private.md'), 'private');
  writeFile(path.join(root, 'dist', '.private-docs', 'plan.md'), 'private');
  writeFile(path.join(root, 'dist', 'node_modules', 'left-pad', 'index.js'), 'source only');
}

function initCleanGitRepo(root) {
  childProcess.execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  childProcess.execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  childProcess.execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root });
  childProcess.execFileSync('git', ['add', '.'], { cwd: root, stdio: 'ignore' });
  childProcess.execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root, stdio: 'ignore' });
}

describe('official release packaging', () => {
  let tempRoot;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-release-packaging-'));
    writeReleaseMetadata(tempRoot);
    writePreparedAssets(tempRoot);
    writeDist(tempRoot);
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('classifies source maps and private/source-only paths as package exclusions', () => {
    expect(isForbiddenPackageEntry('background/service-worker.js.map')).toBe(true);
    expect(isForbiddenPackageEntry('.private-docs/plan.md')).toBe(true);
    expect(isForbiddenPackageEntry('docs/issues/public-beta-launch/README.md')).toBe(true);
    expect(isForbiddenPackageEntry('benchmarks/corpora/openpii.jsonl')).toBe(true);
    expect(isForbiddenPackageEntry('crate/pkg/privacy_guardrail_wasm.js')).toBe(true);
    expect(isForbiddenPackageEntry('node_modules/example/index.js')).toBe(true);
    expect(isForbiddenPackageEntry('background/service-worker.js')).toBe(false);
  });

  test('lists Chrome package entries from dist without source maps or private/source-only paths', () => {
    const { entries, excluded } = listPackageEntries(path.join(tempRoot, 'dist'));
    const entryNames = entries.map((entry) => entry.relativePath);

    expect(entryNames).toEqual([
      'background/service-worker.js',
      'manifest.json',
      'models/ner/bardsai-eu-pii-anonimization-multilang/config.json',
      'vendor/onnxruntime-web/ort-wasm-simd-threaded.wasm',
    ]);
    expect(excluded).toEqual([
      '.private-docs/plan.md',
      'background/service-worker.js.map',
      'docs/issues/private.md',
      'node_modules/left-pad/index.js',
    ]);
  });

  test('dry run validates package contents without requiring a clean Git worktree', () => {
    writeFile(path.join(tempRoot, 'untracked.txt'), 'dirty');
    fs.rmSync(path.join(tempRoot, 'generated'), { recursive: true, force: true });

    const result = createReleasePackage({
      rootDir: tempRoot,
      dryRun: true,
      skipBuild: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.zipPath).toBe(path.join(tempRoot, 'release', 'privacy-guardrail-0.2.0.zip'));
    expect(result.entries).toContain('manifest.json');
    expect(fs.existsSync(result.zipPath)).toBe(false);
  });

  test('release mode writes a versioned zip and matching SHA-256 checksum', () => {
    initCleanGitRepo(tempRoot);

    const result = createReleasePackage({
      rootDir: tempRoot,
      skipBuild: true,
    });

    const checksumText = fs.readFileSync(result.checksumPath, 'utf8');
    expect(path.basename(result.zipPath)).toBe('privacy-guardrail-0.2.0.zip');
    expect(path.basename(result.checksumPath)).toBe('privacy-guardrail-0.2.0.sha256');
    expect(checksumText).toBe(`${sha256File(result.zipPath)}  privacy-guardrail-0.2.0.zip\n`);

    const zip = new AdmZip(result.zipPath);
    const zipEntries = zip.getEntries().map((entry) => entry.entryName).sort();
    expect(zipEntries).toEqual([
      'background/service-worker.js',
      'manifest.json',
      'models/ner/bardsai-eu-pii-anonimization-multilang/config.json',
      'vendor/onnxruntime-web/ort-wasm-simd-threaded.wasm',
    ]);
  });
});
