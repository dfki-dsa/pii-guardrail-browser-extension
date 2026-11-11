/**
 * Privacy Guardrail — locating text this extension inserted into a composer.
 *
 * Automatic replacement puts text into the page before the user has looked at
 * it, so Undo and Review have to find that text again and swap it. By then it
 * belongs to the site's editor: a rich editor has split a multi-line paste
 * into paragraphs, turned spaces into non-breaking ones, and added its own
 * filler nodes.
 *
 * Matching therefore ignores whitespace entirely, and demands exactly one
 * match. There is no site knowledge here and nothing to keep up to date. When
 * the text is not found, or found twice, the answer is "not found" and the
 * caller changes nothing — the replaced text stays where it is. A miss costs
 * the user a convenience, never their protection.
 */

/** Whitespace of every kind, plus the zero-width filler editors leave behind. */
const IGNORABLE = /[\s​﻿]/;

/** `text` with everything `IGNORABLE` removed — the form texts are compared in. */
export function stripIgnorable(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!IGNORABLE.test(ch)) out += ch;
  }
  return out;
}

/** `text` without leading and trailing ignorable characters. */
export function trimIgnorable(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && IGNORABLE.test(text[start])) start++;
  while (end > start && IGNORABLE.test(text[end - 1])) end--;
  return text.slice(start, end);
}

/** A `<textarea>` reports its value with bare `\n` line ends whatever went in. */
export function normalizeLineEnds(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * Where `needle` sits in a form control's value.
 *
 * A form control keeps text exactly as inserted, so this is an exact match.
 * `hintStart` is the caret the text was inserted at: checked first, because
 * it stays right unless the user has typed in front of it, and it picks the
 * correct copy when the same text appears twice. Without a usable hint the
 * match must be unique.
 */
export function findInFormControl(
  value: string,
  needle: string,
  hintStart?: number,
): { start: number; end: number } | null {
  const wanted = normalizeLineEnds(needle);
  if (!wanted) return null;

  if (hintStart !== undefined && value.startsWith(wanted, hintStart)) {
    return { start: hintStart, end: hintStart + wanted.length };
  }

  const first = value.indexOf(wanted);
  if (first < 0) return null;
  if (value.indexOf(wanted, first + 1) >= 0) return null;
  return { start: first, end: first + wanted.length };
}

/**
 * The text under `root` with ignorable characters removed, and for each
 * remaining character the text node and offset it came from.
 */
function flattenTextNodes(root: Node): {
  flat: string;
  nodes: Text[];
  offsets: number[];
} {
  const doc = root.ownerDocument ?? document;
  // 4 = NodeFilter.SHOW_TEXT, spelled out so this also holds for a root from
  // another realm where the global `NodeFilter` is not the right one.
  const walker = doc.createTreeWalker(root, 4);
  const nodes: Text[] = [];
  const offsets: number[] = [];
  let flat = '';

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const data = (node as Text).data;
    for (let i = 0; i < data.length; i++) {
      const ch = data[i];
      if (IGNORABLE.test(ch)) continue;
      flat += ch;
      nodes.push(node as Text);
      offsets.push(i);
    }
  }

  return { flat, nodes, offsets };
}

/**
 * The range covering `needle` inside a rich editor, or null when it is not
 * there exactly once.
 *
 * The range runs from the first to the last non-ignorable character of the
 * needle, so whitespace around the inserted text is left in place. Callers
 * swapping text in should trim the new text the same way (`trimIgnorable`).
 */
export function findTextRange(root: HTMLElement, needle: string): Range | null {
  const wanted = stripIgnorable(needle);
  if (!wanted) return null;

  const { flat, nodes, offsets } = flattenTextNodes(root);
  const first = flat.indexOf(wanted);
  if (first < 0) return null;
  if (flat.indexOf(wanted, first + 1) >= 0) return null;

  const last = first + wanted.length - 1;
  const range = (root.ownerDocument ?? document).createRange();
  range.setStart(nodes[first], offsets[first]);
  range.setEnd(nodes[last], offsets[last] + 1);
  return range;
}

/** A composer's current text, whitespace removed, whichever kind of element it is. */
export function readComposerText(element: HTMLElement): string {
  const tag = element.tagName;
  if (tag === 'TEXTAREA' || tag === 'INPUT') {
    return stripIgnorable((element as HTMLTextAreaElement | HTMLInputElement).value);
  }
  return flattenTextNodes(element).flat;
}
