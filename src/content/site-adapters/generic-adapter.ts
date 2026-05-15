import type { SiteAdapter } from './adapter-interface';
import { insertTextCompat } from './adapter-interface';

/**
 * Generic fallback adapter that uses common attribute selectors.
 * Used when no site-specific adapter matches the current hostname.
 */
export class GenericAdapter implements SiteAdapter {
  readonly name = 'Generic';

  getInputElement(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>(
        '[contenteditable="true"][role="textbox"]'
      ) ||
      document.querySelector<HTMLElement>('[contenteditable="true"]') ||
      document.querySelector<HTMLElement>('textarea')
    );
  }

  getResponseElements(): HTMLElement[] {
    // No reliable generic selector for AI responses
    return [];
  }

  insertText(element: HTMLElement, text: string): void {
    if (element instanceof HTMLTextAreaElement) {
      element.value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      insertTextCompat(element, text);
    }
  }

  observeResponses(_callback: (element: HTMLElement) => void): MutationObserver {
    // Generic adapter doesn't know which elements are AI responses
    const observer = new MutationObserver(() => {});
    observer.observe(document.body, { childList: true, subtree: true });
    return observer;
  }
}
