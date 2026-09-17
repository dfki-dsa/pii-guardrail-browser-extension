import { access } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
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

async function readHint(harness: ExtensionHarness): Promise<unknown> {
  return harness.serviceWorker.evaluate(async () => {
    const stored = await chrome.storage.local.get('pg_onboarding_hint');
    return stored.pg_onboarding_hint;
  });
}

async function openPopup(harness: ExtensionHarness) {
  await harness.page.goto(popupPath(harness.extensionId));
  await expect(harness.page.getByRole('main', { name: 'Privacy Guardrail popup' })).toBeVisible();
  return harness.page;
}

async function expectHaloAtAnchor(popup: Page, anchor: string): Promise<void> {
  const target = popup.locator(`[data-onboarding-anchor="${anchor}"]`);
  const halo = popup.locator('.target-halo');
  await expect(target).toBeVisible();
  await expect(halo).toBeVisible();
  await expect.poll(async () => {
    const [targetBox, haloBox] = await Promise.all([target.boundingBox(), halo.boundingBox()]);
    if (!targetBox || !haloBox) return Number.POSITIVE_INFINITY;
    return Math.max(
      Math.abs(haloBox.x - targetBox.x),
      Math.abs(haloBox.y - targetBox.y),
      Math.abs(haloBox.width - targetBox.width),
      Math.abs(haloBox.height - targetBox.height),
    );
  }).toBeLessThan(3);
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
    await expect.poll(() => readHint(harness)).toEqual({ schemaVersion: 1, status: 'acknowledged' });

    await popup.goto('about:blank');
    await openPopup(harness);
    await expect(popup.getByText('Get to know Privacy Guardrail')).toHaveCount(0);
    await expect(popup.getByRole('button', { name: 'Help: start Protect tour' })).toBeVisible();
  } finally {
    await harness.close();
  }
});

test('closing a fresh popup before acknowledgement preserves the invitation', async () => {
  const harness = await launchHarness();
  try {
    await harness.configure({ nerProvider: 'off', enabled: true });
    await seedHint(harness, 'new');
    const popup = await openPopup(harness);
    await expect(popup.getByText('Get to know Privacy Guardrail')).toBeVisible();

    await popup.goto('about:blank');
    await expect.poll(() => readHint(harness)).toEqual({ schemaVersion: 1, status: 'new' });

    await openPopup(harness);
    await expect(popup.getByText('Get to know Privacy Guardrail')).toBeVisible();
  } finally {
    await harness.close();
  }
});

test('Help starts on Protect and resolves every coachmark anchor from each other tab', async () => {
  const harness = await launchHarness();
  try {
    await harness.configure({ nerProvider: 'off', enabled: true });
    await seedHint(harness, 'existing');
    const popup = await openPopup(harness);
    const dialog = popup.getByRole('dialog');
    const anchors = [
      'onboarding-help',
      'paste-review',
      'replacement-mode',
      'local-ai-status',
      'detection-categories',
      'identity-vault',
      'tab-detect',
      'tab-test',
      'tab-settings',
      'assistive-disclaimer',
    ];

    for (const sourceTab of ['Detect', 'Test', 'Settings'] as const) {
      const source = popup.getByRole('button', { name: sourceTab, exact: true });
      await source.click();
      await expect(source).toHaveAttribute('aria-current', 'page');

      await popup.getByRole('button', { name: 'Help: start Protect tour' }).click();
      await expect(dialog).toContainText('Step 1 of 10');
      await expect(popup.getByRole('button', { name: 'Protect', exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(source).not.toHaveAttribute('aria-current', 'page');

      for (const [index, anchor] of anchors.entries()) {
        await expect(dialog).toContainText(`Step ${index + 1} of 10`);
        await expectHaloAtAnchor(popup, anchor);
        if (index < anchors.length - 1) await popup.getByRole('button', { name: 'Next' }).click();
      }

      await popup.getByRole('button', { name: 'End tour' }).click();
      await expect(dialog).toHaveCount(0);
    }
  } finally {
    await harness.close();
  }
});

test('tour traps document keyboard input, exits with Escape, and restores Help focus', async () => {
  const harness = await launchHarness();
  try {
    await harness.configure({ nerProvider: 'off', enabled: true });
    // Start tour must acknowledge the deterministic first-use record without
    // waiting for storage before opening the dialog.
    await seedHint(harness, 'new');
    const popup = await openPopup(harness);
    const help = popup.getByRole('button', { name: 'Help: start Protect tour' });
    await help.click();

    const dialog = popup.getByRole('dialog');
    await expect(dialog).toContainText('Step 1 of 10');
    await expect.poll(() => readHint(harness)).toEqual({ schemaVersion: 1, status: 'acknowledged' });
    await popup.getByRole('button', { name: 'Next' }).focus();
    await popup.keyboard.press('Tab');
    await expect(dialog).toBeFocused();
    await popup.keyboard.press('Shift+Tab');
    await expect(popup.getByRole('button', { name: 'Next' })).toBeFocused();
    await popup.locator('.tour-layer').click({ position: { x: 2, y: 2 } });
    await popup.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(help).toBeFocused();
    await help.click();
    await expect(dialog).toContainText('Step 1 of 10');
    await expect(popup.getByRole('button', { name: 'Protect', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(popup.getByRole('button', { name: 'Back' })).toBeDisabled();

    for (let step = 2; step <= 7; step += 1) {
      await popup.getByRole('button', { name: 'Next' }).click();
      await expect(dialog).toContainText(`Step ${step} of 10`);
    }

    for (const [step, tab] of [[7, 'Detect'], [8, 'Test'], [9, 'Settings']] as const) {
      await expect(dialog).toContainText(`Step ${step} of 10`);
      const target = popup.getByRole('button', { name: tab, exact: true });
      const halo = popup.locator('.target-halo');
      await expect(target).toBeVisible();
      await expect(halo).toBeVisible();
      await expect.poll(async () => {
        const [targetBox, haloBox] = await Promise.all([target.boundingBox(), halo.boundingBox()]);
        if (!targetBox || !haloBox) return Number.POSITIVE_INFINITY;
        return Math.max(
          Math.abs(haloBox.x - targetBox.x),
          Math.abs(haloBox.y - targetBox.y),
          Math.abs(haloBox.width - targetBox.width),
          Math.abs(haloBox.height - targetBox.height),
        );
      }).toBeLessThan(3);
      await expect(popup.getByRole('button', { name: 'Protect', exact: true })).toHaveAttribute('aria-current', 'page');
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
    await popup.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await expect(dialog.getByRole('button', { name: 'End tour' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Next' })).toBeVisible();
    await popup.evaluate(() => { document.documentElement.style.fontSize = ''; });
  } finally {
    await harness.close();
  }
});
