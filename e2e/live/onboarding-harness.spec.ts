import { access } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { ExtensionHarness } from './harness';

const buildDir = path.resolve('dist');
const popupPath = (extensionId: string) => `chrome-extension://${extensionId}/popup/popup.html`;

async function launchHarness(): Promise<ExtensionHarness> {
  await access(path.join(buildDir, 'manifest.json'));
  return ExtensionHarness.launch({
    buildDir,
    headless: true,
    viewport: { width: 420, height: 600 },
    locale: 'en-US',
    timezoneId: 'Europe/Berlin',
    deepDiagnostics: false,
    recordTrace: false,
  });
}

async function seedHint(harness: ExtensionHarness, status: 'new' | 'existing'): Promise<void> {
  await harness.serviceWorker.evaluate(async (hintStatus) => {
    await chrome.storage.local.set({
      pg_onboarding_hint: { schemaVersion: 1, status: hintStatus },
    });
  }, status);
}

async function openPopup(harness: ExtensionHarness) {
  await harness.page.goto(popupPath(harness.extensionId));
  await expect(harness.page.getByRole('main', { name: 'Privacy Guardrail popup' })).toBeVisible();
  return harness.page;
}

test('fresh-install invitation is non-modal and Help remains available after Not now', async () => {
  const harness = await launchHarness();
  try {
    await harness.configure({ nerProvider: 'off', enabled: true });
    await seedHint(harness, 'new');
    const popup = await openPopup(harness);

    await expect(popup.getByText('Get to know Privacy Guardrail')).toBeVisible();
    await expect(popup.getByRole('dialog')).toHaveCount(0);
    await expect(popup.getByRole('button', { name: 'Help: start Protect tour' })).toBeVisible();
    await popup.getByRole('button', { name: 'Not now' }).click();
    await expect(popup.getByText('Get to know Privacy Guardrail')).toHaveCount(0);
    await expect(popup.getByRole('button', { name: 'Help: start Protect tour' })).toBeVisible();
  } finally {
    await harness.close();
  }
});

test('replays all ten coachmarks while Protect stays selected and tab anchors do not navigate', async () => {
  const harness = await launchHarness();
  try {
    await harness.configure({ nerProvider: 'off', enabled: true });
    await seedHint(harness, 'existing');
    const popup = await openPopup(harness);
    const help = popup.getByRole('button', { name: 'Help: start Protect tour' });
    await help.click();

    const dialog = popup.getByRole('dialog');
    await expect(dialog).toContainText('Step 1 of 10');
    await expect(popup.getByRole('button', { name: 'Protect' })).toHaveAttribute('aria-current', 'page');
    await expect(popup.getByRole('button', { name: 'Back' })).toBeDisabled();

    for (let step = 2; step <= 7; step += 1) {
      await popup.getByRole('button', { name: 'Next' }).click();
      await expect(dialog).toContainText(`Step ${step} of 10`);
    }

    for (const [step, tab] of [[7, 'Detect'], [8, 'Test'], [9, 'Settings']] as const) {
      await expect(dialog).toContainText(`Step ${step} of 10`);
      const target = popup.getByRole('button', { name: tab });
      const spotlight = popup.locator('.spotlight');
      await expect(target).toBeVisible();
      await expect(spotlight).toBeVisible();
      const [targetBox, spotlightBox] = await Promise.all([target.boundingBox(), spotlight.boundingBox()]);
      expect(targetBox).not.toBeNull();
      expect(spotlightBox).not.toBeNull();
      expect(Math.abs((spotlightBox!.x + spotlightBox!.width / 2) - (targetBox!.x + targetBox!.width / 2))).toBeLessThan(3);
      expect(Math.abs((spotlightBox!.y + spotlightBox!.height / 2) - (targetBox!.y + targetBox!.height / 2))).toBeLessThan(3);
      await expect(popup.getByRole('button', { name: 'Protect' })).toHaveAttribute('aria-current', 'page');
      await expect(target).not.toHaveAttribute('aria-current', 'page');
      await popup.getByRole('button', { name: 'Next' }).click();
    }

    await expect(dialog).toContainText('Step 10 of 10');
    await expect(popup.getByRole('button', { name: 'Next' })).toBeDisabled();
    await popup.getByRole('button', { name: 'End tour' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(help).toBeFocused();

    await help.click();
    await expect(dialog).toContainText('Step 1 of 10');
  } finally {
    await harness.close();
  }
});
