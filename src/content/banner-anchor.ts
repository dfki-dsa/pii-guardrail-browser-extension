/**
 * Privacy Guardrail — Banner anchors (content script)
 *
 * Decides where a reveal banner may attach when the site adapter's reply
 * selectors do not cover a token that is on screen.
 *
 * The adapter's matched turn is always preferred: it is the element a reply
 * actually occupies, so a banner above it reads as belonging to that reply.
 * This module is the answer to the adapter having gone stale — a selector
 * that no longer matches should cost precision, never the feature. The
 * fallback walks up from the token itself, which needs no site knowledge.
 *
 * Two limits keep the fallback honest. It never attaches inside a region the
 * user can type into, because a reveal there could put an original value into
 * text about to be sent. And it stops before any ancestor that holds a large
 * fraction of the page, because a banner over the whole transcript is not an
 * annotation of anything.
 */

import { isInEditableRegion } from '../ui/shared/editable-region';

/**
 * Elements that read as their own block on a page. Tag names rather than
 * computed style: this runs during streaming and must not force layout, and
 * the answer has to be the same in a test environment that computes none.
 */
const BLOCK_TAGS = new Set([
  'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HEADER', 'LI', 'MAIN', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TD', 'TH',
  'TR', 'UL',
]);

/**
 * Share of the page's text above which an ancestor is too broad to annotate.
 *
 * Revealing replaces the subtree it annotates, so the real hazard is
 * attaching to the app shell and hiding the whole page behind an overlay.
 * The threshold is deliberately loose: a single reply can be most of a short
 * conversation, and refusing it there would withhold the banner in exactly
 * the case this fallback exists for.
 */
const DEFAULT_TEXT_CEILING = 0.8;

/**
 * The element a banner for `node` should attach above, or null when there is
 * no honest place to put one.
 *
 * Walks up from the token's own text node and returns the nearest block-level
 * ancestor that stays under the ceiling. When nothing block-level qualifies,
 * the widest ancestor still under the ceiling is used rather than giving up:
 * a site that wraps its replies in inline elements is odd, not a reason to
 * withhold the banner.
 */
export function blockAncestorFor(
  node: Node,
  root: HTMLElement,
  composer: HTMLElement | null,
  options: { maxTextFraction?: number; pageTextLength?: number } = {},
): HTMLElement | null {
  if (isInEditableRegion(node, composer)) return null;

  // The page's own length is the same for every call in one pass, and reading
  // `textContent` of the whole body is not cheap; callers walking many nodes
  // measure once and pass it in.
  const pageTextLength = options.pageTextLength ?? (root.textContent ?? '').length;
  const ceiling = pageTextLength * (options.maxTextFraction ?? DEFAULT_TEXT_CEILING);

  let widestUnderCeiling: HTMLElement | null = null;
  for (
    let element = node.parentElement;
    element && element !== root.parentElement;
    element = element.parentElement
  ) {
    // A page with no text at all cannot exceed the ceiling; guard the
    // degenerate comparison rather than letting `0 >= 0` reject everything.
    if (pageTextLength > 0 && (element.textContent ?? '').length >= ceiling) break;
    if (BLOCK_TAGS.has(element.tagName)) return element;
    widestUnderCeiling = element;
  }

  return widestUnderCeiling;
}

/**
 * Anchors for tokens the adapter's turns do not cover.
 *
 * Returns one element per region, outermost-wins so a reply containing three
 * tokens gets one banner rather than three. Elements already inside a matched
 * turn are skipped: that turn is the better anchor and the caller has it.
 */
export function findLooseTokenAnchors(
  root: HTMLElement | null,
  turns: readonly HTMLElement[],
  composer: HTMLElement | null,
  hasResolvableToken: (text: string) => boolean,
): HTMLElement[] {
  if (!root) return [];

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const text = node.textContent ?? '';
      if (text.length === 0) return NodeFilter.FILTER_REJECT;
      if (isInEditableRegion(node, composer)) return NodeFilter.FILTER_REJECT;
      if (turns.some((turn) => turn.contains(node))) return NodeFilter.FILTER_REJECT;
      return hasResolvableToken(text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });

  const pageTextLength = (root.textContent ?? '').length;
  const anchors: HTMLElement[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const anchor = blockAncestorFor(node, root, composer, { pageTextLength });
    if (!anchor) continue;
    if (anchors.some((existing) => existing === anchor || existing.contains(anchor))) continue;
    anchors.push(anchor);
  }
  return anchors;
}
