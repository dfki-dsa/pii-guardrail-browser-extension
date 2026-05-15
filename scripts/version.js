const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const RELEASE_FILE_PATTERN = /^privacy-guardrail-(\d+\.\d+\.\d+)\.(zip|sha256)$/;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function assertValidVersion(version) {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`Version must use Chrome-compatible x.y.z numeric format; found "${version}".`);
  }
}

function setVersion(version, rootDir = process.cwd()) {
  assertValidVersion(version);

  const packagePath = path.join(rootDir, 'package.json');
  const lockPath = path.join(rootDir, 'package-lock.json');
  const manifestPath = path.join(rootDir, 'manifest.json');

  const packageJson = readJson(packagePath);
  const packageLock = readJson(lockPath);
  const manifest = readJson(manifestPath);

  packageJson.version = version;
  packageLock.version = version;
  if (packageLock.packages?.['']) {
    packageLock.packages[''].version = version;
  }
  manifest.version = version;

  writeJson(packagePath, packageJson);
  writeJson(lockPath, packageLock);
  writeJson(manifestPath, manifest);
}

function listReleaseFiles(rootDir) {
  const releaseDir = path.join(rootDir, 'release');
  if (!fs.existsSync(releaseDir)) return [];

  return fs.readdirSync(releaseDir)
    .filter((fileName) => fileName.endsWith('.zip') || fileName.endsWith('.sha256'))
    .sort();
}

function hasGitTag(rootDir, tagName) {
  try {
    const output = childProcess.execFileSync('git', ['tag', '--list', tagName], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output.trim() === tagName;
  } catch {
    return false;
  }
}

function checkVersion(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const packageJson = readJson(path.join(rootDir, 'package.json'));
  const packageLock = readJson(path.join(rootDir, 'package-lock.json'));
  const manifest = readJson(path.join(rootDir, 'manifest.json'));
  const changelog = fs.readFileSync(path.join(rootDir, 'CHANGELOG.md'), 'utf8');

  const expectedVersion = options.expectedVersion || packageJson.version;
  const expectedTag = `v${expectedVersion}`;
  const errors = [];
  const warnings = [];

  try {
    assertValidVersion(expectedVersion);
  } catch (error) {
    errors.push(error.message);
  }

  const versions = {
    'package.json': packageJson.version,
    'package-lock.json': packageLock.version,
    'package-lock.json packages[""]': packageLock.packages?.['']?.version,
    'manifest.json': manifest.version,
  };

  for (const [label, actualVersion] of Object.entries(versions)) {
    if (actualVersion !== expectedVersion) {
      errors.push(`${label} version must be ${expectedVersion}; found ${actualVersion || 'missing'}.`);
    }
  }

  if (!changelog.includes(`## [${expectedVersion}]`)) {
    errors.push(`CHANGELOG.md must contain a release heading for [${expectedVersion}].`);
  }

  for (const fileName of listReleaseFiles(rootDir)) {
    const match = RELEASE_FILE_PATTERN.exec(fileName);
    if (!match) {
      errors.push(`release/${fileName} must be named privacy-guardrail-${expectedVersion}.zip or .sha256.`);
      continue;
    }
    if (match[1] !== expectedVersion) {
      errors.push(`release/${fileName} carries version ${match[1]}; expected ${expectedVersion}.`);
    }
  }

  if (options.requireTag) {
    if (!hasGitTag(rootDir, expectedTag)) {
      errors.push(`Expected Git tag ${expectedTag} does not exist.`);
    }
  } else if (!hasGitTag(rootDir, expectedTag)) {
    warnings.push(`Expected Git tag for release: ${expectedTag}. Pass --require-tag during final release checks.`);
  }

  return {
    errors,
    warnings,
    expectedVersion,
    expectedTag,
  };
}

function parseArgs(argv) {
  const [command, maybeVersion, ...flags] = argv;
  const hasFlag = (flag) => flags.includes(flag) || maybeVersion === flag;
  const expectedVersion = maybeVersion && !maybeVersion.startsWith('--') ? maybeVersion : undefined;

  return {
    command,
    expectedVersion,
    requireTag: hasFlag('--require-tag'),
  };
}

function main(argv = process.argv.slice(2)) {
  const { command, expectedVersion, requireTag } = parseArgs(argv);

  if (command === 'set') {
    if (!expectedVersion) {
      throw new Error('Usage: npm run version:set -- <x.y.z>');
    }
    setVersion(expectedVersion);
    console.log(`Set release metadata version to ${expectedVersion}.`);
    return;
  }

  if (command === 'check') {
    const result = checkVersion({ expectedVersion, requireTag });
    for (const warning of result.warnings) {
      console.warn(`Warning: ${warning}`);
    }
    if (result.errors.length > 0) {
      console.error(['Version check failed:', ...result.errors.map((error) => `- ${error}`)].join('\n'));
      process.exitCode = 1;
      return;
    }

    console.log(`Version check passed for ${result.expectedVersion}; expected release tag is ${result.expectedTag}.`);
    return;
  }

  throw new Error('Usage: node scripts/version.js <set|check> [x.y.z] [--require-tag]');
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
  checkVersion,
  setVersion,
};
