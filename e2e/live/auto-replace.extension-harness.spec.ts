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

const SURFACES = [
  {
    name: 'rich editor (Claude markup)',
    url: 'https://claude.ai/new',
    fixture: 'claude.html',
    composer: '[aria-label="Write your prompt to Claude"]',
  },
  {
    name: 'textarea (ChatGPT web-mobile markup)',
    url: 'https://chatgpt.com/',
    fixture: 'chatgpt-web-mobile.html',
    composer: '[data-mobile-composer-prompt]',
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
        body: `<!doctype html><html><head><title>fixture</title><style>[contenteditable]{display:block;min-height:3em;white-space:pre-wrap}</style></head><body>${markup}</body></html>`,
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

/** Compare what was typed, not how an editor chose to break its lines. */
function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
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
        await expect(page.locator('#pg-auto-replace-toast-host')).toHaveCount(1);

        await clickExtensionShadowControl(page, '#pg-auto-replace-toast-host', { id: 'pg-auto-undo-btn' });

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

        await clickExtensionShadowControl(page, '#pg-auto-replace-toast-host', { id: 'pg-auto-review-btn' });
        await page.locator('#pg-review-overlay-host').waitFor({ state: 'attached', timeout: 10_000 });
        await expect(page.locator('#pg-auto-replace-toast-host')).toHaveCount(0);
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

    test('Undo changes nothing once the replaced text was edited', async () => {
      const harness = await launch({ pasteReviewMode: 'auto' });
      try {
        const page = await openFakeSurface(harness, surface);
        await paste(page, surface.composer, PASTED);
        await expect.poll(() => composerText(page, surface.composer), { timeout: 30_000 })
          .toMatch(EMAIL_TOKEN);

        // The user rewrites the message before reaching for Undo.
        await page.locator(surface.composer).evaluate((element) => {
          const html = element as HTMLTextAreaElement | HTMLElement;
          if ('value' in html) html.value = 'Rewritten by hand.';
          else html.textContent = 'Rewritten by hand.';
        });

        await clickExtensionShadowControl(page, '#pg-auto-replace-toast-host', { id: 'pg-auto-undo-btn' });
        await page.waitForTimeout(500);

        const text = await composerText(page, surface.composer);
        expect(text.trim()).toBe('Rewritten by hand.');
        expect(text).not.toContain(EMAIL);
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
        await expect(page.locator('#pg-auto-replace-toast-host')).toHaveCount(0);
        // Held until the user decides: nothing has reached the message box.
        expect((await composerText(page, surface.composer)).trim()).toBe('');
      } finally {
        await harness.close();
      }
    });
  });
}
