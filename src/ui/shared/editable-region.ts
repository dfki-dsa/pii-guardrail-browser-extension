/**
 * Privacy Guardrail — Editable regions (shared UI)
 *
 * One answer to "can the user type here", used by everything that must not
 * touch text the user is composing.
 *
 * Two places need it and they need the same rule. The transcript scan skips
 * these regions because a draft that was anonymized but never sent travels
 * with the user to whatever they open next, and reading it would file the
 * draft's tokens against an unrelated conversation. The reveal banner refuses
 * them because revealing replaces the region it annotates, and doing that to
 * a message box would write original values into text about to be sent. Two
 * implementations of that rule would eventually disagree, and the direction
 * they disagreed in would decide which of those two things went wrong.
 */

/** Anything the user can type into, by markup alone. */
const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

/**
 * True when `node` is, or sits inside, a region the user can type into.
 *
 * `composer` is the element the site adapter reports as this page's message
 * box, matched by identity. It is separate from the markup test because a
 * site can build a composer out of elements that carry none of these
 * attributes — and because the adapter can be wrong, which is why the markup
 * test stands on its own rather than deferring to it.
 */
export function isInEditableRegion(
  node: Node | null,
  composer: HTMLElement | null = null,
): boolean {
  const start = node?.nodeType === Node.ELEMENT_NODE
    ? (node as HTMLElement)
    : node?.parentElement ?? null;

  for (let el: HTMLElement | null = start; el; el = el.parentElement) {
    if (composer && el === composer) return true;
    if (el.isContentEditable) return true;
    if (typeof el.matches === 'function' && el.matches(EDITABLE_SELECTOR)) return true;
  }
  return false;
}
