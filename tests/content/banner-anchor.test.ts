/** @jest-environment jsdom */

import {
  blockAncestorFor,
  findLooseTokenAnchors,
} from '../../src/content/banner-anchor';

/**
 * Where a reveal banner may go when the adapter's reply selectors no longer
 * match. A rotted selector should cost precision — a banner on a block rather
 * than on the reply — never the feature itself.
 */
function mount(html: string): HTMLElement {
  document.body.replaceChildren();
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

function textNodeContaining(root: HTMLElement, needle: string): Text {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if ((node.textContent ?? '').includes(needle)) return node as Text;
  }
  throw new Error(`no text node containing ${needle}`);
}

describe('blockAncestorFor', () => {
  it('returns the nearest block the token sits in', () => {
    const root = mount(
      '<section><p id="turn">Ask <em>[PERSON_1]</em> today.</p></section>'
      + `<div>${'padding '.repeat(60)}</div>`,
    );
    const node = textNodeContaining(root, '[PERSON_1]');

    expect(blockAncestorFor(node, root, null)?.id).toBe('turn');
  });

  it('refuses a token inside something the user types into', () => {
    // Revealing rewrites what it annotates. In a message box that would put
    // originals into text about to be sent.
    const root = mount(
      '<div contenteditable="true"><p>Ask [PERSON_1] today.</p></div>'
      + `<div>${'padding '.repeat(60)}</div>`,
    );
    const node = textNodeContaining(root, '[PERSON_1]');

    expect(blockAncestorFor(node, root, null)).toBeNull();
  });

  it('refuses a token inside the adapter’s composer even when nothing marks it editable', () => {
    const root = mount(
      '<div id="composer"><p>Ask [PERSON_1] today.</p></div>'
      + `<div>${'padding '.repeat(60)}</div>`,
    );
    const composer = root.querySelector('#composer') as HTMLElement;
    const node = textNodeContaining(root, '[PERSON_1]');

    expect(blockAncestorFor(node, root, composer)).toBeNull();
  });

  it('stops before an ancestor holding a large share of the page', () => {
    // A single wrapper around the whole transcript is not an annotation of
    // anything, so the banner does not go there.
    const root = mount(
      '<div id="all"><span>[PERSON_1]</span>'
      + '<span>' + 'lorem ipsum '.repeat(50) + '</span></div>',
    );
    const node = textNodeContaining(root, '[PERSON_1]');

    const anchor = blockAncestorFor(node, root, null);
    expect(anchor?.id).not.toBe('all');
    expect(anchor?.tagName).toBe('SPAN');
  });

  it('gives up when even the immediate parent is the whole page', () => {
    const root = mount('<div id="all">Ask [PERSON_1] today.</div>');
    const node = textNodeContaining(root, '[PERSON_1]');

    expect(blockAncestorFor(node, root, null)).toBeNull();
  });
});

describe('findLooseTokenAnchors', () => {
  const hasToken = (text: string): boolean => text.includes('[PERSON_1]');

  it('finds a region the adapter’s turns do not cover', () => {
    const root = mount(`
      <div id="known">A reply the adapter matched.</div>
      <div id="unknown"><p id="loose">Ask [PERSON_1] today.</p></div>
      <div>${'padding '.repeat(60)}</div>
    `);
    const turns = [root.querySelector('#known') as HTMLElement];

    expect(findLooseTokenAnchors(root, turns, null, hasToken).map((el) => el.id))
      .toEqual(['loose']);
  });

  it('leaves tokens inside a matched turn to that turn', () => {
    const root = mount(`
      <div id="known"><p>Ask [PERSON_1] today.</p></div>
      <div>${'padding '.repeat(60)}</div>
    `);
    const turns = [root.querySelector('#known') as HTMLElement];

    expect(findLooseTokenAnchors(root, turns, null, hasToken)).toEqual([]);
  });

  it('offers one anchor per region rather than one per token', () => {
    const root = mount(`
      <div id="unknown"><p id="loose">Ask [PERSON_1] and [PERSON_1] again.</p></div>
      <div>${'padding '.repeat(60)}</div>
    `);

    expect(findLooseTokenAnchors(root, [], null, hasToken).map((el) => el.id))
      .toEqual(['loose']);
  });

  it('never anchors inside an editable region', () => {
    const root = mount(`
      <div contenteditable="true"><p>Draft mentioning [PERSON_1].</p></div>
      <div>${'padding '.repeat(60)}</div>
    `);

    expect(findLooseTokenAnchors(root, [], null, hasToken)).toEqual([]);
  });

  it('tolerates a missing root', () => {
    expect(findLooseTokenAnchors(null, [], null, hasToken)).toEqual([]);
  });
});
