/** @jest-environment jsdom */

import { EntityMap } from '../../src/shared/entity-map';
import { resolveText } from '../../src/shared/placeholder-resolver';
import { attachDeAnonBanner, type TokenResolver } from '../../src/ui/banner/de-anon-banner';

/**
 * The banner is handed a resolver rather than a map of what is resolvable,
 * and asks it again on every render and every click. The conversation scope
 * grows while a page is open, and a banner answering from a snapshot taken
 * when it attached would understate what the user can actually recover.
 */
function resolverFor(entityMap: EntityMap): TokenResolver {
  return (text) => resolveText(text, entityMap);
}

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
    host: HTMLElement;
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

    attachDeAnonBanner(responseElement, resolverFor(entityMap), { readFormControls: true });

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

    return { host, responseElement, revealBtn, copyBtn, originalMarkup };
  }

  it('renders the banner with the shared notification design surface', () => {
    const { host } = renderBannerFixture();

    const banner = host.shadowRoot?.querySelector('.pg-banner') as HTMLElement | null;
    expect(banner?.classList.contains('pg-design-surface')).toBe(true);
    expect(banner?.getAttribute('role')).toBe('status');
    expect(banner?.getAttribute('aria-live')).toBe('polite');
  });

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

    attachDeAnonBanner(responseElement, resolverFor(entityMap));

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

    attachDeAnonBanner(responseElement, resolverFor(entityMap), { readFormControls: true });

    const host = container.firstElementChild as HTMLElement;
    expect(host.shadowRoot).not.toBeNull();
    const revealBtn = host.shadowRoot!.getElementById('pg-reveal-btn') as HTMLButtonElement;
    const copyBtn = host.shadowRoot!.getElementById('pg-copy-btn') as HTMLButtonElement;
    expect(host.shadowRoot!.querySelector('.pg-banner-text')?.textContent).toContain('4 replaced items');

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

  it('still attaches once content that resolves arrives later', () => {
    const entityMap = new EntityMap({ '[PERSON_1]': 'Lukas Wagner' });
    const responseElement = document.createElement('div');
    document.body.append(responseElement);

    // A streaming response inspected before any placeholder has arrived.
    // Marking the element as handled here used to suppress the banner for
    // good, so the reply never became revealable.
    attachDeAnonBanner(responseElement, resolverFor(entityMap));
    expect(document.querySelector('.pg-deanon-host')).toBeNull();
    expect(responseElement.dataset.pgBanner).toBeUndefined();

    responseElement.textContent = 'Reply about [PERSON_1]';
    attachDeAnonBanner(responseElement, resolverFor(entityMap));

    expect(document.querySelectorAll('.pg-deanon-host')).toHaveLength(1);
    expect(responseElement.dataset.pgBanner).toBe('attached');
  });

  it('reveals placeholders nested inside a ChatGPT canvas block', () => {
    // ChatGPT renders a canvas ("writing block") as a widget section nested
    // inside the assistant turn, with the prose in a `role="textbox"` wrapper
    // rather than as a direct child. The other fixtures here keep their
    // placeholders in flat top-level prose, so nothing covered the reveal
    // walk reaching through that wrapper.
    const entityMap = new EntityMap({ '[PERSON_1]': 'Björn', '[PERSON_4]': 'Lukas Wagner' });

    const container = document.createElement('div');
    const responseElement = document.createElement('div');
    responseElement.innerHTML = `
      <div>Hier ist eine freundliche Absage:</div>
      <section data-assistant-writing-block data-writing-block-id="58321" data-shared-block-mounted>
        <div data-assistant-writing-block-content role="textbox">
          <p>Vielen Dank an [PERSON_1] für die Organisation.</p>
          <p>Und an [PERSON_4] ganz liebe Grüße.</p>
        </div>
      </section>
    `;
    container.appendChild(responseElement);
    document.body.appendChild(container);

    attachDeAnonBanner(responseElement, resolverFor(entityMap));
    const revealBtn = (container.firstElementChild as HTMLElement).shadowRoot
      ?.getElementById('pg-reveal-btn') as HTMLButtonElement;
    revealBtn.click();

    const overlayEl = responseElement.querySelector('.pg-deanon-overlay-container');
    expect(overlayEl?.querySelectorAll('.pg-revealed')).toHaveLength(2);
    expect(overlayEl?.textContent).toContain('Björn');
    expect(overlayEl?.textContent).toContain('Lukas Wagner');
    expect(overlayEl?.textContent).not.toContain('[PERSON_1]');
    // The widget wrapper itself must survive, or the revealed copy loses the
    // canvas's block structure.
    expect(overlayEl?.querySelectorAll('[data-assistant-writing-block]')).toHaveLength(1);
  });

  it('does not attach a second banner to the same response element', () => {
    const entityMap = new EntityMap({ '[PERSON_1]': 'Lukas Wagner' });
    const responseElement = document.createElement('div');
    responseElement.textContent = 'Reply about [PERSON_1]';
    document.body.append(responseElement);

    attachDeAnonBanner(responseElement, resolverFor(entityMap));
    attachDeAnonBanner(responseElement, resolverFor(entityMap));

    expect(document.querySelectorAll('.pg-deanon-host')).toHaveLength(1);
  });

  describe('never annotates something the user types into', () => {
    it('refuses a contenteditable target', () => {
      // Revealing replaces the subtree it annotates. Doing that to a message
      // box would write original values into text about to be sent.
      const entityMap = new EntityMap({ '[PERSON_1]': 'Lukas Wagner' });
      const composer = document.createElement('div');
      composer.setAttribute('contenteditable', 'true');
      composer.textContent = 'Draft about [PERSON_1]';
      document.body.append(composer);

      expect(attachDeAnonBanner(composer, resolverFor(entityMap))).toBeNull();
      expect(document.querySelector('.pg-deanon-host')).toBeNull();
    });

    it('refuses a target nested inside an editable region', () => {
      const entityMap = new EntityMap({ '[PERSON_1]': 'Lukas Wagner' });
      const composer = document.createElement('div');
      composer.setAttribute('contenteditable', 'true');
      const line = document.createElement('p');
      line.textContent = 'Draft about [PERSON_1]';
      composer.append(line);
      document.body.append(composer);

      expect(attachDeAnonBanner(line, resolverFor(entityMap))).toBeNull();
    });
  });

  describe('reads form controls only where it is told to', () => {
    function artifactReply(): HTMLElement {
      const responseElement = document.createElement('div');
      responseElement.innerHTML = '<p>Draft attached.</p><textarea></textarea>';
      (responseElement.querySelector('textarea') as HTMLTextAreaElement).value =
        'Dear [PERSON_1],';
      document.body.append(responseElement);
      return responseElement;
    }

    it('counts a token inside an artifact card in a matched turn', () => {
      const entityMap = new EntityMap({ '[PERSON_1]': 'Lukas Wagner' });

      const banner = attachDeAnonBanner(artifactReply(), resolverFor(entityMap), {
        readFormControls: true,
      });

      expect(banner).not.toBeNull();
    });

    it('reads inert text only when it attached on a generic match', () => {
      // Nobody vouched for this markup, so a form control here could be any
      // field on the page rather than the reply's own artifact card.
      const entityMap = new EntityMap({ '[PERSON_1]': 'Lukas Wagner' });

      expect(attachDeAnonBanner(artifactReply(), resolverFor(entityMap))).toBeNull();
    });
  });

  describe('follows the scope rather than a snapshot of it', () => {
    function growingScope(): {
      resolve: TokenResolver;
      grow: () => void;
    } {
      let entityMap = new EntityMap({ '[PERSON_1]': 'Lukas Wagner' });
      return {
        resolve: (text) => resolveText(text, entityMap),
        grow: () => {
          entityMap = new EntityMap({
            '[PERSON_1]': 'Lukas Wagner',
            '[EMAIL_2]': 'lukas@example.test',
          });
        },
      };
    }

    it('updates the count when the scope grows after it attached', () => {
      const { resolve, grow } = growingScope();
      const responseElement = document.createElement('div');
      responseElement.textContent = 'Write to [PERSON_1] at [EMAIL_2].';
      document.body.append(responseElement);

      const banner = attachDeAnonBanner(responseElement, resolve);
      const host = document.querySelector('.pg-deanon-host') as HTMLElement;
      const countText = (): string =>
        host.shadowRoot?.querySelector('.pg-banner-text')?.textContent ?? '';
      expect(countText()).toContain('1 replaced item');

      grow();
      banner?.refresh();

      expect(countText()).toContain('2 replaced items');
    });

    it('reveals against what is known at click time, not at attach time', () => {
      const { resolve, grow } = growingScope();
      const responseElement = document.createElement('div');
      responseElement.textContent = 'Write to [PERSON_1] at [EMAIL_2].';
      document.body.append(responseElement);

      attachDeAnonBanner(responseElement, resolve);
      grow();

      const host = document.querySelector('.pg-deanon-host') as HTMLElement;
      (host.shadowRoot?.getElementById('pg-reveal-btn') as HTMLButtonElement).click();

      const overlay = responseElement.querySelector('.pg-deanon-overlay-container');
      expect(overlay?.textContent).toContain('lukas@example.test');
      expect(overlay?.textContent).not.toContain('[EMAIL_2]');
    });
  });
});
