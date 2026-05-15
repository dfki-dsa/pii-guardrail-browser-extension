import type { SiteAdapter } from './adapter-interface';
import { insertTextCompat } from './adapter-interface';

export class ClaudeAdapter implements SiteAdapter {
  readonly name = 'Claude';

  getInputElement(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>(
        '[contenteditable="true"][role="textbox"]'
      ) ||
      document.querySelector<HTMLElement>(
        'fieldset [contenteditable="true"]'
      ) ||
      document.querySelector<HTMLElement>('[contenteditable="true"]')
    );
  }

  getResponseElements(): HTMLElement[] {
    // Claude.ai assistant messages — look for response containers
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-is-streaming], .font-claude-message'
      )
    );
  }

  insertText(element: HTMLElement, text: string): void {
    insertTextCompat(element, text);
  }

  observeResponses(callback: (element: HTMLElement) => void): MutationObserver {
    const container = document.querySelector('main') || document.body;
    const seen = new WeakSet<HTMLElement>();

    const observer = new MutationObserver(() => {
      const responses = this.getResponseElements();
      for (const el of responses) {
        if (!seen.has(el)) {
          seen.add(el);
          callback(el);
        }
      }
    });

    observer.observe(container, { childList: true, subtree: true });
    return observer;
  }
}
