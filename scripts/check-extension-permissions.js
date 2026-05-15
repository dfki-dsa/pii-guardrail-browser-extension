const fs = require('fs');
const path = require('path');

const SUPPORTED_HOST_PERMISSIONS = [
  'https://chat.openai.com/*',
  'https://chatgpt.com/*',
  'https://claude.ai/*',
  'https://gemini.google.com/*',
];

const REQUIRED_PERMISSIONS = ['storage', 'offscreen', 'tabs'];

function readManifest(rootDir = process.cwd()) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
}

function sameStringSet(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && expected.every((value) => actual.includes(value));
}

function describeMismatch(label, actual, expected) {
  return `${label} must be exactly ${JSON.stringify(expected)}; found ${JSON.stringify(actual)}.`;
}

function checkExtensionPermissions(manifest) {
  const errors = [];

  if (!sameStringSet(manifest.permissions, REQUIRED_PERMISSIONS)) {
    errors.push(describeMismatch('permissions', manifest.permissions, REQUIRED_PERMISSIONS));
  }

  if (manifest.permissions?.includes('activeTab')) {
    errors.push('activeTab is not used by the extension and must not be declared.');
  }

  if (!sameStringSet(manifest.host_permissions, SUPPORTED_HOST_PERMISSIONS)) {
    errors.push(describeMismatch('host_permissions', manifest.host_permissions, SUPPORTED_HOST_PERMISSIONS));
  }

  for (const [index, entry] of (manifest.content_scripts || []).entries()) {
    if (!sameStringSet(entry.matches, SUPPORTED_HOST_PERMISSIONS)) {
      errors.push(describeMismatch(`content_scripts[${index}].matches`, entry.matches, SUPPORTED_HOST_PERMISSIONS));
    }
  }

  for (const [index, entry] of (manifest.web_accessible_resources || []).entries()) {
    if (!sameStringSet(entry.matches, SUPPORTED_HOST_PERMISSIONS)) {
      errors.push(
        describeMismatch(`web_accessible_resources[${index}].matches`, entry.matches, SUPPORTED_HOST_PERMISSIONS)
      );
    }
  }

  return errors;
}

function main() {
  const errors = checkExtensionPermissions(readManifest());
  if (errors.length > 0) {
    console.error(['Chrome permission audit failed:', ...errors.map((error) => `- ${error}`)].join('\n'));
    process.exitCode = 1;
    return;
  }

  console.log('Chrome permission audit passed.');
}

if (require.main === module) {
  main();
}

module.exports = {
  REQUIRED_PERMISSIONS,
  SUPPORTED_HOST_PERMISSIONS,
  checkExtensionPermissions,
};
