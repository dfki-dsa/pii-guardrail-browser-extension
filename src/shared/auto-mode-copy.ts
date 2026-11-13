/**
 * What auto-mode does, in the two sentences shown behind its info tag.
 *
 * The switch appears in two places — the review pop-up and the extension
 * popup — and is one setting. Keeping the explanation here keeps the two from
 * describing it differently.
 */
export const AUTO_MODE_ON_HINT =
  'PII data redacted automatically with option to review or undo redaction.';

export const AUTO_MODE_OFF_HINT =
  'You review every time you paste any sensitive data.';

/**
 * How an Undo or Review ended. The notice shows these as a title and a
 * detail; the one-line status message after a review joins the same two, so
 * the wording cannot differ between them.
 */
export const RESTORED_TITLE = 'Original text restored';
export const RESTORED_DETAIL = 'Nothing is replaced';
export const RESTORE_FAILED_TITLE = "Couldn't restore the original";
export const UPDATE_FAILED_TITLE = "Couldn't apply your changes";
export const SWAP_FAILED_DETAIL = 'The message was edited or sent. Nothing was changed.';

/** A title and its detail on one line: "Title — detail". */
export function oneLine(title: string, detail: string): string {
  return `${title} \u2014 ${detail.charAt(0).toLowerCase()}${detail.slice(1)}`;
}
