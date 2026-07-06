import {
  packagedTermsUrl,
  PACKAGED_TERMS_PATH,
  PUBLIC_PROJECT_LINKS,
  PUBLIC_PROJECT_REPO_URL,
  SECURITY_SUPPORT_EMAIL,
} from '../../src/shared/project-links';

describe('public project links', () => {
  test('centralizes GitHub public beta URLs under the public repo', () => {
    expect(PUBLIC_PROJECT_REPO_URL).toBe('https://github.com/dfki-dsa/pii-guardrail-browser-extension');
    expect(PUBLIC_PROJECT_LINKS).toEqual({
      repo: PUBLIC_PROJECT_REPO_URL,
      issues: `${PUBLIC_PROJECT_REPO_URL}/issues`,
      newIssue: `${PUBLIC_PROJECT_REPO_URL}/issues/new/choose`,
      privacy: `${PUBLIC_PROJECT_REPO_URL}/blob/main/PRIVACY.md`,
      security: `${PUBLIC_PROJECT_REPO_URL}/blob/main/SECURITY.md`,
      support: `${PUBLIC_PROJECT_REPO_URL}/blob/main/SUPPORT.md`,
      impressum: `${PUBLIC_PROJECT_REPO_URL}/blob/main/IMPRESSUM.md`,
      terms: `${PUBLIC_PROJECT_REPO_URL}/blob/main/TERMS.md`,
    });
  });

  test('exposes the sensitive-report contact explicitly', () => {
    expect(SECURITY_SUPPORT_EMAIL).toBe('pii@dfki.de');
  });

  test('resolves terms to the packaged extension file when Chrome runtime is available', () => {
    const originalChrome = globalThis.chrome;
    (globalThis as any).chrome = {
      runtime: {
        getURL: jest.fn((path: string) => `chrome-extension://test/${path}`),
      },
    };

    expect(PACKAGED_TERMS_PATH).toBe('TERMS.html');
    expect(packagedTermsUrl()).toBe('chrome-extension://test/TERMS.html');

    globalThis.chrome = originalChrome;
  });

  test('falls back to the public repo terms URL outside the extension runtime', () => {
    const originalChrome = globalThis.chrome;
    delete (globalThis as any).chrome;

    expect(packagedTermsUrl()).toBe(PUBLIC_PROJECT_LINKS.terms);

    globalThis.chrome = originalChrome;
  });
});
