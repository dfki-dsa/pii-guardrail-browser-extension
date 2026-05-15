const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  checkPrivacyBoundary,
  scanPackageNames,
  scanRuntimeNetworkPrimitives,
} = require('../../scripts/check-privacy-boundary');

function makeTempRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-privacy-boundary-'));
  for (const [file, text] of Object.entries(files)) {
    const absolutePath = path.join(root, file);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, text);
  }
  return root;
}

const LOCAL_ONLY_NER_PROVIDER = `
async function defaultAssetExists(url) {
  const response = await fetch(url, { method: 'HEAD' });
  return response.ok;
}
function configureTransformersEnvironment(transformers, getExtensionUrl) {
  transformers.env.allowRemoteModels = false;
  transformers.env.allowLocalModels = true;
  transformers.env.localModelPath = getExtensionUrl(MODEL_ASSET_ROOT);
  transformers.env.useBrowserCache = false;
  transformers.env.useFSCache = false;
}
`;

describe('privacy boundary check', () => {
  test('accepts the current repository privacy boundary', () => {
    expect(checkPrivacyBoundary().errors).toEqual([]);
  });

  test('documents the approved packaged-asset fetch probe', () => {
    const result = checkPrivacyBoundary();

    expect(result.allowedRuntimeFindings).toEqual([
      expect.objectContaining({
        file: 'src/offscreen/ner-provider.ts',
        id: 'fetch',
        reason: expect.stringContaining('packaged model/runtime files'),
      }),
    ]);
  });

  test('rejects unapproved runtime network primitives', () => {
    const root = makeTempRepo({
      'package.json': JSON.stringify({ dependencies: {} }),
      'src/offscreen/ner-provider.ts': LOCAL_ONLY_NER_PROVIDER,
      'src/background/service-worker.ts': 'navigator.sendBeacon("https://telemetry.example", "{}");',
    });

    expect(checkPrivacyBoundary(root).errors).toEqual([
      expect.stringContaining('src/background/service-worker.ts:1 uses sendBeacon'),
    ]);
  });

  test('rejects analytics, telemetry, and crash-reporting dependencies', () => {
    expect(scanPackageNames({
      dependencies: {
        '@sentry/browser': '1.0.0',
        'posthog-js': '1.0.0',
        svelte: '5.0.0',
      },
    })).toEqual(['@sentry/browser', 'posthog-js']);
  });

  test('rejects remote model configuration changes', () => {
    const root = makeTempRepo({
      'package.json': JSON.stringify({ dependencies: {} }),
      'src/offscreen/ner-provider.ts': LOCAL_ONLY_NER_PROVIDER.replace(
        'transformers.env.allowRemoteModels = false',
        'transformers.env.allowRemoteModels = true'
      ),
    });

    expect(checkPrivacyBoundary(root).errors).toEqual([
      expect.stringContaining('Transformers.js must keep remote model loading disabled.'),
    ]);
  });

  test('runtime scanner reports raw findings before approval filtering', () => {
    const root = makeTempRepo({
      'src/offscreen/ner-provider.ts': LOCAL_ONLY_NER_PROVIDER,
    });

    expect(scanRuntimeNetworkPrimitives(root)).toEqual([
      expect.objectContaining({
        file: 'src/offscreen/ner-provider.ts',
        line: 3,
        id: 'fetch',
      }),
    ]);
  });
});
