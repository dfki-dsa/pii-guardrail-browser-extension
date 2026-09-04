/** @jest-environment jsdom */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ChatGptAdapter } from '../../src/content/site-adapters/chatgpt-adapter';
import { ClaudeAdapter } from '../../src/content/site-adapters/claude-adapter';
import { GeminiAdapter } from '../../src/content/site-adapters/gemini-adapter';
import type { SiteAdapter } from '../../src/content/site-adapters/adapter-interface';
import { readTranscriptText } from '../../src/content/transcript-scan';

/**
 * Selector rot is the one failure this design cannot make itself immune to.
 * Every fallback added around the adapters succeeds quietly, so nothing in
 * the field reports that a site has moved — these fixtures are where it is
 * meant to be noticed instead.
 *
 * They pin what the adapters were written against. Refreshing them from a
 * live page at each release is what turns them from a regression guard into a
 * rot detector; see `tests/fixtures/site-dom/README.md`.
 */
const FIXTURES: Array<{
  name: string;
  file: string;
  adapter: () => SiteAdapter;
  composer: string;
}> = [
  {
    name: 'ChatGPT web-mobile',
    file: 'chatgpt-web-mobile.html',
    adapter: () => new ChatGptAdapter(),
    composer: '[data-mobile-composer-prompt]',
  },
  {
    name: 'ChatGPT classic',
    file: 'chatgpt-classic.html',
    adapter: () => new ChatGptAdapter(),
    composer: '#prompt-textarea',
  },
  {
    name: 'Claude',
    file: 'claude.html',
    adapter: () => new ClaudeAdapter(),
    composer: '[aria-label="Write your prompt to Claude"]',
  },
  {
    name: 'Gemini',
    file: 'gemini.html',
    adapter: () => new GeminiAdapter(),
    composer: '.ql-editor',
  },
];

function mount(file: string): void {
  const html = readFileSync(
    join(__dirname, '..', 'fixtures', 'site-dom', file),
    'utf8',
  );
  document.body.innerHTML = html;
}

describe.each(FIXTURES)('$name captured markup', ({ file, adapter, composer }) => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('still resolves the message box', () => {
    mount(file);

    expect(adapter().getInputElement()).toBe(document.querySelector(composer));
  });

  it('still resolves the assistant turn', () => {
    mount(file);

    // Not an exact count: Claude's selectors match a streaming wrapper and
    // the message inside it, so one reply legitimately yields two candidates.
    const turns = adapter().getResponseElements();
    expect(turns.length).toBeGreaterThan(0);
    for (const turn of turns) {
      expect(turn.textContent).toContain('[PERSON_1]');
    }
  });

  it('reads the reply and not the composer, whatever the adapter does', () => {
    // The scan takes no selectors from the adapter, so this holds even for a
    // fixture whose composer selector has stopped matching.
    mount(file);

    const text = readTranscriptText(document.body, adapter().getInputElement());
    expect(text).toContain('[PERSON_1]');
    expect(text).not.toContain('Ask anything');
  });
});
