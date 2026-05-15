const fs = require('fs');
const os = require('os');
const path = require('path');

const { checkVersion, setVersion } = require('../../scripts/version');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFixtureProject(root, version = '0.2.0') {
  writeJson(path.join(root, 'package.json'), {
    name: 'privacy-guardrail',
    version,
  });
  writeJson(path.join(root, 'package-lock.json'), {
    name: 'privacy-guardrail',
    version,
    packages: {
      '': {
        name: 'privacy-guardrail',
        version,
      },
    },
  });
  writeJson(path.join(root, 'manifest.json'), {
    manifest_version: 3,
    version,
  });
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), `# Changelog\n\n## [${version}] - Public Beta\n`);
}

describe('release version tooling', () => {
  let tempRoot;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-version-'));
    writeFixtureProject(tempRoot);
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('sets package, lockfile, and manifest versions together', () => {
    setVersion('0.3.0', tempRoot);

    expect(JSON.parse(fs.readFileSync(path.join(tempRoot, 'package.json'), 'utf8')).version).toBe('0.3.0');
    const packageLock = JSON.parse(fs.readFileSync(path.join(tempRoot, 'package-lock.json'), 'utf8'));
    expect(packageLock.version).toBe('0.3.0');
    expect(packageLock.packages[''].version).toBe('0.3.0');
    expect(JSON.parse(fs.readFileSync(path.join(tempRoot, 'manifest.json'), 'utf8')).version).toBe('0.3.0');
  });

  test('passes when public release metadata is aligned', () => {
    const result = checkVersion({ rootDir: tempRoot, expectedVersion: '0.2.0' });

    expect(result.errors).toEqual([]);
    expect(result.expectedTag).toBe('v0.2.0');
  });

  test('fails with actionable errors for stale metadata', () => {
    writeJson(path.join(tempRoot, 'manifest.json'), {
      manifest_version: 3,
      version: '0.1.3',
    });
    fs.writeFileSync(path.join(tempRoot, 'CHANGELOG.md'), '# Changelog\n');

    const result = checkVersion({ rootDir: tempRoot, expectedVersion: '0.2.0' });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        'manifest.json version must be 0.2.0; found 0.1.3.',
        'CHANGELOG.md must contain a release heading for [0.2.0].',
      ])
    );
  });

  test('checks release archive and checksum names when present', () => {
    fs.mkdirSync(path.join(tempRoot, 'release'));
    fs.writeFileSync(path.join(tempRoot, 'release', 'privacy-guardrail-0.1.0.zip'), 'zip');
    fs.writeFileSync(path.join(tempRoot, 'release', 'privacy-guardrail-latest.sha256'), 'checksum');

    const result = checkVersion({ rootDir: tempRoot, expectedVersion: '0.2.0' });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        'release/privacy-guardrail-0.1.0.zip carries version 0.1.0; expected 0.2.0.',
        'release/privacy-guardrail-latest.sha256 must be named privacy-guardrail-0.2.0.zip or .sha256.',
      ])
    );
  });

  test('can require the expected Git tag during final release checks', () => {
    const result = checkVersion({ rootDir: tempRoot, expectedVersion: '0.2.0', requireTag: true });

    expect(result.errors).toEqual(['Expected Git tag v0.2.0 does not exist.']);
  });
});
