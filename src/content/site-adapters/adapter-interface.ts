import {
  findInFormControl,
  findTextRange,
  normalizeLineEnds,
  trimIgnorable,
  type OccurrenceHint,
} from '../composer-text-range';

/**
 * Where text was inserted, remembered so a later swap addresses the same
 * copy: the caret offset for a form control, the occurrence for a rich editor.
 */
export interface InsertHint {
  start?: number;
  occurrence?: OccurrenceHint | null;
}

/**
 * Interface for site-specific DOM adapters.
 * Each LLM chat site has different DOM structure — adapters abstract those differences.
 */
export interface SiteAdapter {
  /** Human-readable site name for logging. */
  readonly name: string;

  /** Find the main chat input element (contentEditable div or textarea). */
  getInputElement(): HTMLElement | null;

  /** Find all AI response elements currently in the DOM. */
  getResponseElements(): HTMLElement[];

  /**
   * Find the user's own messages currently in the DOM. They never get a
   * reveal banner. Optional: the generic adapter can't know them.
   */
  getUserMessageElements?(): HTMLElement[];

  /**
   * Insert text into the input element in a way that the site's framework
   * (React, ProseMirror, etc.) recognizes as user input.
   */
  insertText(element: HTMLElement, text: string): void;

  /**
   * Set up a MutationObserver to watch for new AI response elements.
   * Calls the callback with each new response element.
   */
  observeResponses(callback: (element: HTMLElement) => void): MutationObserver;
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', '']);

/**
 * True when the element is a form control whose caret lives on
 * `selectionStart`/`selectionEnd` rather than in a DOM Range.
 *
 * Composers built on `<textarea>` (ChatGPT's current web client) must not be
 * driven through `window.getSelection()`: a textarea's internal caret is not
 * addressable as a Range, so adding one moves the selection outside the
 * control and the insert lands in the wrong place — or nowhere.
 *
 * Uses `tagName` rather than `instanceof` so the check also holds for
 * elements from another realm (e.g. inside an iframe).
 */
export function isTextFormControl(
  element: HTMLElement | null,
): element is HTMLTextAreaElement | HTMLInputElement {
  if (!element) return false;
  if (element.tagName === 'TEXTAREA') return true;
  return (
    element.tagName === 'INPUT' &&
    TEXT_INPUT_TYPES.has((element as HTMLInputElement).type)
  );
}

/**
 * Run the `insertText` execCommand, reporting failure instead of throwing.
 *
 * execCommand is the only insertion path that both respects the caret and
 * lets the site's own editor keep its state in sync, so it stays the first
 * choice — but it is long deprecated and absent in some environments, so
 * every caller must be able to fall back.
 */
function tryExecInsertText(text: string): boolean {
  if (typeof document.execCommand !== 'function') return false;
  try {
    return document.execCommand('insertText', false, text);
  } catch {
    return false;
  }
}

/**
 * Assign through the prototype's native `value` setter so frameworks that
 * cache the last value they wrote (React and friends) still observe the
 * change and do not revert the field on their next render.
 */
function setFormControlValue(
  element: HTMLTextAreaElement | HTMLInputElement,
  value: string,
): void {
  const prototype =
    element.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  if (descriptor?.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }
}

/** Insert text at the caret of a `<textarea>` / `<input>` composer. */
function insertIntoFormControl(
  element: HTMLTextAreaElement | HTMLInputElement,
  text: string,
): void {
  element.focus();

  // execCommand respects the control's current selection and keeps both the
  // site's own input handling and the browser undo stack intact.
  if (tryExecInsertText(text)) return;

  // Fallback: splice the text in at the caret ourselves.
  const start = element.selectionStart ?? element.value.length;
  const end = element.selectionEnd ?? start;
  setFormControlValue(
    element,
    element.value.slice(0, start) + text + element.value.slice(end),
  );

  const caret = start + text.length;
  try {
    element.setSelectionRange(caret, caret);
  } catch {
    // Input types such as `email` reject setSelectionRange; the value is
    // already correct, only the caret position is lost.
  }

  element.dispatchEvent(
    new InputEvent('input', {
      inputType: 'insertText',
      data: text,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/**
 * Insert text using execCommand (deprecated but most reliable for contentEditable).
 * Falls back to InputEvent dispatch if execCommand fails.
 */
export function insertTextCompat(element: HTMLElement, text: string): void {
  if (isTextFormControl(element)) {
    insertIntoFormControl(element, text);
    return;
  }

  element.focus();

  // Preserve the current selection/cursor position so the pasted text
  // is inserted where the user's caret was, rather than replacing
  // the entire field content. If there is no selection (e.g. element
  // just received focus), collapse to the end so we append.
  const selection = window.getSelection();
  if (selection && selection.rangeCount === 0) {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false); // collapse to end
    selection.removeAllRanges();
    selection.addRange(range);
  }

  // Try execCommand first (works with React/ProseMirror state sync).
  // insertText replaces the current selection (or inserts at caret if collapsed).
  const success = tryExecInsertText(text);

  if (!success) {
    // Fallback: dispatch InputEvent — insert at caret via Range API
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      element.textContent = (element.textContent || '') + text;
    }
    element.dispatchEvent(
      new InputEvent('input', {
        inputType: 'insertText',
        data: text,
        bubbles: true,
        cancelable: true,
      })
    );
  }
}

/**
 * Swap text this extension inserted earlier for `newText`.
 *
 * Finds `oldText` in the composer, selects it, and inserts through the same
 * path as a paste, so the site's editor sees an ordinary replacement of a
 * selection. Returns false — having changed nothing — when `oldText` is not
 * there exactly once: the user edited it, sent it, or the editor reshaped it
 * beyond recognition.
 *
 * `hint` says which copy is meant when the same text is there more than once;
 * see `findInFormControl` and `findTextRange`.
 *
 * A true return means the swap was attempted, not that the editor kept it.
 * Callers that care — all of them — re-read the composer afterwards.
 */
export function replaceTextCompat(
  element: HTMLElement,
  oldText: string,
  newText: string,
  hint: InsertHint = {},
): boolean {
  if (isTextFormControl(element)) {
    const found = findInFormControl(element.value, oldText, hint.start);
    if (!found) return false;
    element.focus();
    try {
      element.setSelectionRange(found.start, found.end);
    } catch {
      // Without a selection the insert would land at the caret and leave the
      // old text in place beside the new. Not attempting it is the safe side.
      return false;
    }
    insertIntoFormControl(element, normalizeLineEnds(newText));
    return true;
  }

  const range = findTextRange(element, oldText, hint.occurrence);
  if (!range) return false;

  const selection = window.getSelection();
  if (!selection) return false;

  element.focus();
  selection.removeAllRanges();
  selection.addRange(range);
  // The range excludes whitespace around the old text, so the new text goes
  // in without its own — otherwise each swap would double the surrounding
  // blank lines.
  insertTextCompat(element, trimIgnorable(newText));
  return true;
}
