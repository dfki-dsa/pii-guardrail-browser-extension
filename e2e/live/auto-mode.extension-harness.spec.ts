import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { clickExtensionShadowControl } from './closed-shadow-control';
import { ExtensionHarness } from './harness';
import type { Settings } from '../../src/shared/message-types';

/**
 * Automatic replacement, end to end, in the built extension — without touching
 * a provider site.
 *
 * The content script only runs on the chat hosts, so the test navigates to one
 * of those URLs and answers every request itself with the captured composer
 * markup from `tests/fixtures/site-dom`. Nothing leaves the machine, and
 * anything the fake page does not serve is aborted rather than fetched.
 *
 * What this proves: the mode switch, the real paste path, the real
 * `execCommand` insertion and the Undo / Review swap in real Chromium, on a
 * plain contenteditable and a textarea. What it cannot prove: how the sites'
 * own editors (ProseMirror, Quill) take the swap. That stays a manual and
 * live-suite check.
 */

const EMAIL = 'jane.doe@example.com';
// Several lines with a blank one between: a rich editor splits these into
// blocks, which is the case the swap has to find its way back through.
const PASTED = `Hello,\n\nplease write to ${EMAIL} about the overdue invoice.\nThanks`;
const EMAIL_TOKEN = /\[EMAIL_\d+\]/;
const NOTHING_PERSONAL = 'Nothing in this sentence is personal data at all, it is only filler.';
/** Width of the stand-in sidebar; the window is 1200px wide. */
const SIDEBAR_PX = 480;

const SURFACES = [
  {
    name: 'rich editor (Claude markup)',
    url: 'https://claude.ai/new',
    fixture: 'claude.html',
    composer: '[aria-label="Write your prompt to Claude"]',
    replyInto: 'main',
    reply: (token: string) =>
      `<div data-is-streaming="false"><div class="font-claude-message"><p>Done, I wrote to ${token} today.</p></div></div>`,
    root: '#claude-root',
    userMessage: (token: string) =>
      `<div data-test-render-count="2"><div class="font-user-message"><p>Please write to ${token} about the invoice.</p></div></div>`,
  },
  {
    name: 'textarea (ChatGPT web-mobile markup)',
    url: 'https://chatgpt.com/',
    fixture: 'chatgpt-web-mobile.html',
    composer: '[data-mobile-composer-prompt]',
    replyInto: 'ol',
    reply: (token: string) =>
      `<li data-message-role="assistant"><div data-assistant-markdown><p>Done, I wrote to ${token} today.</p></div></li>`,
    root: '#web-mobile-root',
    userMessage: (token: string) =>
      `<li data-message-role="user"><div>Please write to ${token} about the invoice.</div></li>`,
  },
] as const;

type Surface = (typeof SURFACES)[number];

async function launch(settings: Partial<Settings>): Promise<ExtensionHarness> {
  const harness = await ExtensionHarness.launch({
    buildDir: path.resolve('dist'),
    headless: true,
    viewport: { width: 1200, height: 800 },
    locale: 'en-US',
    timezoneId: 'Europe/Berlin',
    deepDiagnostics: false,
    recordTrace: false,
  });
  // Pattern detection only: deterministic, and no model download.
  await harness.configure({ nerProvider: 'off', enabled: true, ...settings });
  return harness;
}

async function openFakeSurface(harness: ExtensionHarness, surface: Surface): Promise<Page> {
  const markup = await readFile(
    path.resolve('tests', 'fixtures', 'site-dom', surface.fixture),
    'utf8',
  );
  const origin = new URL(surface.url).origin;
  await harness.context.route('**/*', async (route) => {
    const request = route.request();
    if (request.isNavigationRequest() && request.url().startsWith(origin)) {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        // The captured markup carries no styles; an empty rich editor would
        // collapse to zero height and could be neither focused nor clicked.
        // The left padding stands in for a chat site's sidebar: the message
        // box is then well away from the middle of the window, as it is on
        // the real sites.
        body: `<!doctype html><html><head><title>fixture</title><style>body{margin:0;padding:24px 20px 24px ${SIDEBAR_PX}px}[contenteditable],textarea{display:block;width:100%;box-sizing:border-box;min-height:3em;white-space:pre-wrap}</style></head><body>${markup}</body></html>`,
      });
      return;
    }
    await route.abort();
  });
  await harness.page.goto(surface.url);
  await harness.page.locator(surface.composer).waitFor({ state: 'visible' });
  return harness.page;
}

/**
 * Paste through a synthetic event carrying its own clipboard payload, so the
 * test never reads or overwrites the system clipboard of whoever runs it.
 */
async function paste(page: Page, composer: string, text: string): Promise<void> {
  await page.locator(composer).focus();
  await page.evaluate(
    ({ selector, value }) => {
      const target = document.querySelector(selector) as HTMLElement;
      const data = new DataTransfer();
      data.setData('text/plain', value);
      target.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
    },
    { selector: composer, value: text },
  );
}

async function composerText(page: Page, composer: string): Promise<string> {
  return page.locator(composer).evaluate((element) => {
    const html = element as HTMLTextAreaElement | HTMLElement;
    return 'value' in html ? String(html.value) : html.innerText || html.textContent || '';
  });
}

interface CdpNode {
  nodeId?: number;
  backendNodeId?: number;
  attributes?: string[];
  children?: CdpNode[];
  shadowRoots?: CdpNode[];
}

/**
 * Where the review dialog is on screen. It lives in a closed shadow root, so
 * it is read through the DevTools protocol, which can see inside one.
 */
async function reviewDialogBox(page: Page): Promise<{ left: number; width: number }> {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('DOM.enable');
    const { root } = (await client.send('DOM.getDocument', { depth: 0 })) as { root: CdpNode };
    const { nodeId } = (await client.send('DOM.querySelector', {
      nodeId: root.nodeId!,
      selector: '#pg-review-overlay-host',
    })) as { nodeId: number };
    const { node } = (await client.send('DOM.describeNode', {
      nodeId,
      depth: -1,
      pierce: true,
    })) as { node: CdpNode };

    let dialog: CdpNode | null = null;
    const visit = (current: CdpNode): void => {
      const attributes = current.attributes ?? [];
      const classIndex = attributes.indexOf('class');
      const classes = classIndex >= 0 ? attributes[classIndex + 1].split(/\s+/) : [];
      if (classes.includes('pg-overlay')) dialog = current;
      for (const child of current.children ?? []) visit(child);
      for (const shadowRoot of current.shadowRoots ?? []) visit(shadowRoot);
    };
    visit(node);
    if (!dialog) throw new Error('Review dialog was not found inside its host');

    const { model } = (await client.send('DOM.getBoxModel', {
      backendNodeId: (dialog as CdpNode).backendNodeId,
    })) as { model: { border: number[] } };
    const left = model.border[0];
    const right = model.border[2];
    return { left, width: right - left };
  } finally {
    await client.detach();
  }
}

/** Compare what was typed, not how an editor chose to break its lines. */
function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * What sending looks like to the extension on every site: the message box is
 * emptied, and — when `reply` is given — an assistant turn shows up.
 */
async function send(page: Page, surface: Surface, reply?: string): Promise<void> {
  await page.evaluate(
    ({ composer, replyInto, html }) => {
      const box = document.querySelector(composer) as HTMLTextAreaElement | HTMLElement;
      if ('value' in box) box.value = '';
      else box.innerHTML = '<p></p>';
      if (html) {
        const holder = document.createElement('div');
        holder.innerHTML = html;
        (document.querySelector(replyInto) as HTMLElement).append(holder.firstElementChild!);
      }
    },
    { composer: surface.composer, replyInto: surface.replyInto, html: reply ?? '' },
  );
}

/** The saved choice between asking first and replacing automatically. */
async function storedMode(harness: ExtensionHarness): Promise<string | undefined> {
  return harness.serviceWorker.evaluate(async () => {
    const stored = await chrome.storage.local.get('pg_settings');
    return (stored.pg_settings as { pasteReviewMode?: string } | undefined)?.pasteReviewMode;
  });
}

function occurrences(text: string, pattern: RegExp): number {
  return (text.match(new RegExp(pattern.source, 'g')) ?? []).length;
}

for (const surface of SURFACES) {
  test.describe(`automatic replacement — ${surface.name}`, () => {
    test('replaces on paste with no review pop-up, and Undo restores the original', async () => {
      const harness = await launch({ pasteReviewMode: 'auto' });
      try {
        const page = await openFakeSurface(harness, surface);
        await paste(page, surface.composer, PASTED);

        await expect.poll(() => composerText(page, surface.composer), { timeout: 30_000 })
          .toMatch(EMAIL_TOKEN);
        expect(await composerText(page, surface.composer)).not.toContain(EMAIL);
        await expect(page.locator('#pg-review-overlay-host')).toHaveCount(0);
        await expect(page.locator('#pg-auto-mode-toast-host')).toHaveCount(1);

        await clickExtensionShadowControl(page, '#pg-auto-mode-toast-host', { id: 'pg-auto-undo-btn' });

        await expect.poll(() => composerText(page, surface.composer), { timeout: 10_000 })
          .toContain(EMAIL);
        const restored = await composerText(page, surface.composer);
        expect(restored).not.toMatch(EMAIL_TOKEN);
        expect(squash(restored)).toBe(squash(PASTED));
      } finally {
        await harness.close();
      }
    });

    test('Review opens the pop-up afterwards and confirming keeps one replacement', async () => {
      const harness = await launch({ pasteReviewMode: 'auto' });
      try {
        const page = await openFakeSurface(harness, surface);
        await paste(page, surface.composer, PASTED);
        await expect.poll(() => composerText(page, surface.composer), { timeout: 30_000 })
          .toMatch(EMAIL_TOKEN);

        await clickExtensionShadowControl(page, '#pg-auto-mode-toast-host', { id: 'pg-auto-review-btn' });
        await page.locator('#pg-review-overlay-host').waitFor({ state: 'attached', timeout: 10_000 });
        await expect(page.locator('#pg-auto-mode-toast-host')).toHaveCount(0);
        // The replaced text stays in the message box while the pop-up is open.
        expect(await composerText(page, surface.composer)).not.toContain(EMAIL);

        await clickExtensionShadowControl(page, '#pg-review-overlay-host', { id: 'pg-confirm-btn' });
        await page.locator('#pg-review-overlay-host').waitFor({ state: 'detached', timeout: 10_000 });

        const text = await composerText(page, surface.composer);
        expect(text).not.toContain(EMAIL);
        // Swapped in place, not inserted a second time.
        expect(occurrences(text, EMAIL_TOKEN)).toBe(1);
      } finally {
        await harness.close();
      }
    });

    test('the notice leaves, changing nothing, once the replaced text was edited', async () => {
      const harness = await launch({ pasteReviewMode: 'auto' });
      try {
        const page = await openFakeSurface(harness, surface);
        await paste(page, surface.composer, PASTED);
        await expect.poll(() => composerText(page, surface.composer), { timeout: 30_000 })
          .toMatch(EMAIL_TOKEN);
        await expect(page.locator('#pg-auto-mode-toast-host')).toHaveCount(1);

        // The user rewrites the message. Undo and Review have nothing left to
        // act on, so the notice goes rather than offering a click that fails.
        await page.locator(surface.composer).evaluate((element) => {
          const html = element as HTMLTextAreaElement | HTMLElement;
          if ('value' in html) html.value = 'Rewritten by hand.';
          else html.textContent = 'Rewritten by hand.';
        });

        await expect(page.locator('#pg-auto-mode-toast-host')).toHaveCount(0, { timeout: 3_000 });
        const text = await composerText(page, surface.composer);
        expect(text.trim()).toBe('Rewritten by hand.');
        expect(text).not.toContain(EMAIL);
      } finally {
        await harness.close();
      }
    });

    test('the notice stays while the user types around the replaced text, and leaves on send', async () => {
      const harness = await launch({ pasteReviewMode: 'auto' });
      try {
        const page = await openFakeSurface(harness, surface);
        await paste(page, surface.composer, PASTED);
        await expect.poll(() => composerText(page, surface.composer), { timeout: 30_000 })
          .toMatch(EMAIL_TOKEN);

        // Adding a question after the pasted text leaves it intact.
        await page.locator(surface.composer).evaluate((element) => {
          const html = element as HTMLTextAreaElement | HTMLElement;
          if ('value' in html) html.value += '\nCan you summarise this?';
          else html.append(Object.assign(document.createElement('p'), { textContent: 'Can you summarise this?' }));
        });
        await page.waitForTimeout(1_200);
        await expect(page.locator('#pg-auto-mode-toast-host')).toHaveCount(1);

        await send(page, surface);

        await expect(page.locator('#pg-auto-mode-toast-host')).toHaveCount(0, { timeout: 3_000 });
      } finally {
        await harness.close();
      }
    });

    test('a reply that echoes a replaced token still gets the reveal banner', async () => {
      const harness = await launch({ pasteReviewMode: 'auto' });
      try {
        const page = await openFakeSurface(harness, surface);
        await paste(page, surface.composer, PASTED);
        await expect.poll(() => composerText(page, surface.composer), { timeout: 30_000 })
          .toMatch(EMAIL_TOKEN);
        const token = (await composerText(page, surface.composer)).match(EMAIL_TOKEN)![0];
        const bannersBefore = await page.locator('.pg-deanon-host').count();

        await send(page, surface, surface.reply(token));

        await expect
          .poll(() => page.locator('.pg-deanon-host').count(), { timeout: 10_000 })
          .toBeGreaterThan(bannersBefore);
      } finally {
        await harness.close();
      }
    });

    test('the reveal banner lines up with a reply whose text sits in a narrower, centred column', async () => {
      const harness = await launch({ pasteReviewMode: 'auto' });
      try {
        const page = await openFakeSurface(harness, surface);
        await paste(page, surface.composer, PASTED);
        await expect.poll(() => composerText(page, surface.composer), { timeout: 30_000 })
          .toMatch(EMAIL_TOKEN);
        const token = (await composerText(page, surface.composer)).match(EMAIL_TOKEN)![0];

        // Gemini's layout: the reply element spans the chat area and each
        // block in it is centred to a measure of its own.
        const centred = surface
          .reply(token)
          .replace('<p>', '<p data-column style="max-width:320px;margin:0 auto">');
        await send(page, surface, centred);

        const column = page.locator('[data-column]');
        await column.waitFor({ state: 'visible' });
        const banner = page.locator('.pg-deanon-host').last();
        await expect
          .poll(async () => Math.round((await banner.boundingBox())?.width ?? 0), { timeout: 10_000 })
          .toBe(320);
        const bannerBox = (await banner.boundingBox())!;
        const columnBox = (await column.boundingBox())!;
        expect(Math.abs(bannerBox.x - columnBox.x)).toBeLessThanOrEqual(1);
      } finally {
        await harness.close();
      }
    });

    test('the reveal banner comes back when the site drops it while re-rendering', async () => {
      const harness = await launch({ pasteReviewMode: 'auto' });
      try {
        const page = await openFakeSurface(harness, surface);
        await paste(page, surface.composer, PASTED);
        await expect.poll(() => composerText(page, surface.composer), { timeout: 30_000 })
          .toMatch(EMAIL_TOKEN);
        const token = (await composerText(page, surface.composer)).match(EMAIL_TOKEN)![0];
        const bannersBefore = await page.locator('.pg-deanon-host').count();

        await send(page, surface, surface.reply(token));
        await expect
          .poll(() => page.locator('.pg-deanon-host').count(), { timeout: 10_000 })
          .toBeGreaterThan(bannersBefore);
        const bannersWithReply = await page.locator('.pg-deanon-host').count();

        // A chat site finishing a reply re-renders around it. The banner sits
        // beside the reply in markup the site owns, so it can be swept away
        // while the reply element — and the mark saying it has a banner —
        // survives. The page then keeps changing, as pages do.
        await page.evaluate((replyInto) => {
          for (const host of Array.from(document.querySelectorAll('.pg-deanon-host'))) host.remove();
          const filler = document.createElement('div');
          filler.textContent = 'copy / like / retry';
          (document.querySelector(replyInto) as HTMLElement).append(filler);
        }, surface.replyInto);
        expect(await page.locator('.pg-deanon-host').count()).toBe(0);

        await expect
          .poll(() => page.locator('.pg-deanon-host').count(), { timeout: 10_000 })
          .toBe(bannersWithReply);
      } finally {
        await harness.close();
      }
    });

    test('a reply gets its banner after the site rebuilt the page around a message that already showed the tokens', async () => {
      const harness = await launch({ pasteReviewMode: 'auto' });
      try {
        const page = await openFakeSurface(harness, surface);
        await paste(page, surface.composer, PASTED);
        await expect.poll(() => composerText(page, surface.composer), { timeout: 30_000 })
          .toMatch(EMAIL_TOKEN);
        const token = (await composerText(page, surface.composer)).match(EMAIL_TOKEN)![0];

        // Sending a first message: the site swaps its whole app region for a
        // new one and renders the user's own message, tokens included.
        await page.evaluate(
          ({ root, composer, replyInto, html }) => {
            const old = document.querySelector(root) as HTMLElement;
            const fresh = old.cloneNode(true) as HTMLElement;
            old.replaceWith(fresh);
            const box = document.querySelector(composer) as HTMLTextAreaElement | HTMLElement;
            if ('value' in box) box.value = '';
            else box.innerHTML = '<p></p>';
            const holder = document.createElement('div');
            holder.innerHTML = html;
            (document.querySelector(replyInto) as HTMLElement).append(holder.firstElementChild!);
          },
          {
            root: surface.root,
            composer: surface.composer,
            replyInto: surface.replyInto,
            html: surface.userMessage(token),
          },
        );
        // Long enough for the page scan to have seen the token in that message.
        await page.waitForTimeout(2_000);
        const bannersBefore = await page.locator('.pg-deanon-host').count();

        // The reply then repeats a token that is, by now, nothing new.
        await page.evaluate(
          ({ replyInto, html }) => {
            const holder = document.createElement('div');
            holder.innerHTML = html;
            (document.querySelector(replyInto) as HTMLElement).append(holder.firstElementChild!);
          },
          { replyInto: surface.replyInto, html: surface.reply(token) },
        );

        await expect
          .poll(() => page.locator('.pg-deanon-host').count(), { timeout: 10_000 })
          .toBeGreaterThan(bannersBefore);
      } finally {
        await harness.close();
      }
    });

    test('"Auto-mode" in the pop-up turns automatic replacement on', async () => {
      const harness = await launch({});
      try {
        const page = await openFakeSurface(harness, surface);
        await paste(page, surface.composer, PASTED);
        await page.locator('#pg-review-overlay-host').waitFor({ state: 'attached', timeout: 30_000 });
        expect(await storedMode(harness)).toBe('review');

        // The switch is a standing preference: saved the moment it is flipped,
        // before anything is decided about this paste.
        await clickExtensionShadowControl(page, '#pg-review-overlay-host', { id: 'pg-auto-mode-toggle' });
        await expect.poll(() => storedMode(harness), { timeout: 5_000 }).toBe('auto');
        expect((await composerText(page, surface.composer)).trim()).toBe('');

        // This paste is still confirmed by hand...
        await clickExtensionShadowControl(page, '#pg-review-overlay-host', { id: 'pg-confirm-btn' });
        await expect.poll(() => composerText(page, surface.composer), { timeout: 10_000 })
          .toMatch(EMAIL_TOKEN);
        await send(page, surface);

        // ...and the next one is not asked about.
        await paste(page, surface.composer, PASTED);
        await expect.poll(() => composerText(page, surface.composer), { timeout: 30_000 })
          .toMatch(EMAIL_TOKEN);
        await expect(page.locator('#pg-review-overlay-host')).toHaveCount(0);
        await expect(page.locator('#pg-auto-mode-toast-host')).toHaveCount(1);
      } finally {
        await harness.close();
      }
    });

    test('the same switch, reached from the notice, goes back to asking first', async () => {
      const harness = await launch({ pasteReviewMode: 'auto' });
      try {
        const page = await openFakeSurface(harness, surface);
        await paste(page, surface.composer, PASTED);
        await expect.poll(() => composerText(page, surface.composer), { timeout: 30_000 })
          .toMatch(EMAIL_TOKEN);

        await clickExtensionShadowControl(page, '#pg-auto-mode-toast-host', { id: 'pg-auto-review-btn' });
        await page.locator('#pg-review-overlay-host').waitFor({ state: 'attached', timeout: 10_000 });
        await clickExtensionShadowControl(page, '#pg-review-overlay-host', { id: 'pg-auto-mode-toggle' });
        await expect.poll(() => storedMode(harness), { timeout: 5_000 }).toBe('review');

        // Nothing was changed, so the main button keeps the text as it is.
        await clickExtensionShadowControl(page, '#pg-review-overlay-host', { id: 'pg-confirm-btn' });
        await page.locator('#pg-review-overlay-host').waitFor({ state: 'detached', timeout: 10_000 });
        expect(occurrences(await composerText(page, surface.composer), EMAIL_TOKEN)).toBe(1);
        await send(page, surface);

        await paste(page, surface.composer, PASTED);
        await page.locator('#pg-review-overlay-host').waitFor({ state: 'attached', timeout: 30_000 });
        await expect(page.locator('#pg-auto-mode-toast-host')).toHaveCount(0);
        expect((await composerText(page, surface.composer)).trim()).toBe('');
      } finally {
        await harness.close();
      }
    });

    test('"Restore original" in a review opened from the notice puts the original back', async () => {
      const harness = await launch({ pasteReviewMode: 'auto' });
      try {
        const page = await openFakeSurface(harness, surface);
        await paste(page, surface.composer, PASTED);
        await expect.poll(() => composerText(page, surface.composer), { timeout: 30_000 })
          .toMatch(EMAIL_TOKEN);

        await clickExtensionShadowControl(page, '#pg-auto-mode-toast-host', { id: 'pg-auto-review-btn' });
        await page.locator('#pg-review-overlay-host').waitFor({ state: 'attached', timeout: 10_000 });
        await clickExtensionShadowControl(page, '#pg-review-overlay-host', { id: 'pg-paste-original-btn' });
        await page.locator('#pg-review-overlay-host').waitFor({ state: 'detached', timeout: 10_000 });

        await expect.poll(() => composerText(page, surface.composer), { timeout: 10_000 })
          .toContain(EMAIL);
        const restored = await composerText(page, surface.composer);
        expect(restored).not.toMatch(EMAIL_TOKEN);
        expect(squash(restored)).toBe(squash(PASTED));
      } finally {
        await harness.close();
      }
    });

    test('closing the notice by hand keeps the replacement', async () => {
      const harness = await launch({ pasteReviewMode: 'auto' });
      try {
        const page = await openFakeSurface(harness, surface);
        await paste(page, surface.composer, PASTED);
        await expect.poll(() => composerText(page, surface.composer), { timeout: 30_000 })
          .toMatch(EMAIL_TOKEN);

        await clickExtensionShadowControl(page, '#pg-auto-mode-toast-host', { id: 'pg-auto-close-btn' });

        await expect(page.locator('#pg-auto-mode-toast-host')).toHaveCount(0);
        const text = await composerText(page, surface.composer);
        expect(text).toMatch(EMAIL_TOKEN);
        expect(text).not.toContain(EMAIL);
      } finally {
        await harness.close();
      }
    });

    test('Undo restores the second of two identical pastes and leaves the first replaced', async () => {
      const harness = await launch({ pasteReviewMode: 'auto' });
      try {
        const page = await openFakeSurface(harness, surface);
        await paste(page, surface.composer, PASTED);
        await expect.poll(() => composerText(page, surface.composer), { timeout: 30_000 })
          .toMatch(EMAIL_TOKEN);
        await paste(page, surface.composer, PASTED);
        await expect
          .poll(async () => occurrences(await composerText(page, surface.composer), EMAIL_TOKEN), { timeout: 30_000 })
          .toBe(2);

        await clickExtensionShadowControl(page, '#pg-auto-mode-toast-host', { id: 'pg-auto-undo-btn' });

        // One copy is back to the original, the other still replaced —
        // and it is the later one that was undone.
        await expect.poll(() => composerText(page, surface.composer), { timeout: 10_000 })
          .toContain(EMAIL);
        const text = await composerText(page, surface.composer);
        expect(occurrences(text, EMAIL_TOKEN)).toBe(1);
        expect(text.search(EMAIL_TOKEN)).toBeLessThan(text.indexOf(EMAIL));
      } finally {
        await harness.close();
      }
    });

    test('puts its notices over the message box, not the middle of the window', async () => {
      const harness = await launch({ pasteReviewMode: 'auto' });
      try {
        const page = await openFakeSurface(harness, surface);

        // The Undo / Review notice lives in a closed shadow root, so it is
        // located by what is under a point rather than by measuring it.
        await paste(page, surface.composer, PASTED);
        await page.locator('#pg-auto-mode-toast-host').waitFor({ state: 'attached', timeout: 30_000 });
        await page.waitForTimeout(300);
        const toast = await page.evaluate((selector) => {
          const box = (document.querySelector(selector) as HTMLElement).getBoundingClientRect();
          const composerCenter = box.left + box.width / 2;
          // The notice sits 132px above the bottom edge; probe inside it.
          const y = window.innerHeight - 132 - 20;
          const isToast = (x: number): boolean =>
            document.elementFromPoint(x, y)?.id === 'pg-auto-mode-toast-host';
          // Walk outward from the message box's centre to find the notice's
          // edges, so the check holds whatever width the notice has.
          let left = composerCenter;
          let right = composerCenter;
          while (left > 0 && isToast(left - 2)) left -= 2;
          while (right < window.innerWidth && isToast(right + 2)) right += 2;
          return {
            composerCenter,
            windowCenter: window.innerWidth / 2,
            overComposer: isToast(composerCenter),
            toastCenter: (left + right) / 2,
            toastWidth: right - left,
          };
        }, surface.composer);
        expect(Math.abs(toast.composerCenter - toast.windowCenter)).toBeGreaterThan(200);
        expect(toast.overComposer).toBe(true);
        expect(toast.toastWidth).toBeGreaterThan(100);
        expect(Math.abs(toast.toastCenter - toast.composerCenter)).toBeLessThan(6);
        expect(Math.abs(toast.toastCenter - toast.windowCenter)).toBeGreaterThan(200);

        // The plain status pill is ordinary DOM and can be measured directly.
        await paste(page, surface.composer, NOTHING_PERSONAL);
        await page.locator('#pg-indicator').waitFor({ state: 'attached', timeout: 30_000 });
        const pill = await page.evaluate((selector) => {
          const box = (document.querySelector(selector) as HTMLElement).getBoundingClientRect();
          const rect = (document.getElementById('pg-indicator') as HTMLElement).getBoundingClientRect();
          return {
            composerCenter: box.left + box.width / 2,
            pillCenter: rect.left + rect.width / 2,
          };
        }, surface.composer);
        expect(Math.abs(pill.pillCenter - pill.composerCenter)).toBeLessThan(3);
      } finally {
        await harness.close();
      }
    });

    test('still reviews first when automatic replacement is off', async () => {
      const harness = await launch({});
      try {
        const page = await openFakeSurface(harness, surface);
        await paste(page, surface.composer, PASTED);

        await page.locator('#pg-review-overlay-host').waitFor({ state: 'attached', timeout: 30_000 });
        await expect(page.locator('#pg-auto-mode-toast-host')).toHaveCount(0);
        // Held until the user decides: nothing has reached the message box.
        expect((await composerText(page, surface.composer)).trim()).toBe('');

        // The dialog is too wide to centre on the message box, so it moves
        // toward it as far as the window allows and no further.
        const dialog = await reviewDialogBox(page);
        const viewport = page.viewportSize()!;
        expect(dialog.left + dialog.width / 2).toBeGreaterThan(viewport.width / 2 + 20);
        expect(dialog.left).toBeGreaterThanOrEqual(24 - 1);
        expect(dialog.left + dialog.width).toBeLessThanOrEqual(viewport.width - 24 + 1);
      } finally {
        await harness.close();
      }
    });
  });
}
