/**
 * Privacy Guardrail — Transcript scan (content script)
 *
 * Reads what is actually on the page, using no site knowledge whatsoever.
 *
 * Two questions are answered from one read. Which of this tab's replacement
 * tokens are rendered in the transcript — the evidence that files a token
 * under the conversation it is being read in. And which unaltered tokens are
 * on the page at all — the ones that resolve with no scope, no URL and no
 * adapter, which is what keeps a vendor redesign from removing restoration
 * outright.
 *
 * The obvious way to find the transcript — ask the site adapter — is exactly
 * what must not happen here. Adapter selectors rot silently, and a scan that
 * depended on them would take restoration down with them. `document.body`
 * minus everything the user can type into is coarse, and coarse is the point.
 */

import { ENTITY_TYPES } from '../shared/message-types';
import { parsePlaceholder } from '../shared/placeholder-variants';
import { isInEditableRegion } from '../ui/shared/editable-region';

/** Strict canonical replacement tokens, as this extension emits them. */
const CANONICAL_TOKEN_REGEX = /\[[A-Z][A-Z_]*_\d+\]/g;

const KNOWN_ENTITY_TYPES = new Set<string>(ENTITY_TYPES);

/** Elements whose text is never page content. */
const NON_CONTENT_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

/**
 * The page's inert text: everything the user cannot type into.
 *
 * Editable regions are left out because a draft that was anonymized but never
 * sent still sits in the message box, and it travels with the user to
 * whatever they open next — reading it would file the draft's tokens against
 * an unrelated conversation.
 *
 * Shadow roots are not traversed, which is deliberate twice over — this
 * extension's own injected UI lives in shadow DOM and must never be mistaken
 * for page content, and a site's encapsulated editor stays out of the read
 * without needing to be recognised.
 *
 * Returns `''` for a missing root rather than throwing: this runs on a timer
 * and during navigation, and a page mid-teardown is an ordinary case.
 */
export function readTranscriptText(
  root: HTMLElement | null,
  composer: HTMLElement | null,
): string {
  if (!root) return '';

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (parent && NON_CONTENT_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      return isInEditableRegion(node, composer)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });

  const parts: string[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    parts.push(node.textContent ?? '');
  }
  // Newline-joined so tokens in adjacent nodes cannot fuse into a third.
  return parts.join('\n');
}

/**
 * Which of `tokens` are rendered in the transcript right now.
 *
 * Matching is exact. This drives filing, and a token found by tolerant
 * matching would be evidence of nothing more than the page containing words
 * that look like it.
 */
export function visibleTokens(
  tokens: Iterable<string>,
  transcriptText: string,
): string[] {
  const found: string[] = [];
  for (const token of tokens) {
    if (token.length > 0 && transcriptText.includes(token)) found.push(token);
  }
  return found;
}

/**
 * Every unaltered replacement token on the page: brackets present, exact
 * case, and a type this extension actually emits.
 *
 * The type check is what keeps `[TODO_1]` in a model's own template out of
 * the resolvable set. Anything shaped like a token but typed unknown is not
 * ours and is left alone.
 *
 * Whether a token found here can be resolved is a separate question, asked of
 * the identity vault by the caller.
 */
export function observedTokens(transcriptText: string): string[] {
  const found = new Set<string>();
  const regex = new RegExp(CANONICAL_TOKEN_REGEX.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(transcriptText)) !== null) {
    const parsed = parsePlaceholder(match[0]);
    if (parsed && KNOWN_ENTITY_TYPES.has(parsed.type)) found.add(match[0]);
  }
  return [...found];
}
