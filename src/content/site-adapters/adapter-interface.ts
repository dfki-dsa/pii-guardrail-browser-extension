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

/**
 * Insert text using execCommand (deprecated but most reliable for contentEditable).
 * Falls back to InputEvent dispatch if execCommand fails.
 */
export function insertTextCompat(element: HTMLElement, text: string): void {
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
  const success = document.execCommand('insertText', false, text);

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
