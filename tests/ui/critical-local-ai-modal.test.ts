/** @jest-environment jsdom */

import { CriticalLocalAiModal } from '../../src/ui/critical-local-ai-modal/critical-local-ai-modal';

describe('CriticalLocalAiModal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('shows low-memory auto-disable copy and pattern-only tradeoff', () => {
    const modal = new CriticalLocalAiModal('dark', {
      onDismiss: jest.fn(),
      onOpenSettings: jest.fn(),
    });

    modal.show();

    expect(modal.isMounted()).toBe(true);
    const text = document.getElementById('pg-critical-local-ai-modal-host')?.shadowRoot?.textContent;
    expect(text).toContain('Local AI detection is off');
    expect(text).toContain('browser-reported memory');
    expect(text).toContain('Pattern detection remains active');
    expect(text).toContain('Names, organizations, locations, and context-only PII may be missed');
  });

  test('dismisses once and persists through callback', async () => {
    const onDismiss = jest.fn().mockResolvedValue(undefined);
    const modal = new CriticalLocalAiModal('light', {
      onDismiss,
      onOpenSettings: jest.fn(),
    });

    modal.show();
    await modal.dismiss();
    await modal.dismiss();

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(modal.isMounted()).toBe(false);
  });

  test('settings action opens settings then persists dismissal', async () => {
    const onOpenSettings = jest.fn().mockResolvedValue(undefined);
    const onDismiss = jest.fn().mockResolvedValue(undefined);
    const modal = new CriticalLocalAiModal('dark', { onDismiss, onOpenSettings });

    modal.show();
    await modal.openSettings();

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(modal.isMounted()).toBe(false);
  });
});
