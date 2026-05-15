import type { SiteAdapter } from './adapter-interface';
import { insertTextCompat } from './adapter-interface';

export class ChatGptAdapter implements SiteAdapter {
  readonly name = 'ChatGPT';

  getInputElement(): HTMLElement | null {
    // ChatGPT uses a contentEditable div inside the prompt form
    // Prefer the ProseMirror editor if present
    return (
      document.querySelector<HTMLElement>('#prompt-textarea') ||
      document.querySelector<HTMLElement>(
        '[contenteditable="true"][role="textbox"]'
      ) ||
      document.querySelector<HTMLElement>('[contenteditable="true"]')
    );
  }

  getResponseElements(): HTMLElement[] {
    // ChatGPT assistant messages have data-message-author-role="assistant"
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-message-author-role="assistant"]'
      )
    );
  }

  insertText(element: HTMLElement, text: string): void {
    insertTextCompat(element, text);
  }

  observeResponses(callback: (element: HTMLElement) => void): MutationObserver {
    const container =
      document.querySelector('main') || document.body;

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
