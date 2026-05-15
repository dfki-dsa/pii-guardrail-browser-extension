#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_DATASET = 'ai4privacy/pii-masking-openpii-1m';
const DEFAULT_REVISION = 'main';
const DEFAULT_CACHE_DIR = path.join(ROOT, 'benchmarks', 'cache', 'openpii');
const DEFAULT_FILES = ['data/train.jsonl', 'data/validation.jsonl'];
const MANIFEST_FILE = 'manifest.json';

function usage() {
  return `
Download AI4Privacy OpenPII dataset files into the local ignored benchmark cache.

Usage:
  node scripts/download-openpii-dataset.js [--cache-dir <path>] [--dataset <id>] [--revision <rev>] [--file <path>] [--force]

Options:
  --cache-dir <path>  Cache directory. Default: benchmarks/cache/openpii
  --dataset <id>      Hugging Face dataset id. Default: ${DEFAULT_DATASET}
  --revision <rev>    Hugging Face revision or commit. Default: ${DEFAULT_REVISION}
  --file <path>       Dataset repository file to download. Repeatable.
  --force             Redownload files that already exist.
  --help              Show this help.
`.trim();
}

function parseArgs(argv) {
  const options = {
    cacheDir: DEFAULT_CACHE_DIR,
    dataset: DEFAULT_DATASET,
    revision: DEFAULT_REVISION,
    files: [],
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
      index += 1;
      return value;
    };

    switch (arg) {
      case '--cache-dir':
        options.cacheDir = path.resolve(ROOT, next());
        break;
      case '--dataset':
        options.dataset = next();
        break;
      case '--revision':
        options.revision = next();
        break;
      case '--file':
        options.files.push(next());
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

  if (options.files.length === 0) options.files = [...DEFAULT_FILES];
  validateOptions(options);
  return options;
}

function validateOptions(options) {
  if (options.help) return;
  if (!options.dataset || options.dataset.startsWith('-')) {
    throw new Error('--dataset must be a non-empty dataset id.');
  }
  if (!options.revision || options.revision.startsWith('-')) {
    throw new Error('--revision must be a non-empty revision.');
  }
  for (const repoFile of options.files) {
    normalizeRepoPath(repoFile);
  }
}

async function downloadOpenPiiDataset(options, deps = {}) {
  const activeFetch = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? (() => new Date());
  const write = deps.write ?? (() => {});

  if (typeof activeFetch !== 'function') {
    throw new Error('No fetch implementation is available in this Node runtime.');
  }

  try {
    fs.mkdirSync(options.cacheDir, { recursive: true });
  } catch (error) {
    throw new Error(`Unable to create cache directory ${options.cacheDir}: ${error.message}`);
  }

  const repo = await fetchDatasetInfo(options.dataset, options.revision, activeFetch);
  const manifest = {
    dataset: options.dataset,
    requestedRevision: options.revision,
    revision: options.revision,
    resolvedRevision: resolveRevision(repo),
    sourceUrl: datasetUrl(options.dataset),
    cacheDir: toRootRelativePath(options.cacheDir),
    downloadedAt: now().toISOString(),
    files: [],
  };

  for (const repoFile of options.files) {
    const normalizedRepoFile = normalizeRepoPath(repoFile);
    const url = datasetFileUrl(options.dataset, options.revision, normalizedRepoFile);
    const targetPath = path.join(options.cacheDir, normalizedRepoFile);

    if (fs.existsSync(targetPath) && !options.force) {
      const stat = fs.statSync(targetPath);
      manifest.files.push({
        repoPath: normalizedRepoFile,
        path: toRootRelativePath(targetPath),
        url,
        bytes: stat.size,
        state: 'skipped',
        skipped: true,
        downloaded: false,
      });
      write(`Using cached ${toRootRelativePath(targetPath)}\n`);
      continue;
    }

    write(`Downloading ${normalizedRepoFile}...\n`);
    await downloadFile(url, targetPath, activeFetch);
    const stat = fs.statSync(targetPath);
    manifest.files.push({
      repoPath: normalizedRepoFile,
      path: toRootRelativePath(targetPath),
      url,
      bytes: stat.size,
      state: 'downloaded',
      skipped: false,
      downloaded: true,
    });
  }

  const manifestPath = path.join(options.cacheDir, MANIFEST_FILE);
  try {
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) {
    throw new Error(`Unable to write manifest ${manifestPath}: ${error.message}`);
  }
  write(`Manifest: ${toRootRelativePath(manifestPath)}\n`);
  return { manifest, manifestPath };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  await downloadOpenPiiDataset(options, {
    write: (message) => process.stdout.write(message),
  });
}

async function fetchDatasetInfo(dataset, revision, activeFetch = globalThis.fetch) {
  const url = `https://huggingface.co/api/datasets/${encodePathSegments(dataset)}/revision/${encodeURIComponent(revision)}`;
  try {
    const response = await activeFetch(url);
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

async function downloadFile(url, targetPath, activeFetch = globalThis.fetch) {
  const response = await activeFetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status} ${response.statusText ?? ''}`.trim());
  }

  const tempPath = `${targetPath}.tmp`;
  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  } catch (error) {
    throw new Error(`Unable to prepare download directory ${path.dirname(targetPath)}: ${error.message}`);
  }

  try {
    await pipeline(readableBody(response.body), fs.createWriteStream(tempPath));
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw new Error(`Unable to write downloaded file ${targetPath}: ${error.message}`);
  }

  try {
    fs.renameSync(tempPath, targetPath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw new Error(`Unable to finalize downloaded file ${targetPath}: ${error.message}`);
  }
}

function readableBody(body) {
  if (typeof body.pipe === 'function') return body;
  if (Readable.fromWeb && typeof body.getReader === 'function') return Readable.fromWeb(body);
  return Readable.from(body);
}

function datasetUrl(dataset) {
  return `https://huggingface.co/datasets/${encodePathSegments(dataset)}`;
}

function datasetFileUrl(dataset, revision, repoFile) {
  return `${datasetUrl(dataset)}/resolve/${encodeURIComponent(revision)}/${encodePathSegments(repoFile)}`;
}

function encodePathSegments(value) {
  return String(value)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function normalizeRepoPath(repoFile) {
  if (!repoFile || repoFile.startsWith('-')) {
    throw new Error('--file must be a non-empty repository path.');
  }
  if (path.isAbsolute(repoFile)) {
    throw new Error(`Dataset file paths must be repository-relative: ${repoFile}`);
  }
  const normalized = repoFile.split('\\').join('/');
  if (normalized.split('/').includes('..')) {
    throw new Error(`Dataset file paths cannot traverse directories: ${repoFile}`);
  }
  return normalized;
}

function resolveRevision(repo) {
  return repo?.sha ?? repo?.id ?? repo?.siblings?.[0]?.lfs?.oid;
}

function toRootRelativePath(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_CACHE_DIR,
  DEFAULT_DATASET,
  DEFAULT_FILES,
  DEFAULT_REVISION,
  MANIFEST_FILE,
  datasetFileUrl,
  downloadFile,
  downloadOpenPiiDataset,
  fetchDatasetInfo,
  parseArgs,
  usage,
};
