// Webpack loader that removes remote-origin defaults from Transformers.js.
//
// Transformers.js sets two defaults that point at remote hosts:
//   - ONNX Runtime's wasmPaths default to cdn.jsdelivr.net; ORT later calls
//     `import()` on the `.mjs` path. Chrome Web Store review treats that as
//     remotely hosted code in a Manifest V3 item and rejects the upload.
//   - env.remoteHost defaults to huggingface.co for model downloads.
//
// ner-provider.ts overrides both at runtime (wasmPaths -> vendor/onnxruntime-web,
// allowRemoteModels = false), so these defaults are dead code. Review scans the
// code without running it, though, so the strings must not ship at all.
//
// Each replacement must match: if a Transformers.js upgrade changes the source,
// the build fails instead of silently shipping the remote default again.

const REPLACEMENTS = [
  {
    id: 'onnxruntime-web jsdelivr wasmPaths default',
    pattern: /`https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web@\$\{[^}`]+\}\/dist\/`/g,
    replacement: '``',
  },
  {
    id: 'huggingface.co remoteHost default',
    pattern: /remoteHost:\s*"https:\/\/huggingface\.co\/"/g,
    replacement: 'remoteHost: ""',
  },
];

function stripRemoteDefaults(source, resourcePath = '<unknown>') {
  let output = source;
  for (const { id, pattern, replacement } of REPLACEMENTS) {
    pattern.lastIndex = 0;
    if (!pattern.test(output)) {
      throw new Error(
        `strip-remote-defaults-loader: expected to find the ${id} in ${resourcePath}. ` +
          'Transformers.js may have changed; update scripts/strip-remote-defaults-loader.js.'
      );
    }
    pattern.lastIndex = 0;
    output = output.replace(pattern, replacement);
  }
  return output;
}

module.exports = function stripRemoteDefaultsLoader(source) {
  return stripRemoteDefaults(source, this.resourcePath);
};

module.exports.stripRemoteDefaults = stripRemoteDefaults;
module.exports.REPLACEMENTS = REPLACEMENTS;
