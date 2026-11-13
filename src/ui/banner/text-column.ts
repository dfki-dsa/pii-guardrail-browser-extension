/**
 * Privacy Guardrail — the column a reply's text is set in
 *
 * The reveal banner sits beside a reply, in the reply's parent, and so takes
 * the parent's width. On most sites that is the width of the text. On some it
 * is not: Gemini's reply element spans the whole chat area, and each block
 * inside it is centred to a narrower measure of its own. A banner as wide as
 * the element then runs edge to edge over a column of text half its width.
 *
 * No wrapper has the column's width there — every block is narrowed on its
 * own — so the column cannot be named by a selector. It is measured instead,
 * from the first thing the reader actually sees.
 */

export interface TextColumn {
  /** Left edge, in viewport coordinates. */
  left: number;
  width: number;
}

/** A banner narrower than this could not hold its label and two buttons. */
const MIN_COLUMN_WIDTH = 280;
/** How far a block must sit in from each side to count as a column of its own. */
const MIN_INSET = 8;

/**
 * The column `reply`'s text starts in, or null when the text simply fills the
 * reply — which is the usual case and needs nothing done.
 *
 * Follows the way down from the reply to its first visible text and takes the
 * outermost block on it that is set in from both sides. Both sides, because a
 * block set in from one side only is an indent (a list item, a quotation with
 * a rule down its left), not a column. Inline elements are passed over: they
 * are as wide as their words.
 */
export function findTextColumn(reply: HTMLElement): TextColumn | null {
  const outer = reply.getBoundingClientRect();
  if (outer.width === 0) return null;

  const holder = firstVisibleTextHolder(reply);
  if (!holder) return null;

  const wayDown: HTMLElement[] = [];
  for (let el: HTMLElement | null = holder; el && el !== reply; el = el.parentElement) {
    wayDown.unshift(el);
  }

  for (const el of wayDown) {
    const display = getComputedStyle(el).display;
    if (display === 'contents' || display.startsWith('inline')) continue;

    const box = el.getBoundingClientRect();
    if (box.width === 0) continue;
    const insetLeft = box.left - outer.left;
    const insetRight = outer.right - box.right;
    if (insetLeft < MIN_INSET || insetRight < MIN_INSET) continue;

    return box.width >= MIN_COLUMN_WIDTH ? { left: box.left, width: box.width } : null;
  }
  return null;
}

/** The element holding the first text in `root` that is actually drawn. */
function firstVisibleTextHolder(root: HTMLElement): HTMLElement | null {
  const walker = (root.ownerDocument ?? document).createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (!node.textContent?.trim()) continue;
    const parent = node.parentElement;
    if (!parent) continue;
    const box = parent.getBoundingClientRect();
    // Hidden content — the originals under a reveal, a collapsed panel — has
    // no box, and says nothing about where the text is.
    if (box.width > 0 && box.height > 0) return parent;
  }
  return null;
}
