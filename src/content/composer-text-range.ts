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
 * Where `needle` sits in a form control's value, or null when it cannot be
 * told which text is meant.
 *
 * A form control keeps text exactly as inserted, so this is an exact match.
 * Which copy is chosen follows `pickOccurrence`, the same rule a rich editor
 * gets.
 */
export function findInFormControl(
  value: string,
  needle: string,
  hint?: OccurrenceHint | null,
): { start: number; end: number } | null {
  const wanted = normalizeLineEnds(needle);
  if (!wanted) return null;
  const start = pickOccurrence(occurrencesOf(value, wanted), hint);
  return start === null ? null : { start, end: start + wanted.length };
}

/**
 * The copy of `needle` that ends at a form control's caret. Called right
 * after inserting, when the caret sits at the end of what went in.
 */
export function locateInFormControl(
  element: HTMLTextAreaElement | HTMLInputElement,
  needle: string,
): OccurrenceHint | null {
  const wanted = normalizeLineEnds(needle);
  if (!wanted) return null;
  const starts = occurrencesOf(element.value, wanted);
  const caret = element.selectionStart;
  return hintFor(starts, caret === null ? -1 : starts.indexOf(caret - wanted.length));
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
 * typing elsewhere in the draft, which an offset would not. `total` is what
 * makes the hint safe: it is always known, and a copy added or removed since
 * makes the hint void rather than wrong. `ordinal` is null when the caret
 * could not say which copy had just gone in.
 */
export interface OccurrenceHint {
  ordinal: number | null;
  total: number;
}

function hintFor(starts: readonly number[], ordinal: number): OccurrenceHint {
  return { ordinal: ordinal < 0 ? null : ordinal, total: starts.length };
}

/**
 * Which of the copies at `starts` is the one to act on, or null when that
 * cannot be told.
 *
 * With a hint, the number of copies has to be what it was when the text went
 * in. If one has come or gone since, the copy that is left may be an earlier
 * paste — deleting the newer of two identical pastes leaves exactly that —
 * and restoring an original into it would expose text the user had chosen
 * to keep protected. So a changed count means nothing is touched, even when
 * only one copy remains and the choice looks obvious.
 *
 * Without a hint there is nothing to compare against, and the text has to be
 * there exactly once.
 */
function pickOccurrence(
  starts: readonly number[],
  hint: OccurrenceHint | null | undefined,
): number | null {
  if (hint && starts.length !== hint.total) return null;
  if (hint && hint.ordinal !== null) return starts[hint.ordinal] ?? null;
  return starts.length === 1 ? starts[0] : null;
}

/**
 * The copy of `needle` that ends at the caret, for a rich editor. Called
 * right after inserting, when the caret sits at the end of what went in.
 */
export function locateAtCaret(root: HTMLElement, needle: string): OccurrenceHint | null {
  const wanted = stripIgnorable(needle);
  if (!wanted) return null;

  const starts = occurrencesOf(readComposerText(root), wanted);

  const doc = root.ownerDocument ?? document;
  const selection = doc.defaultView?.getSelection();
  const focusNode = selection?.focusNode;
  if (!selection || !focusNode || !root.contains(focusNode)) return hintFor(starts, -1);

  let caret: number;
  try {
    const before = doc.createRange();
    before.selectNodeContents(root);
    before.setEnd(focusNode, selection.focusOffset);
    caret = stripIgnorable(before.toString()).length;
  } catch {
    return hintFor(starts, -1);
  }

  return hintFor(starts, starts.indexOf(caret - wanted.length));
}

/**
 * The range covering `needle` inside a rich editor, or null when it cannot be
 * told which text is meant.
 *
 * Which copy is chosen follows `pickOccurrence`.
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
  const first = pickOccurrence(occurrencesOf(flat, wanted), hint);
  if (first === null) return null;

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
