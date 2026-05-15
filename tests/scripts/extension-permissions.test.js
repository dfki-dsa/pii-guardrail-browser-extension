const {
  REQUIRED_PERMISSIONS,
  SUPPORTED_HOST_PERMISSIONS,
  checkExtensionPermissions,
} = require('../../scripts/check-extension-permissions');

function validManifest(overrides = {}) {
  return {
    permissions: [...REQUIRED_PERMISSIONS],
    host_permissions: [...SUPPORTED_HOST_PERMISSIONS],
    content_scripts: [
      { matches: [...SUPPORTED_HOST_PERMISSIONS], js: ['content/content-script.js'] },
      { matches: [...SUPPORTED_HOST_PERMISSIONS], js: ['content/clipboard-interceptor-page.js'] },
    ],
    web_accessible_resources: [
      {
        resources: ['wasm/*.wasm', 'vendor/onnxruntime-web/*'],
        matches: [...SUPPORTED_HOST_PERMISSIONS],
      },
    ],
    ...overrides,
  };
}

describe('extension permission audit', () => {
  test('accepts the public beta manifest permission surface', () => {
    expect(checkExtensionPermissions(validManifest())).toEqual([]);
  });

  test('rejects activeTab and unsupported host permissions', () => {
    const errors = checkExtensionPermissions(
      validManifest({
        permissions: [...REQUIRED_PERMISSIONS, 'activeTab'],
        host_permissions: [...SUPPORTED_HOST_PERMISSIONS, 'https://example.com/*'],
      })
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('permissions must be exactly'),
        'activeTab is not used by the extension and must not be declared.',
        expect.stringContaining('host_permissions must be exactly'),
      ])
    );
  });

  test('rejects unsupported content script or web-accessible-resource matches', () => {
    const errors = checkExtensionPermissions(
      validManifest({
        content_scripts: [{ matches: ['<all_urls>'], js: ['content/content-script.js'] }],
        web_accessible_resources: [{ resources: ['wasm/*.wasm'], matches: ['<all_urls>'] }],
      })
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('content_scripts[0].matches must be exactly'),
        expect.stringContaining('web_accessible_resources[0].matches must be exactly'),
      ])
    );
  });
});
