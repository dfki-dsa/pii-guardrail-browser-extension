/** @jest-environment jsdom */

import { EntityMap } from '../../src/shared/entity-map';
import { attachDeAnonBanner } from '../../src/ui/banner/de-anon-banner';

describe('attachDeAnonBanner', () => {
  const originalAttachShadow = HTMLElement.prototype.attachShadow;
  let writeTextMock: jest.Mock;

  beforeEach(() => {
    document.body.innerHTML = '';
    writeTextMock = jest.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    });

    jest
      .spyOn(HTMLElement.prototype, 'attachShadow')
      .mockImplementation(function attachOpenShadow(
        this: HTMLElement,
        init: ShadowRootInit,
      ): ShadowRoot {
        return originalAttachShadow.call(this, { ...init, mode: 'open' });
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function renderBannerFixture(): {
    responseElement: HTMLElement;
    revealBtn: HTMLButtonElement;
    copyBtn: HTMLButtonElement;
    originalMarkup: string;
  } {
    const entityMap = new EntityMap({
      '[PERSON_1]': 'Björn',
      '[EMAIL_1]': 'bjoern@busch.de',
    });

    const container = document.createElement('div');
    const responseElement = document.createElement('div');
    responseElement.innerHTML = `
      Intro text for Gemini.
      <p>Here is the information I received:</p>
      <ul>
        <li><strong>Name:</strong> [PERSON_1]</li>
        <li><strong>Email Address:</strong> [EMAIL_1]</li>
        <li><strong>Phone Number:</strong> [PHONE_1]</li>
      </ul>
    `;

    container.appendChild(responseElement);
    document.body.appendChild(container);

    const originalMarkup = responseElement.innerHTML;

    attachDeAnonBanner(responseElement, entityMap);

    const host = container.firstElementChild as HTMLElement;
    const shadow = host.shadowRoot;
    if (!shadow) {
      throw new Error('Expected de-anonymization banner to expose a shadow root in tests.');
    }

    const revealBtn = shadow.getElementById('pg-reveal-btn') as HTMLButtonElement | null;
    const copyBtn = shadow.getElementById('pg-copy-btn') as HTMLButtonElement | null;

    if (!revealBtn || !copyBtn) {
      throw new Error('Expected reveal and copy buttons to exist.');
    }

    return { responseElement, revealBtn, copyBtn, originalMarkup };
  }

  it('preserves block structure and unresolved placeholders when originals are revealed', () => {
    const { responseElement, revealBtn } = renderBannerFixture();

    revealBtn.click();

    const overlayEl = responseElement.querySelector('.pg-deanon-overlay-container') as HTMLElement | null;
    expect(overlayEl).not.toBeNull();
    if (!overlayEl) {
      throw new Error('Expected reveal overlay to exist.');
    }

    expect(overlayEl.querySelectorAll('p')).toHaveLength(1);
    expect(overlayEl.querySelectorAll('ul')).toHaveLength(1);
    expect(overlayEl.querySelectorAll('li')).toHaveLength(3);
    expect(overlayEl.textContent).toContain('Björn');
    expect(overlayEl.textContent).toContain('bjoern@busch.de');
    expect(overlayEl.textContent).toContain('[PHONE_1]');

    const highlighted = overlayEl.querySelector('.pg-revealed-person') as HTMLElement | null;
    expect(highlighted?.textContent).toBe('Björn');

    const directChildren = Array.from(responseElement.children);
    const originalParagraph = directChildren.find((child) => child.tagName === 'P') as HTMLElement | undefined;
    const originalList = directChildren.find((child) => child.tagName === 'UL') as HTMLElement | undefined;
    expect(originalParagraph?.style.display).toBe('none');
    expect(originalList?.style.display).toBe('none');
  });

  it('restores the original DOM when originals are hidden again', () => {
    const { responseElement, revealBtn, originalMarkup } = renderBannerFixture();

    revealBtn.click();
    revealBtn.click();

    expect(responseElement.querySelector('.pg-deanon-overlay-container')).toBeNull();
    expect(responseElement.innerHTML).toBe(originalMarkup);
    expect(revealBtn.textContent).toBe('Reveal originals');
  });

  it('attaches and highlights mangled placeholders against their canonical source', () => {
    const entityMap = new EntityMap({ '[PERSON_1]': 'Björn' });

    const container = document.createElement('div');
    const responseElement = document.createElement('div');
    responseElement.textContent = 'Hi PERSON 1, nice to meet you.';
    container.appendChild(responseElement);
    document.body.appendChild(container);

    attachDeAnonBanner(responseElement, entityMap);

    const host = container.firstElementChild as HTMLElement;
    expect(host.shadowRoot).not.toBeNull();
    const revealBtn = host.shadowRoot!.getElementById('pg-reveal-btn') as HTMLButtonElement;
    revealBtn.click();

    const overlayEl = responseElement.querySelector('.pg-deanon-overlay-container') as HTMLElement;
    expect(overlayEl).not.toBeNull();
    const highlight = overlayEl.querySelector('.pg-revealed-person') as HTMLElement;
    expect(highlight?.textContent).toBe('Björn');
    // The hover title surfaces the form actually written by the LLM.
    expect(highlight?.getAttribute('title')).toBe('Was: PERSON 1');
  });

  it('attaches when placeholders only live inside an artifact textarea, and reveals them in a static fragment', async () => {
    const entityMap = new EntityMap({
      '[PERSON_1]': 'Anna Schmidt',
      '[PERSON_2]': 'Lukas Wagner',
    });

    const container = document.createElement('div');
    const responseElement = document.createElement('div');
    // Mimic Claude's artifact card: a non-PII intro line plus form
    // controls whose .value carries the placeholders. textContent on its
    // own would not see those values for a controlled component.
    responseElement.innerHTML = `
      <p>Here are two options depending on tone.</p>
      <div class="card">
        <input type="text" />
        <textarea></textarea>
      </div>
    `;
    const subject = responseElement.querySelector('input') as HTMLInputElement;
    const body = responseElement.querySelector('textarea') as HTMLTextAreaElement;
    subject.value = 'Team change: [PERSON_1] -> [PERSON_2]';
    body.value = 'Hi,\nremoving [PERSON_1] in favour of [PERSON_2].';

    container.appendChild(responseElement);
    document.body.appendChild(container);

    attachDeAnonBanner(responseElement, entityMap);

    const host = container.firstElementChild as HTMLElement;
    expect(host.shadowRoot).not.toBeNull();
    const revealBtn = host.shadowRoot!.getElementById('pg-reveal-btn') as HTMLButtonElement;
    const copyBtn = host.shadowRoot!.getElementById('pg-copy-btn') as HTMLButtonElement;
    expect(host.shadowRoot!.querySelector('.pg-banner-text')?.textContent).toContain('4 anonymized items');

    revealBtn.click();

    const overlayEl = responseElement.querySelector('.pg-deanon-overlay-container') as HTMLElement | null;
    expect(overlayEl).not.toBeNull();
    if (!overlayEl) throw new Error('overlay missing');
    // Form controls in the overlay are replaced with static, de-anonymised
    // renderings — the originals can't surface .value through text nodes.
    expect(overlayEl.querySelectorAll('input, textarea')).toHaveLength(0);
    const formfields = overlayEl.querySelectorAll('.pg-revealed-formfield');
    expect(formfields).toHaveLength(2);
    const overlayText = overlayEl.textContent || '';
    expect(overlayText).toContain('Anna Schmidt');
    expect(overlayText).toContain('Lukas Wagner');

    copyBtn.click();
    await Promise.resolve();
    const copied = writeTextMock.mock.calls[0][0] as string;
    expect(copied).toContain('Anna Schmidt');
    expect(copied).toContain('Lukas Wagner');
    expect(copied).not.toContain('[PERSON_1]');
    expect(copied).not.toContain('[PERSON_2]');
  });

  it('copies fully de-anonymized plain text', async () => {
    const { copyBtn } = renderBannerFixture();

    copyBtn.click();
    await Promise.resolve();

    expect(writeTextMock).toHaveBeenCalledTimes(1);
    const copiedText = writeTextMock.mock.calls[0][0] as string;
    expect(copiedText).toContain('Björn');
    expect(copiedText).toContain('bjoern@busch.de');
    expect(copiedText).not.toContain('[PERSON_1]');
    expect(copiedText).not.toContain('[EMAIL_1]');
    expect(copiedText).toContain('[PHONE_1]');
  });
});
