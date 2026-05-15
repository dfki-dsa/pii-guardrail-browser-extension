import { PUBLIC_PROJECT_LINKS, PUBLIC_PROJECT_REPO_URL, SECURITY_SUPPORT_EMAIL } from '../../src/shared/project-links';

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
    });
  });

  test('exposes the sensitive-report contact explicitly', () => {
    expect(SECURITY_SUPPORT_EMAIL).toBe('pii@dfki.de');
  });
});
