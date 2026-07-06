#!/usr/bin/env node

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const {
  missingOnnxRuntimeAssets,
  missingPreparedModelAssets,
  modelAssetStatusMessage,
} = require('./extension-packaging');
const { checkVersion } = require('./version');

const DEFAULT_VERSION = null;
const RELEASE_DIR = 'release';

const FORBIDDEN_PACKAGE_PREFIXES = [
  '.private-docs/',
  'docs/issues/',
  'research/',
  'benchmarks/cache/',
  'benchmarks/corpora/',
  'benchmarks/results',
  'benchmarks/comparison',
  'tests-local/',
  'generated/',
  '.model-sources/',
  '.venv/',
  'coverage/',
  'node_modules/',
  'crate/pkg/',
  'crate/target/',
  'release/',
];

const FORBIDDEN_PACKAGE_FILES = new Set([
  '.DS_Store',
]);

const REQUIRED_PACKAGE_FILES = [
  'LICENSE',
  'NOTICE',
  'TERMS.html',
  'TERMS.md',
  'THIRD_PARTY_NOTICES.md',
];

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function readPackageVersion(rootDir) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  return packageJson.version;
}

function runStep(label, command, args, options = {}) {
  console.log(`\n> ${label}`);
  const result = childProcess.spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, ...(options.env || {}) },
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}.`);
  }
}

function assertCleanGitWorktree(rootDir) {
  const status = childProcess.execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (status.trim().length > 0) {
    throw new Error(
      [
        'Official release packaging requires a clean Git worktree.',
        'Commit, stash, or remove local changes before running `npm run package:release`.',
        'For local package-contents checks without the clean-tree guard, run `npm run package:dry-run`.',
      ].join(' ')
    );
  }
}

function assertPreparedReleaseAssets(rootDir) {
  const missingRuntimeAssets = missingOnnxRuntimeAssets(rootDir);
  if (missingRuntimeAssets.length > 0) {
    throw new Error(
      `Missing ONNX Runtime Web assets in node_modules/onnxruntime-web/dist: ${missingRuntimeAssets.join(', ')}. Run npm install before packaging.`
    );
  }

  const missingModelAssets = missingPreparedModelAssets(rootDir);
  if (missingModelAssets.length > 0) {
    throw new Error(modelAssetStatusMessage(missingModelAssets));
  }
}

function assertVersionAligned(rootDir, version) {
  const result = checkVersion({ rootDir, expectedVersion: version });
  if (result.errors.length > 0) {
    throw new Error(['Version check failed:', ...result.errors.map((error) => `- ${error}`)].join('\n'));
  }
}

function isForbiddenPackageEntry(relativePath) {
  if (relativePath.endsWith('.map')) return true;
  if (FORBIDDEN_PACKAGE_FILES.has(path.basename(relativePath))) return true;
  // Chrome Web Store rejects any nested file named manifest.json — it treats
  // every one as a competing extension manifest. The prepared NER model dirs
  // contain a metadata manifest.json that is not needed at runtime.
  if (relativePath !== 'manifest.json' && path.basename(relativePath) === 'manifest.json') return true;
  return FORBIDDEN_PACKAGE_PREFIXES.some((prefix) => relativePath === prefix.slice(0, -1) || relativePath.startsWith(prefix));
}

function listPackageEntries(distDir) {
  if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) {
    throw new Error(`Extension build output is missing: ${distDir}`);
  }

  const entries = [];
  const excluded = [];

  function walk(dir) {
    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolutePath = path.join(dir, dirent.name);
      const relativePath = toPosixPath(path.relative(distDir, absolutePath));

      if (dirent.isDirectory()) {
        walk(absolutePath);
        continue;
      }

      if (!dirent.isFile()) continue;

      if (isForbiddenPackageEntry(relativePath)) {
        excluded.push(relativePath);
        continue;
      }

      entries.push({ absolutePath, relativePath });
    }
  }

  walk(distDir);
  entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  excluded.sort();

  if (!entries.some((entry) => entry.relativePath === 'manifest.json')) {
    throw new Error('Package contents must include dist/manifest.json.');
  }

  const entryNames = new Set(entries.map((entry) => entry.relativePath));
  const missingRequiredFiles = REQUIRED_PACKAGE_FILES.filter((fileName) => !entryNames.has(fileName));
  if (missingRequiredFiles.length > 0) {
    throw new Error(`Package contents must include required legal files: ${missingRequiredFiles.join(', ')}.`);
  }

  return { entries, excluded };
}

function writeZip(entries, zipPath) {
  const zip = new AdmZip();
  for (const entry of entries) {
    zip.addFile(entry.relativePath, fs.readFileSync(entry.absolutePath));
  }
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  zip.writeZip(zipPath);
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function createReleasePackage(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const version = options.version || readPackageVersion(rootDir);
  const distDir = options.distDir || path.join(rootDir, 'dist');
  const releaseDir = options.releaseDir || path.join(rootDir, RELEASE_DIR);
  const dryRun = Boolean(options.dryRun);
  const skipBuild = Boolean(options.skipBuild);

  if (!dryRun) {
    assertCleanGitWorktree(rootDir);
  }
  assertVersionAligned(rootDir, version);
  if (!dryRun || !skipBuild) {
    assertPreparedReleaseAssets(rootDir);
  }

  if (!skipBuild) {
    runStep('WASM release build', npmCommand(), ['run', 'build:wasm'], { cwd: rootDir });
    runStep('Extension build with required BardsAI assets', npmCommand(), ['run', 'build:ext'], {
      cwd: rootDir,
      env: { NER_MODEL_ASSETS_REQUIRED: '1' },
    });
  }

  const { entries, excluded } = listPackageEntries(distDir);
  const fileName = `privacy-guardrail-${version}.zip`;
  const zipPath = path.join(releaseDir, fileName);
  const checksumPath = path.join(releaseDir, `privacy-guardrail-${version}.sha256`);

  if (dryRun) {
    return {
      dryRun: true,
      zipPath,
      checksumPath,
      entries: entries.map((entry) => entry.relativePath),
      excluded,
    };
  }

  writeZip(entries, zipPath);
  const checksum = sha256File(zipPath);
  fs.writeFileSync(checksumPath, `${checksum}  ${fileName}\n`);

  return {
    dryRun: false,
    zipPath,
    checksumPath,
    checksum,
    entries: entries.map((entry) => entry.relativePath),
    excluded,
  };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {
    command,
    version: DEFAULT_VERSION,
    dryRun: command === 'dry-run',
    skipBuild: command === 'dry-run',
  };

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--version') {
      const value = rest[i + 1];
      if (!value || value.startsWith('--')) throw new Error('--version requires a value.');
      options.version = value;
      i += 1;
      continue;
    }
    if (arg === '--skip-build') {
      options.skipBuild = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!['release', 'dry-run'].includes(options.command)) {
    throw new Error('Usage: node scripts/package-release.js <release|dry-run> [--version x.y.z] [--skip-build]');
  }

  const result = createReleasePackage(options);
  if (result.dryRun) {
    console.log(`Package dry run passed for ${result.zipPath}.`);
    console.log(`Would include ${result.entries.length} files; excluded ${result.excluded.length} generated or source-map files.`);
    return;
  }

  console.log(`Created ${result.zipPath}`);
  console.log(`Wrote ${result.checksumPath}`);
  console.log(`SHA-256: ${result.checksum}`);
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
  DEFAULT_VERSION,
  FORBIDDEN_PACKAGE_PREFIXES,
  REQUIRED_PACKAGE_FILES,
  assertCleanGitWorktree,
  assertPreparedReleaseAssets,
  createReleasePackage,
  isForbiddenPackageEntry,
  listPackageEntries,
  parseArgs,
  readPackageVersion,
  sha256File,
};
