import { GenericAdapter } from './generic-adapter';

export class DeepLAdapter extends GenericAdapter {
  readonly name = 'DeepL';

  getInputElement(): HTMLElement | null {
    // DeepL uses 'd-textarea' and 'div[contenteditable]'
    return (
      document.querySelector<HTMLElement>('d-textarea[aria-labelledby="translation-source-heading"]') ||
      document.querySelector<HTMLElement>('d-textarea[data-testid="translator-source-input"]') ||
      document.querySelector<HTMLElement>('div[contenteditable="true"]') ||
      super.getInputElement()
    );
  }
}
