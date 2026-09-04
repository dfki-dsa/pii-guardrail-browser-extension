import type { SiteAdapter } from './adapter-interface';
import { insertTextCompat } from './adapter-interface';

export class GeminiAdapter implements SiteAdapter {
  readonly name = 'Gemini';

  getInputElement(): HTMLElement | null {
    // Gemini uses a rich text editor with contentEditable
    return (
      document.querySelector<HTMLElement>('.ql-editor[contenteditable="true"]') ||
      document.querySelector<HTMLElement>(
        '[contenteditable="true"][role="textbox"]'
      ) ||
      document.querySelector<HTMLElement>('[contenteditable="true"]')
    );
  }

  getResponseElements(): HTMLElement[] {
    // Gemini model responses
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        'message-content.model-response-text, .model-response-text'
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
