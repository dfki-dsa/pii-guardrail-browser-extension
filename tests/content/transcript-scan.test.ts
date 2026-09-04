/** @jest-environment jsdom */

import {
  observedTokens,
  readTranscriptText,
  visibleTokens,
} from '../../src/content/transcript-scan';

/**
 * The scan replaces the continuity predicate that used to decide what a URL
 * change meant. It answers two questions with no site knowledge at all:
 * which of this tab's tokens are rendered, and which unaltered tokens are on
 * the page.
 *
 * The composer exclusion carries over from the predicate and matters for the
 * same reason: a draft that was anonymized but never sent travels with the
 * user to whatever they open next, and reading it would file the draft's
 * tokens against an unrelated conversation.
 */
function buildPage(options: {
  transcript: string;
  composerText?: string;
}): { composer: HTMLElement } {
  document.body.replaceChildren();

  const main = document.createElement('main');
  main.innerHTML = `<ol><li data-role="user"><p>${options.transcript}</p></li></ol>`;
  document.body.append(main);

  const composer = document.createElement('div');
  composer.setAttribute('contenteditable', 'true');
  composer.textContent = options.composerText ?? '';
  document.body.append(composer);

  return { composer };
}

describe('readTranscriptText', () => {
  it('reads the transcript', () => {
    const { composer } = buildPage({ transcript: 'Bitte antworte [PERSON_1] kurz.' });

    expect(readTranscriptText(document.body, composer)).toContain('[PERSON_1]');
  });

  it('leaves out an unsent draft still sitting in the composer', () => {
    const { composer } = buildPage({
      transcript: 'An unrelated conversation.',
      composerText: 'Bitte antworte [PERSON_1] kurz.',
    });

    expect(readTranscriptText(document.body, composer)).not.toContain('[PERSON_1]');
  });

  it('leaves out every other editable region, named composer or not', () => {
    buildPage({ transcript: 'An unrelated conversation.' });

    const otherEditor = document.createElement('div');
    otherEditor.setAttribute('contenteditable', 'plaintext-only');
    otherEditor.textContent = '[PERSON_2]';
    const textarea = document.createElement('textarea');
    textarea.textContent = '[PERSON_3]';
    document.body.append(otherEditor, textarea);

    const text = readTranscriptText(document.body, null);
    expect(text).not.toContain('[PERSON_2]');
    expect(text).not.toContain('[PERSON_3]');
  });

  it('still reads the transcript when the composer is nested inside it', () => {
    const { composer } = buildPage({ transcript: 'Bitte antworte [PERSON_1] kurz.' });
    document.querySelector('main')!.append(composer);

    expect(readTranscriptText(document.body, composer)).toContain('[PERSON_1]');
  });

  it("leaves out this extension's own shadow-DOM UI", () => {
    // The reveal banner and every other injected surface live in shadow DOM.
    // Reading them back would make the extension's own output look like the
    // site's content.
    buildPage({ transcript: 'An unrelated conversation.' });
    const host = document.createElement('div');
    document.body.append(host);
    host.attachShadow({ mode: 'open' }).innerHTML = '<span>[PERSON_4]</span>';

    expect(readTranscriptText(document.body, null)).not.toContain('[PERSON_4]');
  });

  it('tolerates a missing root', () => {
    expect(readTranscriptText(null, null)).toBe('');
  });
});

describe('visibleTokens', () => {
  it('reports the tokens rendered in the transcript', () => {
    const { composer } = buildPage({ transcript: 'Bitte antworte [PERSON_1] kurz.' });
    const text = readTranscriptText(document.body, composer);

    expect(visibleTokens(['[PERSON_1]', '[EMAIL_2]'], text)).toEqual(['[PERSON_1]']);
  });

  it('reports a synthetic replacement, not just a bracketed token', () => {
    // Vault records can substitute a natural-looking value; that string is
    // what lands on the page, so it is what has to be found.
    const { composer } = buildPage({ transcript: 'Bitte antworte Jordan Park kurz.' });

    expect(
      visibleTokens(['Jordan Park'], readTranscriptText(document.body, composer)),
    ).toEqual(['Jordan Park']);
  });

  it('ignores an empty token rather than matching everything', () => {
    const { composer } = buildPage({ transcript: 'An unrelated conversation.' });

    expect(visibleTokens([''], readTranscriptText(document.body, composer))).toEqual([]);
  });

  it('reports nothing when this session emitted nothing', () => {
    const { composer } = buildPage({ transcript: 'Bitte antworte [PERSON_1] kurz.' });

    expect(visibleTokens([], readTranscriptText(document.body, composer))).toEqual([]);
  });
});

describe('observedTokens', () => {
  it('finds unaltered tokens of a type this extension emits', () => {
    expect(observedTokens('Contact [PERSON_1] at [EMAIL_2] today.')).toEqual([
      '[PERSON_1]',
      '[EMAIL_2]',
    ]);
  });

  it('reports each token once however often it appears', () => {
    expect(observedTokens('[PERSON_1] and [PERSON_1] again')).toEqual(['[PERSON_1]']);
  });

  it('ignores a token shaped right but typed unknown', () => {
    // A model asked for a template writes things like this. It is not ours.
    expect(observedTokens('Fill in [TODO_1] and [PLACEHOLDER_2].')).toEqual([]);
  });

  it('ignores mangled forms', () => {
    // Mangled tokens need the conversation scope. Admitting them from
    // observation alone would resolve "person 1" in ordinary prose.
    expect(observedTokens('person 1, PERSON_1 and [person_1]')).toEqual([]);
  });
});
