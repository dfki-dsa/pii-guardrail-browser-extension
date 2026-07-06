const { renderTermsHtml } = require('../../scripts/terms-html');

describe('terms HTML renderer', () => {
  test('renders markdown into branded standalone HTML without runtime dependencies', () => {
    const html = renderTermsHtml(
      [
        '# Nutzungsbedingungen Privacy Guardrail',
        '',
        '## Sprachhinweis / Language Notice',
        '',
        'The German version is binding.',
        '',
        '## English Translation (For Convenience Only)',
        '',
        '- First point',
        '- Second point with https://example.invalid/terms',
      ].join('\n')
    );

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('font-family: "IBM Plex Sans"');
    expect(html).toContain('legal/logo-privacy-guardrail-black.png');
    expect(html).toContain('<h2 id="sprachhinweis-language-notice">');
    expect(html).toContain('English Translation (For Convenience Only)');
    expect(html).toContain('<li>First point</li>');
    expect(html).toContain('<a href="https://example.invalid/terms" target="_blank" rel="noopener noreferrer">https://example.invalid/terms</a>');
  });
});
