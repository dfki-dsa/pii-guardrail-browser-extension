const fs = require('fs');
const path = require('path');

const SOURCE_DIRS = ['src'];

const FORBIDDEN_RUNTIME_PATTERNS = [
  { id: 'fetch', regex: /\bfetch\s*\(/g },
  { id: 'XMLHttpRequest', regex: /\bXMLHttpRequest\b/g },
  { id: 'sendBeacon', regex: /\bsendBeacon\b/g },
  { id: 'WebSocket', regex: /\bWebSocket\b/g },
  { id: 'EventSource', regex: /\bEventSource\b/g },
  { id: 'remote-import', regex: /\bimportScripts\s*\(\s*['"]https?:\/\//g },
  { id: 'remote-script-url', regex: /<script\b[^>]+\bsrc=["']https?:\/\//g },
];

const ALLOWED_RUNTIME_FINDINGS = [
  {
    file: 'src/offscreen/ner-provider.ts',
    id: 'fetch',
    snippet: "fetch(url, { method: 'HEAD' })",
    reason: 'local extension asset existence check for packaged model/runtime files',
  },
];

const FORBIDDEN_PACKAGE_NAME_PATTERNS = [
  /(^|[/@-])analytics($|[/@-])/i,
  /(^|[/@-])telemetry($|[/@-])/i,
  /(^|[/@-])sentry($|[/@-])/i,
  /(^|[/@-])posthog($|[/@-])/i,
  /(^|[/@-])segment($|[/@-])/i,
  /(^|[/@-])mixpanel($|[/@-])/i,
  /(^|[/@-])amplitude($|[/@-])/i,
  /(^|[/@-])datadog($|[/@-])/i,
  /(^|[/@-])bugsnag($|[/@-])/i,
  /(^|[/@-])rollbar($|[/@-])/i,
  /(^|[/@-])newrelic($|[/@-])/i,
  /(^|[/@-])google-analytics($|[/@-])/i,
];

function posixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function walkFiles(rootDir, relativeDir) {
  const absoluteDir = path.join(rootDir, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];

  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(rootDir, relativePath));
    } else if (/\.(ts|js|svelte|html|css)$/.test(entry.name)) {
      files.push(posixPath(relativePath));
    }
  }
  return files;
}

function lineNumberForIndex(text, index) {
  return text.slice(0, index).split('\n').length;
}

function lineAt(text, index) {
  const before = text.lastIndexOf('\n', index);
  const after = text.indexOf('\n', index);
  return text.slice(before + 1, after === -1 ? text.length : after).trim();
}

function isAllowedRuntimeFinding(finding) {
  return ALLOWED_RUNTIME_FINDINGS.some((allowed) =>
    allowed.file === finding.file &&
    allowed.id === finding.id &&
    finding.lineText.includes(allowed.snippet)
  );
}

function scanRuntimeNetworkPrimitives(rootDir) {
  const findings = [];
  const files = SOURCE_DIRS.flatMap((dir) => walkFiles(rootDir, dir));

  for (const file of files) {
    const text = fs.readFileSync(path.join(rootDir, file), 'utf8');
    for (const pattern of FORBIDDEN_RUNTIME_PATTERNS) {
      pattern.regex.lastIndex = 0;
      for (const match of text.matchAll(pattern.regex)) {
        findings.push({
          file,
          line: lineNumberForIndex(text, match.index ?? 0),
          lineText: lineAt(text, match.index ?? 0),
          id: pattern.id,
        });
      }
    }
  }

  return findings;
}

function dependencyNames(packageJson) {
  return [
    ...Object.keys(packageJson.dependencies || {}),
    ...Object.keys(packageJson.devDependencies || {}),
    ...Object.keys(packageJson.optionalDependencies || {}),
    ...Object.keys(packageJson.peerDependencies || {}),
  ].sort();
}

function scanPackageNames(packageJson) {
  return dependencyNames(packageJson).filter((name) =>
    FORBIDDEN_PACKAGE_NAME_PATTERNS.some((pattern) => pattern.test(name))
  );
}

function checkTransformersLocalOnlyConfig(rootDir) {
  const file = 'src/offscreen/ner-provider.ts';
  const text = fs.readFileSync(path.join(rootDir, file), 'utf8');
  const requirements = [
    {
      snippet: 'transformers.env.allowRemoteModels = false',
      message: 'Transformers.js must keep remote model loading disabled.',
    },
    {
      snippet: 'transformers.env.allowLocalModels = true',
      message: 'Transformers.js must keep local model loading enabled.',
    },
    {
      snippet: 'transformers.env.localModelPath = getExtensionUrl(MODEL_ASSET_ROOT)',
      message: 'Transformers.js local model path must resolve through chrome.runtime.getURL.',
    },
    {
      snippet: 'transformers.env.useBrowserCache = false',
      message: 'Transformers.js browser cache must stay disabled for packaged assets.',
    },
    {
      snippet: 'transformers.env.useFSCache = false',
      message: 'Transformers.js filesystem cache must stay disabled for packaged assets.',
    },
  ];

  return requirements
    .filter((requirement) => !text.includes(requirement.snippet))
    .map((requirement) => `${file}: ${requirement.message}`);
}

function checkPrivacyBoundary(rootDir = process.cwd()) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const runtimeFindings = scanRuntimeNetworkPrimitives(rootDir);
  const unapprovedRuntimeFindings = runtimeFindings.filter((finding) => !isAllowedRuntimeFinding(finding));
  const forbiddenPackages = scanPackageNames(packageJson);
  const transformerConfigErrors = checkTransformersLocalOnlyConfig(rootDir);
  const errors = [];

  for (const finding of unapprovedRuntimeFindings) {
    errors.push(`${finding.file}:${finding.line} uses ${finding.id}: ${finding.lineText}`);
  }

  for (const name of forbiddenPackages) {
    errors.push(`package.json declares forbidden analytics/telemetry/crash-reporting dependency "${name}".`);
  }

  errors.push(...transformerConfigErrors);

  return {
    errors,
    allowedRuntimeFindings: runtimeFindings.filter(isAllowedRuntimeFinding).map((finding) => ({
      ...finding,
      reason: ALLOWED_RUNTIME_FINDINGS.find((allowed) =>
        allowed.file === finding.file &&
        allowed.id === finding.id &&
        finding.lineText.includes(allowed.snippet)
      )?.reason,
    })),
  };
}

function main() {
  const result = checkPrivacyBoundary();
  if (result.errors.length > 0) {
    console.error(['Privacy boundary check failed:', ...result.errors.map((error) => `- ${error}`)].join('\n'));
    process.exitCode = 1;
    return;
  }

  const allowedSummary = result.allowedRuntimeFindings.map(
    (finding) => `${finding.file}:${finding.line} ${finding.id} (${finding.reason})`
  );
  console.log(
    [
      'Privacy boundary check passed.',
      ...allowedSummary.map((line) => `Allowed runtime network primitive: ${line}`),
    ].join('\n')
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  ALLOWED_RUNTIME_FINDINGS,
  FORBIDDEN_PACKAGE_NAME_PATTERNS,
  checkPrivacyBoundary,
  scanPackageNames,
  scanRuntimeNetworkPrimitives,
};
