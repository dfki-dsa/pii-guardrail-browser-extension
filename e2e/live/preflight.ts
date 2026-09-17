import { execFile as execFileCallback } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { LiveE2EError } from './classifier';
import type { LiveRunMetadata, ProviderName } from './contracts';

const execFile = promisify(execFileCallback);
const packaging = require('../../scripts/extension-packaging') as {
  ACTIVE_PREPARED_MODEL_SOURCE_DIR: string;
  ACTIVE_PACKAGED_MODEL_DIR: string;
  REQUIRED_MODEL_ASSETS: string[];
};
const MODEL_ROOT = packaging.ACTIVE_PREPARED_MODEL_SOURCE_DIR;
const PACKAGED_MODEL_ROOT = packaging.ACTIVE_PACKAGED_MODEL_DIR;
const REQUIRED_MODEL_ASSETS = packaging.REQUIRED_MODEL_ASSETS;

export interface PreflightOptions {
  providers: ProviderName[];
  headless: boolean;
  deepDiagnostics: boolean;
  skipBuild: boolean;
}

export interface PreflightDependencies {
  rootDir: string;
  now(): Date;
  readPackageVersion(): string;
  readPlaywrightVersion(): string;
  gitCommit(): Promise<string>;
  gitDirty(): Promise<boolean>;
  missingModelAssets(): string[];
  pathExists(candidate: string): boolean;
  runBuild(): Promise<void>;
}

export interface PreflightResult {
  buildDir: string;
  metadata: LiveRunMetadata;
}

function runId(now: Date): string {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return `${timestamp}-${process.pid}`;
}

export function npmExecutable(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'npm.cmd' : 'npm';
}

export function createPreflightDependencies(rootDir = process.cwd()): PreflightDependencies {
  const readJsonVersion = (relativePath: string): string => {
    const json = JSON.parse(readFileSync(path.join(rootDir, relativePath), 'utf8')) as { version: string };
    return json.version;
  };

  return {
    rootDir,
    now: () => new Date(),
    readPackageVersion: () => readJsonVersion('manifest.json'),
    readPlaywrightVersion: () => readJsonVersion('node_modules/@playwright/test/package.json'),
    gitCommit: async () => {
      const { stdout } = await execFile('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: rootDir });
      return stdout.trim();
    },
    gitDirty: async () => {
      const { stdout } = await execFile('git', ['status', '--porcelain=v1'], { cwd: rootDir });
      return stdout.trim().length > 0;
    },
    missingModelAssets: () =>
      REQUIRED_MODEL_ASSETS.filter((asset) => !existsSync(path.join(rootDir, MODEL_ROOT, asset))),
    pathExists: existsSync,
    runBuild: async () => {
      await execFile(npmExecutable(), ['run', 'build'], {
        cwd: rootDir,
        env: { ...process.env, NER_MODEL_ASSETS_REQUIRED: '1' },
        maxBuffer: 20 * 1024 * 1024,
      });
    },
  };
}

export async function runPreflight(
  options: PreflightOptions,
  deps = createPreflightDependencies(),
): Promise<PreflightResult> {
  const missingAssets = options.skipBuild ? [] : deps.missingModelAssets();
  if (missingAssets.length > 0) {
    throw new LiveE2EError(
      'harness-error',
      'preflight',
      `Required BardsAI model assets are missing: ${missingAssets.join(', ')}. Run the model preparation step before the live suite.`,
    );
  }

  const buildDir = path.join(deps.rootDir, 'dist');
  if (!options.skipBuild) {
    try {
      await deps.runBuild();
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      throw new LiveE2EError('harness-error', 'preflight', `Extension build failed: ${cause}`);
    }
  }

  if (!deps.pathExists(path.join(buildDir, 'manifest.json'))) {
    throw new LiveE2EError(
      'harness-error',
      'preflight',
      `Built extension manifest not found at ${path.join(buildDir, 'manifest.json')}`,
    );
  }
  const missingBuiltAssets = REQUIRED_MODEL_ASSETS.filter(
    (asset) => !deps.pathExists(path.join(buildDir, PACKAGED_MODEL_ROOT, asset)),
  );
  if (missingBuiltAssets.length > 0) {
    throw new LiveE2EError(
      'harness-error',
      'preflight',
      `The selected extension build does not contain required BardsAI assets: ${missingBuiltAssets.join(', ')}`,
    );
  }

  const now = deps.now();
  const [commit, dirty] = await Promise.all([deps.gitCommit(), deps.gitDirty()]);
  const authoritative = !options.headless && !options.skipBuild;
  return {
    buildDir,
    metadata: {
      runId: runId(now),
      commit,
      dirty,
      authoritative,
      headed: !options.headless,
      deepDiagnostics: options.deepDiagnostics,
      providers: options.providers,
      startedAt: now.toISOString(),
      extensionVersion: deps.readPackageVersion(),
      playwrightVersion: deps.readPlaywrightVersion(),
      viewport: { width: 1440, height: 960 },
      locale: 'en-US',
      timezoneId: 'Europe/Berlin',
    },
  };
}
