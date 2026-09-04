/** @jest-environment jsdom */

import { isInEditableRegion } from '../../src/ui/shared/editable-region';

/**
 * One rule, two consequences: the transcript scan skips these regions so an
 * unsent draft is never filed against another conversation, and the reveal
 * banner refuses them so revealing can never write originals into text the
 * user is about to send.
 */
function buildPage(options: { transcript: string; composerText?: string }): {
  composer: HTMLElement;
} {
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

describe('isInEditableRegion', () => {
  it('recognises a node inside the adapter’s composer', () => {
    const { composer } = buildPage({ transcript: 'x', composerText: 'draft' });

    expect(isInEditableRegion(composer.firstChild, composer)).toBe(true);
  });

  it('recognises a form control the adapter knows nothing about', () => {
    buildPage({ transcript: 'x' });
    const input = document.createElement('input');
    document.body.append(input);

    expect(isInEditableRegion(input, null)).toBe(true);
  });

  it('reports inert transcript text as not editable', () => {
    buildPage({ transcript: 'Bitte antworte [PERSON_1] kurz.' });
    const paragraph = document.querySelector('p') as HTMLElement;

    expect(isInEditableRegion(paragraph.firstChild, null)).toBe(false);
  });

  it('recognises a node inside a rich editor without walking to the composer', () => {
    buildPage({ transcript: 'x' });
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'plaintext-only');
    const line = document.createElement('p');
    editor.append(line);
    document.body.append(editor);

    expect(isInEditableRegion(line, null)).toBe(true);
  });

  it('tolerates a missing node', () => {
    expect(isInEditableRegion(null)).toBe(false);
  });
});
