/** @jest-environment jsdom */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  findInFormControl,
  findTextRange,
  readComposerText,
  stripIgnorable,
  trimIgnorable,
} from '../../src/content/composer-text-range';
import { replaceTextCompat } from '../../src/content/site-adapters/adapter-interface';

const INSERTED = 'Hello [PERSON_1],\n\nplease call [PHONE_1] before Friday.\nThanks';
const ORIGINAL = 'Hello Jane Doe,\n\nplease call 0431 555 0199 before Friday.\nThanks';

/** A rich editor's rendering of a multi-line insert: one block per line. */
function paragraphs(text: string): string {
  return text
    .split('\n')
    .map((line) => (line ? `<p>${line}</p>` : '<p><br></p>'))
    .join('');
}

function richComposer(html: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('contenteditable', 'true');
  el.innerHTML = html;
  document.body.append(el);
  return el;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('stripIgnorable / trimIgnorable', () => {
  it('drops every kind of whitespace and zero-width filler', () => {
    expect(stripIgnorable(' a b\n\tc​﻿d ')).toBe('abcd');
  });

  it('trims only the outside', () => {
    expect(trimIgnorable('\n​  a b \n')).toBe('a b');
  });
});

describe('findInFormControl', () => {
  it('finds a unique occurrence', () => {
    expect(findInFormControl('before [PERSON_1] after', '[PERSON_1]')).toEqual({
      start: 7,
      end: 17,
    });
  });

  it('matches text inserted with CRLF line ends against the control value', () => {
    expect(findInFormControl('a\nb', 'a\r\nb')).toEqual({ start: 0, end: 3 });
  });

  it('prefers the caret the text was inserted at when the text appears twice', () => {
    const value = 'same text | same text';
    expect(findInFormControl(value, 'same text', 12)).toEqual({ start: 12, end: 21 });
  });

  it('refuses an ambiguous match without a usable hint', () => {
    expect(findInFormControl('same text | same text', 'same text')).toBeNull();
    expect(findInFormControl('same text | same text', 'same text', 3)).toBeNull();
  });

  it('falls back to a unique match when the hint has gone stale', () => {
    expect(findInFormControl('typed first: [PERSON_1]', '[PERSON_1]', 0)).toEqual({
      start: 13,
      end: 23,
    });
  });

  it('reports text that is no longer there', () => {
    expect(findInFormControl('edited by hand', '[PERSON_1]')).toBeNull();
    expect(findInFormControl('anything', '')).toBeNull();
  });
});

describe('findTextRange', () => {
  it('finds single-line text inside one text node', () => {
    const el = richComposer('<p>note: Hello [PERSON_1] there</p>');
    const range = findTextRange(el, 'Hello [PERSON_1]');

    expect(range?.toString()).toBe('Hello [PERSON_1]');
  });

  it('finds a multi-line insert the editor split into paragraphs', () => {
    const el = richComposer(paragraphs(INSERTED));
    const range = findTextRange(el, INSERTED);

    expect(range).not.toBeNull();
    expect(stripIgnorable(range!.toString())).toBe(stripIgnorable(INSERTED));
  });

  it('finds an insert rendered with <br> line breaks and non-breaking spaces', () => {
    const el = richComposer(
      `<div>${INSERTED.replace(/ /g, ' ').replace(/\n/g, '<br>')}</div>`,
    );

    expect(findTextRange(el, INSERTED)).not.toBeNull();
  });

  it('finds text split across inline formatting nodes', () => {
    const el = richComposer('<p>Hello <strong>[PERSON_1]</strong>, call <em>[PHONE_1]</em></p>');
    const range = findTextRange(el, 'Hello [PERSON_1], call [PHONE_1]');

    expect(range?.toString()).toBe('Hello [PERSON_1], call [PHONE_1]');
  });

  it('leaves text the user typed around the insert outside the range', () => {
    const el = richComposer(`<p>Context first.</p>${paragraphs(INSERTED)}<p>And a question?</p>`);
    const range = findTextRange(el, INSERTED)!;

    expect(range.toString()).not.toContain('Context first');
    expect(range.toString()).not.toContain('And a question');
  });

  it('reports an insert the user edited', () => {
    const el = richComposer(paragraphs(INSERTED.replace('before Friday', 'by Monday')));

    expect(findTextRange(el, INSERTED)).toBeNull();
  });

  it('reports an insert that is gone', () => {
    const el = richComposer('<p><br></p>');

    expect(findTextRange(el, INSERTED)).toBeNull();
  });

  it('refuses to choose when the same text is there twice', () => {
    const el = richComposer(paragraphs(INSERTED) + paragraphs(INSERTED));

    expect(findTextRange(el, INSERTED)).toBeNull();
  });

  it('has nothing to find for whitespace-only text', () => {
    const el = richComposer('<p>anything</p>');

    expect(findTextRange(el, ' \n ')).toBeNull();
  });
});

describe('readComposerText', () => {
  it('reads a form control and a rich editor in the same comparable form', () => {
    const textarea = document.createElement('textarea');
    textarea.value = INSERTED;
    const rich = richComposer(paragraphs(INSERTED));

    expect(readComposerText(textarea)).toBe(stripIgnorable(INSERTED));
    expect(readComposerText(rich)).toBe(stripIgnorable(INSERTED));
  });
});

describe('replaceTextCompat', () => {
  it('swaps the inserted text in a textarea and keeps what surrounds it', () => {
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    textarea.value = `Intro. ${INSERTED} Outro.`;

    expect(replaceTextCompat(textarea, INSERTED, ORIGINAL)).toBe(true);
    expect(textarea.value).toBe(`Intro. ${ORIGINAL} Outro.`);
  });

  it('changes nothing in a textarea when the inserted text was edited', () => {
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    textarea.value = 'Hello [PERSON_1], I rewrote the rest.';

    expect(replaceTextCompat(textarea, INSERTED, ORIGINAL)).toBe(false);
    expect(textarea.value).toBe('Hello [PERSON_1], I rewrote the rest.');
  });

  it('swaps the inserted text in a rich editor and keeps what surrounds it', () => {
    const el = richComposer('<p>Intro.</p><p>Hello [PERSON_1], call [PHONE_1].</p><p>Outro.</p>');

    expect(
      replaceTextCompat(
        el,
        'Hello [PERSON_1], call [PHONE_1].',
        'Hello Jane Doe, call 0431 555 0199.',
      ),
    ).toBe(true);
    expect(el.textContent).toBe('Intro.Hello Jane Doe, call 0431 555 0199.Outro.');
  });

  it('changes nothing in a rich editor when the inserted text is not there once', () => {
    const el = richComposer('<p>Something else entirely.</p>');
    const before = el.innerHTML;

    expect(replaceTextCompat(el, INSERTED, ORIGINAL)).toBe(false);
    expect(el.innerHTML).toBe(before);
  });
});

/**
 * The captured site markup pins which kind of element each composer is. The
 * finder itself knows nothing about sites; this only checks it holds on the
 * real containers, filled the way each editor fills them.
 */
describe.each([
  { name: 'ChatGPT classic', file: 'chatgpt-classic.html', composer: '#prompt-textarea' },
  { name: 'Claude', file: 'claude.html', composer: '[aria-label="Write your prompt to Claude"]' },
  { name: 'Gemini', file: 'gemini.html', composer: '.ql-editor' },
])('$name captured composer', ({ file, composer }) => {
  it('finds a multi-paragraph insert and nothing once it was edited', () => {
    document.body.innerHTML = readFileSync(
      join(__dirname, '..', 'fixtures', 'site-dom', file),
      'utf8',
    );
    const el = document.querySelector<HTMLElement>(composer)!;
    expect(el).not.toBeNull();

    el.innerHTML = paragraphs(INSERTED);
    expect(findTextRange(el, INSERTED)).not.toBeNull();

    el.innerHTML = paragraphs(INSERTED.replace('[PERSON_1]', 'Jane'));
    expect(findTextRange(el, INSERTED)).toBeNull();
  });
});

describe('ChatGPT web-mobile captured composer', () => {
  it('is a form control whose inserted text is found exactly', () => {
    document.body.innerHTML = readFileSync(
      join(__dirname, '..', 'fixtures', 'site-dom', 'chatgpt-web-mobile.html'),
      'utf8',
    );
    const el = document.querySelector<HTMLTextAreaElement>('[data-mobile-composer-prompt]')!;
    expect(el.tagName).toBe('TEXTAREA');

    el.value = INSERTED;
    expect(replaceTextCompat(el, INSERTED, ORIGINAL)).toBe(true);
    expect(el.value).toBe(ORIGINAL);
  });
});
