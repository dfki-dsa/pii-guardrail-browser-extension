const fs = require('fs');
const MarkdownIt = require('markdown-it');
const path = require('path');

const DEFAULT_OPTIONS = {
  title: 'Privacy Guardrail Terms of Use',
  logoPath: 'legal/logo-privacy-guardrail-black.png',
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugify(value, usedIds) {
  const base = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/§/g, 'section')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';

  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function renderInlineContent(token) {
  if (!token.children) return token.content || '';

  return token.children
    .map((child) => {
      if (child.type === 'softbreak' || child.type === 'hardbreak') return ' ';
      return child.content || '';
    })
    .join('');
}

function createMarkdownRenderer() {
  const markdownIt = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
  });

  const defaultLinkOpen =
    markdownIt.renderer.rules.link_open ||
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

  markdownIt.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const href = tokens[idx].attrGet('href') || '';
    if (/^https?:\/\//i.test(href)) {
      tokens[idx].attrSet('target', '_blank');
      tokens[idx].attrSet('rel', 'noopener noreferrer');
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  return markdownIt;
}

const markdownRenderer = createMarkdownRenderer();

function markdownToHtml(markdown) {
  const usedIds = new Set();
  const tokens = markdownRenderer.parse(markdown, {});

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type !== 'heading_open') continue;

    const inlineToken = tokens[i + 1];
    const text = inlineToken && inlineToken.type === 'inline'
      ? renderInlineContent(inlineToken).trim()
      : '';
    const id = slugify(text, usedIds);

    token.attrSet('id', id);
  }

  return { body: markdownRenderer.renderer.render(tokens, markdownRenderer.options, {}) };
}

function renderTermsHtml(markdown, options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const { body } = markdownToHtml(markdown);

  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(config.title)}</title>
  <style>
    @font-face {
      font-family: "IBM Plex Sans";
      src: url("fonts/ibm-plex-sans-400.woff2") format("woff2");
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: "IBM Plex Sans";
      src: url("fonts/ibm-plex-sans-600.woff2") format("woff2");
      font-weight: 600;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: "JetBrains Mono";
      src: url("fonts/jetbrains-mono-400.woff2") format("woff2");
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }

    :root {
      color-scheme: light;
      --ink: #172033;
      --muted: #647084;
      --subtle: #8a94a6;
      --border: #d8dee8;
      --surface: #f6f8fb;
      --paper: #ffffff;
      --accent: #1f66d1;
      --accent-soft: #e8f0ff;
      --warning: #775a00;
      --warning-bg: #fff5cc;
      --shadow: 0 22px 70px rgb(23 32 51 / 12%);

      --color-group-organization-bg: rgb(249 115 22 / 14%);
      --color-group-organization-fg: #c2410c;
    }

    * {
      box-sizing: border-box;
    }

    html {
      scroll-behavior: smooth;
    }

    body {
      margin: 0;
      background: linear-gradient(180deg, #eef3fb 0%, #f8fafc 260px, #f8fafc 100%);
      color: var(--ink);
      font-family: "IBM Plex Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 16px;
      line-height: 1.65;
    }

    a {
      color: var(--accent);
      text-decoration-thickness: 1px;
      text-underline-offset: 3px;
    }

    .page {
      width: min(1160px, calc(100% - 32px));
      margin: 0 auto;
      padding: 34px 0 64px;
    }

    .masthead {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 22px;
      padding: 26px 0 24px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 18px;
      margin-bottom: 1rem;
    }

    .brand img {
      width: 230px;
      max-width: min(62vw, 260px);
      height: auto;
    }

    h1 {
      margin: 0;
      font-size: clamp(32px, 5vw, 54px);
      line-height: 1.04;
      letter-spacing: 0;
      font-weight: 400;
    }

    .lead {
      max-width: 760px;
      margin: 14px 0 0;
      color: var(--muted);
      font-size: 18px;
      line-height: 1.55;
    }

    .notice {
      max-width: 860px;
      padding: 14px 16px;
      border: 1px solid #ead37a;
      border-radius: 8px;
      background: var(--warning-bg);
      color: var(--warning);
      font-size: 15px;
    }

    .document {
      padding: 42px 52px 56px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--paper);
      box-shadow: var(--shadow);
    }

    .document h1,
    .document h2,
    .document h3,
    .document h4 {
      color: var(--ink);
      line-height: 1.2;
      letter-spacing: 0;
    }

    .document h1 {
      margin: 0 0 22px;
      padding-bottom: 18px;
      // border-bottom: 1px solid var(--border);
      font-size: 48px;
      font-weight: 400;
      text-wrap: balance;
    }

    .document h2 {
      margin: 42px 0 14px;
      padding-top: 18px;
      border-top: 1px solid var(--border);
      font-size: 25px;
      text-wrap: balance;
    }

    .document h3 {
      margin: 30px 0 10px;
      font-size: 20px;
      text-wrap: balance;
    }

    .document h4 {
      margin: 24px 0 8px;
      font-size: 17px;
    }

    .document p {
      margin: 0 0 14px;
    }

    .document ul {
      margin: 0 0 18px;
      padding-left: 23px;
    }

    .document li {
      margin: 7px 0;
    }

    .document code {
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.92em;
    }

    .document h2#sprachhinweis-language-notice + p,
    .document h2#sprachhinweis-language-notice + p + p {
      padding: 12px 14px;
      border-left: 4px solid var(--accent);
      background: var(--accent-soft);
      background: var(--color-group-organization-bg);
      border-left: 4px solid var(--color-group-organization-fg);
    }

    .footer {
      margin-top: 24px;
      color: var(--subtle);
      font-size: 13px;
      text-align: center;
    }

    @media (max-width: 860px) {
      .page {
        width: min(100% - 20px, 720px);
        padding-top: 18px;
      }

      .document {
        padding: 28px 22px 38px;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <main class="document">
    <div class="brand">
        <img src="${escapeHtml(config.logoPath)}" alt="Privacy Guardrail">
      </div>
      ${body}
    </main>

    <footer class="footer">Privacy Guardrail terms are bundled locally with this extension package.</footer>
  </div>
</body>
</html>
`;
}

function renderTermsFile(inputPath, outputPath, options = {}) {
  const markdown = fs.readFileSync(inputPath, 'utf8');
  const html = renderTermsHtml(markdown, options);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html);
  return html;
}

module.exports = {
  markdownToHtml,
  renderTermsFile,
  renderTermsHtml,
};
