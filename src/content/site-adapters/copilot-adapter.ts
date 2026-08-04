import type { SiteAdapter } from './adapter-interface';
import { insertTextCompat } from './adapter-interface';

export class CopilotAdapter implements SiteAdapter {
  readonly name = 'Copilot';

  getInputElement(): HTMLElement | null {
    // Dynamically find the active element (the one receiving the paste), piercing shadow DOMs.
    // This is robust against Microsoft's frequent UI changes on copilot.com.
    let active = document.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) {
      active = active.shadowRoot.activeElement;
    }

    if (active) {
      const tag = active.tagName.toUpperCase();
      const isEditable = 
        tag === 'TEXTAREA' || 
        tag === 'INPUT' || 
        active.getAttribute('contenteditable') === 'true' || 
        (active as HTMLElement).isContentEditable;
        
      if (isEditable) {
        return active as HTMLElement;
      }
    }

    // Fallback: search for any textarea or contenteditable element in the main DOM
    return (
      document.querySelector<HTMLElement>('textarea') ||
      document.querySelector<HTMLElement>(
        '[contenteditable="true"][role="textbox"]'
      ) ||
      document.querySelector<HTMLElement>('[contenteditable="true"]')
    );
  }

  getResponseElements(): HTMLElement[] {
    // Attempt to pierce the shadow DOM for Microsoft Copilot responses
    // Structure: cib-serp -> cib-conversation -> cib-chat-turn -> cib-message-group -> cib-message[type="text"]
    const elements: HTMLElement[] = [];
    
    const serp = document.querySelector('cib-serp');
    if (serp && serp.shadowRoot) {
      const conversation = serp.shadowRoot.querySelector('cib-conversation');
      if (conversation && conversation.shadowRoot) {
        const turns = conversation.shadowRoot.querySelectorAll('cib-chat-turn');
        for (const turn of Array.from(turns)) {
          if (turn.shadowRoot) {
            const groups = turn.shadowRoot.querySelectorAll('cib-message-group');
            for (const group of Array.from(groups)) {
              if (group.shadowRoot) {
                // Focus on messages from the bot/assistant
                if (group.getAttribute('source') === 'bot') {
                  const messages = group.shadowRoot.querySelectorAll('cib-message[type="text"]');
                  for (const message of Array.from(messages)) {
                    if (message.shadowRoot) {
                      const shared = message.shadowRoot.querySelector('cib-shared');
                      if (shared) {
                        elements.push(shared as HTMLElement);
                      } else {
                        elements.push(message as HTMLElement);
                      }
                    } else {
                      elements.push(message as HTMLElement);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    return elements;
  }

  insertText(element: HTMLElement, text: string): void {
    if (element instanceof HTMLTextAreaElement) {
      element.value = text;
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    } else {
      insertTextCompat(element, text);
    }
  }

  observeResponses(callback: (element: HTMLElement) => void): MutationObserver {
    const container = document.querySelector('main') || document.body;
    const seen = new WeakSet<HTMLElement>();

    // Note: A simple MutationObserver on document.body won't detect changes deep inside shadow DOMs 
    // natively unless it's configured specifically or we just poll/re-query periodically when mutations happen.
    // Given the complexity of shadow DOM, we use a MutationObserver on the main body but rely on getResponseElements
    // to manually traverse the shadow trees.
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
