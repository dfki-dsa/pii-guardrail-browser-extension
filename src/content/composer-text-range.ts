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

/**
 * Whitespace of every kind, plus the zero-width filler editors leave behind.
 * Written with escapes: the two zero-width characters are invisible in source.
 */
const IGNORABLE_CLASS = '[\\s\\u200B\\uFEFF]';
const IGNORABLE = new RegExp(IGNORABLE_CLASS);
const IGNORABLE_RUNS = new RegExp(`${IGNORABLE_CLASS}+`, 'g');
const IGNORABLE_EDGES = new RegExp(`^${IGNORABLE_CLASS}+|${IGNORABLE_CLASS}+$`, 'g');

/** `text` with everything ignorable removed — the form texts are compared in. */
export function stripIgnorable(text: string): string {
  return text.replace(IGNORABLE_RUNS, '');
}

/** `text` without leading and trailing ignorable characters. */
export function trimIgnorable(text: string): string {
  return text.replace(IGNORABLE_EDGES, '');
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

/** Where each non-overlapping copy of `wanted` starts in `flat`. */
export function occurrencesOf(flat: string, wanted: string): number[] {
  const starts: number[] = [];
  if (!wanted) return starts;
  for (let at = flat.indexOf(wanted); at >= 0; at = flat.indexOf(wanted, at + wanted.length)) {
    starts.push(at);
  }
  return starts;
}

/**
 * Which copy of some inserted text is the one this extension put there:
 * copy number `ordinal` (from zero) of `total` in the composer.
 *
 * Needed because a user can paste the same thing twice. An ordinal survives
 * typing elsewhere in the draft, which an offset would not; `total` is kept so
 * that a copy added or removed since makes the hint void rather than wrong.
 */
export interface OccurrenceHint {
  ordinal: number;
  total: number;
}

/**
 * The copy of `needle` that ends at the caret, for a rich editor. Called
 * right after inserting, when the caret sits at the end of what went in.
 * Null when the caret is not there — the hint is then simply not available.
 */
export function locateAtCaret(root: HTMLElement, needle: string): OccurrenceHint | null {
  const wanted = stripIgnorable(needle);
  if (!wanted) return null;

  const doc = root.ownerDocument ?? document;
  const selection = doc.defaultView?.getSelection();
  const focusNode = selection?.focusNode;
  if (!selection || !focusNode || !root.contains(focusNode)) return null;

  let caret: number;
  try {
    const before = doc.createRange();
    before.selectNodeContents(root);
    before.setEnd(focusNode, selection.focusOffset);
    caret = stripIgnorable(before.toString()).length;
  } catch {
    return null;
  }

  const starts = occurrencesOf(readComposerText(root), wanted);
  const ordinal = starts.indexOf(caret - wanted.length);
  return ordinal < 0 ? null : { ordinal, total: starts.length };
}

/**
 * The range covering `needle` inside a rich editor, or null when it cannot be
 * told which text is meant.
 *
 * Without a hint the text has to be there exactly once. With one, the copy it
 * names is used — provided the number of copies is still what it was when the
 * hint was taken. If a copy has come or gone since, there is no telling which
 * one is ours, and guessing could restore an original into text the user
 * protected with an earlier paste.
 *
 * The range runs from the first to the last non-ignorable character of the
 * needle, so whitespace around the inserted text is left in place. Callers
 * swapping text in should trim the new text the same way (`trimIgnorable`).
 */
export function findTextRange(
  root: HTMLElement,
  needle: string,
  hint?: OccurrenceHint | null,
): Range | null {
  const wanted = stripIgnorable(needle);
  if (!wanted) return null;

  const { flat, nodes, offsets } = flattenTextNodes(root);
  const starts = occurrencesOf(flat, wanted);
  let first: number;
  if (hint) {
    if (hint.total !== starts.length || hint.ordinal < 0 || hint.ordinal >= starts.length) {
      return null;
    }
    first = starts[hint.ordinal];
  } else {
    if (starts.length !== 1) return null;
    first = starts[0];
  }

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
  // The same string a walk over the text nodes would build, without
  // building the node and offset maps only `findTextRange` needs.
  return stripIgnorable(element.textContent ?? '');
}
