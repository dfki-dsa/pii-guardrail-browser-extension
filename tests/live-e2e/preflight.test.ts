import path from 'node:path';
import { npmExecutable, runPreflight, type PreflightDependencies } from '../../e2e/live/preflight';

function dependencies(overrides: Partial<PreflightDependencies> = {}): PreflightDependencies {
  return {
    rootDir: '/repo',
    now: () => new Date('2026-09-04T10:00:00.000Z'),
    readPackageVersion: () => '0.4.2',
    readPlaywrightVersion: () => '1.55.0',
    gitCommit: async () => 'abc123',
    gitDirty: async () => true,
    missingModelAssets: () => [],
    pathExists: () => true,
    runBuild: jest.fn(async () => undefined),
    ...overrides,
  };
}

describe('live E2E build preflight', () => {
  test('uses the platform-specific npm executable', () => {
    expect(npmExecutable('win32')).toBe('npm.cmd');
    expect(npmExecutable('linux')).toBe('npm');
  });

  test('builds once with strict model resources and records source state', async () => {
    const deps = dependencies();
    const result = await runPreflight(
      { providers: ['chatgpt', 'claude'], headless: false, deepDiagnostics: false, skipBuild: false },
      deps,
    );

    expect(deps.runBuild).toHaveBeenCalledTimes(1);
    expect(result.buildDir).toBe(path.join(deps.rootDir, 'dist'));
    expect(result.metadata).toMatchObject({
      commit: 'abc123',
      dirty: true,
      authoritative: true,
      headed: true,
      extensionVersion: '0.4.2',
      providers: ['chatgpt', 'claude'],
    });
  });

  test('fails before building when required model assets are missing', async () => {
    const deps = dependencies({ missingModelAssets: () => ['onnx/model_q4f16.onnx.data'] });

    await expect(
      runPreflight(
        { providers: ['chatgpt'], headless: false, deepDiagnostics: false, skipBuild: false },
        deps,
      ),
    ).rejects.toMatchObject({ kind: 'harness-error', phase: 'preflight' });
    expect(deps.runBuild).not.toHaveBeenCalled();
  });

  test('classifies a build failure as a preflight harness error', async () => {
    const deps = dependencies({
      runBuild: jest.fn(async () => {
        throw new Error('build command failed');
      }),
    });

    await expect(
      runPreflight(
        { providers: ['chatgpt'], headless: false, deepDiagnostics: false, skipBuild: false },
        deps,
      ),
    ).rejects.toMatchObject({
      kind: 'harness-error',
      phase: 'preflight',
      message: 'Extension build failed: build command failed',
    });
  });

  test('marks skip-build and headless runs as diagnostic', async () => {
    const deps = dependencies({ missingModelAssets: () => ['source-only-model-asset'] });
    const result = await runPreflight(
      { providers: ['gemini'], headless: true, deepDiagnostics: true, skipBuild: true },
      deps,
    );

    expect(deps.runBuild).not.toHaveBeenCalled();
    expect(result.metadata).toMatchObject({
      authoritative: false,
      headed: false,
      deepDiagnostics: true,
    });
  });

  test('rejects a reused build that omits transformer assets', async () => {
    const manifestPath = path.join('/repo', 'dist', 'manifest.json');
    const deps = dependencies({
      pathExists: (candidate) => candidate === manifestPath,
    });

    await expect(
      runPreflight(
        { providers: ['chatgpt'], headless: true, deepDiagnostics: false, skipBuild: true },
        deps,
      ),
    ).rejects.toMatchObject({ kind: 'harness-error', phase: 'preflight' });
  });
});
