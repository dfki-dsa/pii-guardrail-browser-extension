/** @jest-environment jsdom */

import { ResponseObserver } from '../../src/content/response-observer';
import type { SiteAdapter } from '../../src/content/site-adapters/adapter-interface';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Slightly longer than RESPONSE_DEBOUNCE_MS (500) so a settle can complete. */
const SETTLE = 700;

/**
 * Mirrors how a streaming chat page behaves: response elements are appended
 * empty while the model is still generating, then filled in one or more
 * bursts. Langdock in particular pauses between markdown blocks.
 */
function makeAdapter(): SiteAdapter {
  const getEls = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-response]'));

  return {
    name: 'streaming-site',
    getInputElement: () => null,
    insertText: jest.fn(),
    getResponseElements: getEls,
    observeResponses: (cb) => {
      const seen = new WeakSet<HTMLElement>();
      const observer = new MutationObserver(() => {
        for (const el of getEls()) {
          if (!seen.has(el)) {
            seen.add(el);
            cb(el);
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      return observer;
    },
  };
}

function appendResponse(): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-response', '');
  document.body.append(el);
  return el;
}

describe('ResponseObserver streaming behaviour', () => {
  let observer: ResponseObserver | null = null;

  beforeEach(() => {
    document.body.replaceChildren();
  });

  afterEach(() => {
    observer?.stop();
    observer = null;
  });

  it('reports an element filled in a single burst exactly once', async () => {
    const onResponseWithPlaceholders = jest.fn();
    observer = new ResponseObserver(makeAdapter(), { onResponseWithPlaceholders });
    observer.start();

    const el = appendResponse();
    await wait(20);

    el.textContent = 'Absatz 1 — [PERSON_1] besucht den Supermarkt';
    await wait(SETTLE);

    // Previously fired twice: once from an unconditional timer in
    // watchElement and again via the debounce path.
    expect(onResponseWithPlaceholders).toHaveBeenCalledTimes(1);
  });

  it('still reports placeholders that stream in after a pause longer than the debounce', async () => {
    const onResponseWithPlaceholders = jest.fn();
    observer = new ResponseObserver(makeAdapter(), { onResponseWithPlaceholders });
    observer.start();

    // Appended empty while the previous block is still generating.
    const el = appendResponse();
    await wait(20);

    // Heading arrives, then the model pauses past the debounce window. The
    // old one-shot observer disconnected here and never looked again.
    el.textContent = 'Absatz 2 — Kontaktdaten';
    await wait(SETTLE);
    expect(onResponseWithPlaceholders).not.toHaveBeenCalled();

    // The rest of the paragraph, carrying the placeholders.
    el.textContent = 'Absatz 2 — Kontaktdaten [PERSON_1], [EMAIL_3], [PHONE_3]';
    await wait(SETTLE);

    expect(onResponseWithPlaceholders).toHaveBeenCalledTimes(1);
    expect(onResponseWithPlaceholders.mock.calls[0][1]).toContain('[PERSON_1]');
  });

  it('does not re-report an element whose content has not changed', async () => {
    const onResponseWithPlaceholders = jest.fn();
    observer = new ResponseObserver(makeAdapter(), { onResponseWithPlaceholders });
    observer.start();

    const el = appendResponse();
    await wait(20);
    el.textContent = 'Reply mentioning [PERSON_1]';
    await wait(SETTLE);

    // A mutation that carries no new text — e.g. the reveal overlay this
    // extension appends itself, or a framework re-render.
    el.setAttribute('data-decorated', 'true');
    await wait(SETTLE);

    expect(onResponseWithPlaceholders).toHaveBeenCalledTimes(1);
  });

  it('watches an element again after a stop()/start() cycle', async () => {
    const onResponseWithPlaceholders = jest.fn();
    observer = new ResponseObserver(makeAdapter(), { onResponseWithPlaceholders });
    observer.start();

    const el = appendResponse();
    await wait(20);

    // stop() disconnects the element's observer, so the bookkeeping that
    // records it as watched has to go with it — otherwise the element is
    // never re-observed and its reply stays unrevealable.
    observer.stop();
    observer.start();

    // The restarted observer needs a fresh mutation to notice the element
    // again, exactly as it would on a live page.
    document.body.append(document.createElement('span'));
    await wait(20);

    el.textContent = 'Reply after restart mentioning [PERSON_1]';
    await wait(SETTLE);

    expect(onResponseWithPlaceholders).toHaveBeenCalledTimes(1);
  });

  it('stops watching elements after stop()', async () => {
    const onResponseWithPlaceholders = jest.fn();
    observer = new ResponseObserver(makeAdapter(), { onResponseWithPlaceholders });
    observer.start();

    const el = appendResponse();
    await wait(20);
    observer.stop();

    el.textContent = 'Late reply with [PERSON_1]';
    await wait(SETTLE);

    expect(onResponseWithPlaceholders).not.toHaveBeenCalled();
  });
});
