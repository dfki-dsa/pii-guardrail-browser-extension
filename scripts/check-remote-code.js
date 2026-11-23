#!/usr/bin/env node

// Fails when the built extension references remote code origins.
//
// Chrome Web Store rejects Manifest V3 items that include remotely hosted
// code, and its review scans the bundle without running it. A URL to a CDN
// in shipped JS is enough to get flagged, even when the runtime never uses it
// (0.5.1 was rejected for the Transformers.js jsdelivr default).

const fs = require('fs');
const path = require('path');

const SCANNED_EXTENSIONS = /\.(js|mjs|cjs|html)$/;

const FORBIDDEN_REMOTE_CODE_PATTERNS = [
  { id: 'cdn.jsdelivr.net', regex: /cdn\.jsdelivr\.net/g },
  { id: 'unpkg.com', regex: /unpkg\.com/g },
  { id: 'cdnjs.cloudflare.com', regex: /cdnjs\.cloudflare\.com/g },
  { id: 'esm.sh', regex: /\besm\.sh\b/g },
  { id: 'cdn.skypack.dev', regex: /cdn\.skypack\.dev/g },
  { id: 'ga.jspm.io', regex: /ga\.jspm\.io/g },
  { id: 'remote model host', regex: /remoteHost\s*:\s*["'`]https?:\/\//g },
];

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function listScannableFiles(distDir) {
  const files = [];
  function walk(dir) {
    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolutePath = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        walk(absolutePath);
      } else if (dirent.isFile() && SCANNED_EXTENSIONS.test(dirent.name)) {
        files.push({ absolutePath, relativePath: toPosixPath(path.relative(distDir, absolutePath)) });
      }
    }
  }
  walk(distDir);
  return files;
}

function excerpt(text, index, radius = 60) {
  return text.slice(Math.max(0, index - radius), index + radius).replace(/\s+/g, ' ').trim();
}

// `entries` lets the packager scan exactly the files that go into the zip.
function scanRemoteCode(distDir, entries = listScannableFiles(distDir)) {
  const findings = [];
  for (const entry of entries) {
    if (!SCANNED_EXTENSIONS.test(entry.relativePath)) continue;
    const text = fs.readFileSync(entry.absolutePath, 'utf8');
    for (const { id, regex } of FORBIDDEN_REMOTE_CODE_PATTERNS) {
      regex.lastIndex = 0;
      for (const match of text.matchAll(regex)) {
        findings.push({ file: entry.relativePath, id, excerpt: excerpt(text, match.index ?? 0) });
      }
    }
  }
  return findings;
}

function formatFindings(findings) {
  return [
    'Remote code check failed. Chrome Web Store rejects MV3 packages that reference remote code:',
    ...findings.map((finding) => `- ${finding.file}: ${finding.id} … ${finding.excerpt} …`),
  ].join('\n');
}

function assertNoRemoteCode(distDir, entries) {
  const findings = scanRemoteCode(distDir, entries);
  if (findings.length > 0) {
    throw new Error(formatFindings(findings));
  }
}

function main(argv = process.argv.slice(2)) {
  const distDir = path.resolve(argv[0] || 'dist');
  if (!fs.existsSync(distDir)) {
    console.error(`Extension build output is missing: ${distDir}. Run npm run build:ext first.`);
    process.exitCode = 1;
    return;
  }
  const findings = scanRemoteCode(distDir);
  if (findings.length > 0) {
    console.error(formatFindings(findings));
    process.exitCode = 1;
    return;
  }
  console.log(`Remote code check passed for ${distDir}.`);
}

if (require.main === module) {
  main();
}

module.exports = {
  FORBIDDEN_REMOTE_CODE_PATTERNS,
  assertNoRemoteCode,
  scanRemoteCode,
};
