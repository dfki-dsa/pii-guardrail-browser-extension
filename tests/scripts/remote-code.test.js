const fs = require('fs');
const os = require('os');
const path = require('path');

const { assertNoRemoteCode, scanRemoteCode } = require('../../scripts/check-remote-code');
const { stripRemoteDefaults } = require('../../scripts/strip-remote-defaults-loader');

const TRANSFORMERS_WEB = path.join(
  __dirname,
  '../../node_modules/@huggingface/transformers/dist/transformers.web.js'
);

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

describe('strip-remote-defaults-loader', () => {
  test('removes the jsdelivr wasmPaths default and huggingface.co remoteHost', () => {
    const source = [
      'const env = { remoteHost: "https://huggingface.co/", allowRemoteModels: true };',
      'const wasmPathPrefix = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNX_ENV.versions.web}/dist/`;',
      '// docs: https://huggingface.co/docs/transformers',
    ].join('\n');

    const output = stripRemoteDefaults(source, 'fixture.js');

    expect(output).not.toContain('cdn.jsdelivr.net');
    expect(output).toContain('remoteHost: ""');
    expect(output).toContain('const wasmPathPrefix = ``;');
    // Documentation links in comments and error strings are left alone.
    expect(output).toContain('https://huggingface.co/docs/transformers');
  });

  test('fails loudly when an expected default is missing', () => {
    expect(() => stripRemoteDefaults('remoteHost: "https://huggingface.co/"', 'fixture.js')).toThrow(
      /jsdelivr wasmPaths default in fixture\.js/
    );
  });

  test('matches the installed Transformers.js web build', () => {
    const output = stripRemoteDefaults(fs.readFileSync(TRANSFORMERS_WEB, 'utf8'), TRANSFORMERS_WEB);
    expect(output).not.toMatch(/cdn\.jsdelivr\.net/);
    expect(output).not.toMatch(/remoteHost:\s*"https:/);
  });
});

describe('check-remote-code', () => {
  let distDir;

  beforeEach(() => {
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-remote-code-'));
  });

  afterEach(() => {
    fs.rmSync(distDir, { recursive: true, force: true });
  });

  test('passes a bundle with only local paths and documentation links', () => {
    writeFile(path.join(distDir, 'offscreen', 'offscreen.js'), 'const u = "https://huggingface.co/docs/x"; remoteHost:""');
    writeFile(path.join(distDir, 'popup', 'popup.html'), '<script src="popup.js"></script>');

    expect(scanRemoteCode(distDir)).toEqual([]);
    expect(() => assertNoRemoteCode(distDir)).not.toThrow();
  });

  test('flags CDN URLs and remote model hosts in JS and HTML', () => {
    writeFile(
      path.join(distDir, 'offscreen', 'offscreen.js'),
      'const e=`https://cdn.jsdelivr.net/npm/onnxruntime-web@1/dist/`;const env={remoteHost:"https://huggingface.co/"}'
    );
    writeFile(path.join(distDir, 'options', 'options.html'), '<script src="https://unpkg.com/x@1"></script>');
    writeFile(path.join(distDir, 'THIRD_PARTY_NOTICES.md'), 'https://cdn.jsdelivr.net is mentioned in docs');

    const findings = scanRemoteCode(distDir);

    expect(findings.map((finding) => `${finding.file}:${finding.id}`).sort()).toEqual([
      'offscreen/offscreen.js:cdn.jsdelivr.net',
      'offscreen/offscreen.js:remote model host',
      'options/options.html:unpkg.com',
    ]);
    expect(() => assertNoRemoteCode(distDir)).toThrow(/Remote code check failed/);
  });
});
