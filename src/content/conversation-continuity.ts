/**
 * Privacy Guardrail — Conversation continuity (content script)
 *
 * Answers one question, asked whenever a chat page's URL changes: is the
 * conversation on screen still the one this page session composed for?
 *
 * It matters because every supported site creates the conversation on the
 * first send and rewrites the URL in place. Replacements recorded while
 * composing are filed under the URL being left behind, and have to move
 * with the conversation or they become unreachable.
 *
 * The obvious way to answer it — pattern-match each site's conversation
 * route — was tried and rots. `/c/<id>` was right for ChatGPT's classic
 * client and silently wrong for the `/uc/<id>` its web-mobile build uses,
 * and being wrong discarded the user's replacements mid-conversation. A
 * route pattern is vendor trivia that emits no signal when it goes stale,
 * and it needs one entry per site per redesign.
 *
 * So ask the page instead. `insertedText` is what this session actually put
 * into the composer — placeholders, or synthetic values where the vault
 * chose those. If any of it is still rendered in the transcript once the
 * URL has changed, the site renamed the conversation under us rather than
 * navigating away from it. Nothing in that reasoning depends on how a site
 * spells its URLs, so it holds across redesigns and on sites this extension
 * has no specific knowledge of at all.
 */

/**
 * True when text this session inserted is still visible on the page,
 * meaning the conversation survived the URL change.
 *
 * The composer is excluded deliberately. A draft that was anonymized but
 * never sent still sits in the message box, and it travels with the user
 * to whatever they open next — counting it would migrate the draft's
 * mappings onto an unrelated conversation.
 *
 * Errs towards `false`: a wrong `true` files one conversation's originals
 * under another and makes them revealable there, which is worse than the
 * missed migration a wrong `false` costs.
 */
export function conversationStillOnPage(
  insertedText: Iterable<string>,
  root: HTMLElement | null,
  composer: HTMLElement | null,
): boolean {
  if (!root) return false;

  const needles = [...insertedText].filter((value) => value.length > 0);
  if (needles.length === 0) return false;

  const text = textContentExcluding(root, composer);
  return needles.some((needle) => text.includes(needle));
}

/**
 * `root`'s text with `excluded`'s subtree left out.
 *
 * Falls back to plain `textContent` when there is nothing to exclude, which
 * is both the common case and the cheap one. Shadow roots are not traversed
 * either way — that suits us, since this extension's own injected UI lives
 * in shadow DOM and must not be mistaken for page content.
 */
function textContentExcluding(
  root: HTMLElement,
  excluded: HTMLElement | null,
): string {
  if (!excluded || !root.contains(excluded)) return root.textContent ?? '';

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      excluded.contains(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });

  const parts: string[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    parts.push(node.textContent ?? '');
  }
  return parts.join('');
}
