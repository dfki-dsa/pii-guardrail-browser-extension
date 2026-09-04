/** @jest-environment jsdom */

import { conversationStillOnPage } from '../../src/content/conversation-continuity';

/**
 * `conversationStillOnPage` replaces the per-site route patterns that used to
 * decide what a URL change meant. The content script asks it whether the
 * conversation survived the rewrite, and migrates this session's replacements
 * onto the new URL only when it says yes.
 *
 * A wrong `true` files one conversation's originals under another and makes
 * them revealable there; a wrong `false` only costs a migration. The cases
 * below pin both directions.
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

describe('conversationStillOnPage', () => {
  it('recognises the conversation when a sent placeholder is still rendered', () => {
    const { composer } = buildPage({ transcript: 'Bitte antworte [PERSON_1] kurz.' });

    expect(
      conversationStillOnPage(['[PERSON_1]'], document.body, composer),
    ).toBe(true);
  });

  it('recognises a synthetic replacement, not just a bracketed placeholder', () => {
    // Vault records can substitute a natural-looking value instead of a
    // placeholder; that string is what lands on the page, so it is what the
    // continuity check has to find.
    const { composer } = buildPage({ transcript: 'Bitte antworte Jordan Park kurz.' });

    expect(
      conversationStillOnPage(['Jordan Park'], document.body, composer),
    ).toBe(true);
  });

  it('reports a different conversation when none of the inserted text is present', () => {
    const { composer } = buildPage({ transcript: 'An unrelated conversation.' });

    expect(
      conversationStillOnPage(['[PERSON_1]', 'Jordan Park'], document.body, composer),
    ).toBe(false);
  });

  it('ignores an unsent draft still sitting in the composer', () => {
    // The draft travels with the user to whatever they open next. Counting it
    // would migrate its mappings onto an unrelated conversation.
    const { composer } = buildPage({
      transcript: 'An unrelated conversation.',
      composerText: 'Bitte antworte [PERSON_1] kurz.',
    });

    expect(
      conversationStillOnPage(['[PERSON_1]'], document.body, composer),
    ).toBe(false);
  });

  it('still reads the transcript when the composer is nested inside it', () => {
    const { composer } = buildPage({ transcript: 'Bitte antworte [PERSON_1] kurz.' });
    document.querySelector('main')!.append(composer);

    expect(
      conversationStillOnPage(['[PERSON_1]'], document.body, composer),
    ).toBe(true);
  });

  it('reports false when this session inserted nothing', () => {
    const { composer } = buildPage({ transcript: 'Bitte antworte [PERSON_1] kurz.' });

    expect(conversationStillOnPage([], document.body, composer)).toBe(false);
  });

  it('ignores empty inserted values rather than matching everything', () => {
    // `''` is a substring of any text; treating it as evidence would make
    // every URL change look like the same conversation.
    const { composer } = buildPage({ transcript: 'An unrelated conversation.' });

    expect(conversationStillOnPage([''], document.body, composer)).toBe(false);
  });

  it('tolerates a missing composer and a missing root', () => {
    const { composer } = buildPage({ transcript: 'Bitte antworte [PERSON_1] kurz.' });
    composer.remove();

    expect(conversationStillOnPage(['[PERSON_1]'], document.body, null)).toBe(true);
    expect(conversationStillOnPage(['[PERSON_1]'], null, null)).toBe(false);
  });
});
