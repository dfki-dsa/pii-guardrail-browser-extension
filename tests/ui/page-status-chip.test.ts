/** @jest-environment jsdom */

import { PageStatusChip } from '../../src/ui/page-status-chip/page-status-chip';

function getRoot(chip: PageStatusChip): HTMLElement | null | undefined {
  return document.getElementById('pg-page-status-chip-host')?.shadowRoot?.querySelector('.pg-chip') as HTMLElement | null;
}

describe('PageStatusChip', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.sessionStorage.clear();
  });

  test('does not mount when reason is null', () => {
    const chip = new PageStatusChip('dark');
    chip.update(null);
    expect(chip.isMounted()).toBe(false);
    expect(document.getElementById('pg-page-status-chip-host')).toBeNull();
  });

  test('mounts and renders pattern-only copy', () => {
    const chip = new PageStatusChip('dark');
    chip.update('pattern-only');
    expect(chip.isMounted()).toBe(true);
    const root = getRoot(chip);
    expect(root?.getAttribute('data-reason')).toBe('pattern-only');
    expect(root?.textContent).toMatch(/Pattern detection only/i);
  });

  test('renders distinct copy for each degraded reason', () => {
    const cases: [Parameters<PageStatusChip['update']>[0], RegExp][] = [
      ['low-memory-protection', /Low memory protection/i],
      ['enabled-despite-low-memory', /enabled despite low memory/i],
      ['model-failed', /failed to load/i],
      ['low-memory-warning', /resource-intensive/i],
      ['unknown-memory', /uncertain|unavailable/i],
      ['running-on-cpu', /running on CPU/i],
    ];
    for (const [reason, pattern] of cases) {
      document.body.innerHTML = '';
      window.sessionStorage.clear();
      const chip = new PageStatusChip('light');
      chip.update(reason);
      const root = getRoot(chip);
      expect(root?.textContent).toMatch(pattern);
    }
  });

  test('updating to null removes the chip', () => {
    const chip = new PageStatusChip('dark');
    chip.update('pattern-only');
    expect(chip.isMounted()).toBe(true);
    chip.update(null);
    expect(chip.isMounted()).toBe(false);
    expect(document.getElementById('pg-page-status-chip-host')).toBeNull();
  });

  test('minimize toggle hides the detail and exposes session-local state', () => {
    const chip = new PageStatusChip('dark');
    chip.update('pattern-only');
    const toggle = document.getElementById('pg-page-status-chip-host')
      ?.shadowRoot?.querySelector('[data-action="toggle"]') as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    toggle.click();
    expect(chip.isMinimized()).toBe(true);
    expect(window.sessionStorage.getItem('pg_page_status_chip_minimized')).toBe('1');
    const root = getRoot(chip);
    expect(root?.getAttribute('data-minimized')).toBe('true');
  });

  test('a new chip honors session-stored minimize state', () => {
    window.sessionStorage.setItem('pg_page_status_chip_minimized', '1');
    const chip = new PageStatusChip('dark');
    chip.update('low-memory-warning');
    expect(chip.isMinimized()).toBe(true);
    const root = getRoot(chip);
    expect(root?.getAttribute('data-minimized')).toBe('true');
  });

  test('clearing the chip does not permanently dismiss it — next reason re-mounts', () => {
    const chip = new PageStatusChip('dark');
    chip.update('pattern-only');
    chip.update(null);
    chip.update('model-failed');
    expect(chip.isMounted()).toBe(true);
    expect(getRoot(chip)?.getAttribute('data-reason')).toBe('model-failed');
  });

  test('changing reason re-renders without unmounting twice', () => {
    const chip = new PageStatusChip('dark');
    chip.update('pattern-only');
    const firstHost = document.getElementById('pg-page-status-chip-host');
    chip.update('low-memory-warning');
    const secondHost = document.getElementById('pg-page-status-chip-host');
    expect(firstHost).toBe(secondHost);
    expect(getRoot(chip)?.textContent).toMatch(/resource-intensive/i);
  });

  test('construction performs no network or model probe — DOM stays clean until update', () => {
    new PageStatusChip('dark');
    expect(document.getElementById('pg-page-status-chip-host')).toBeNull();
  });
});
