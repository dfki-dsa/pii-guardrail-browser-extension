import { positionCoachmark } from '../../src/popup/onboarding-position';

const shell = { left: 100, top: 50, width: 420, height: 600 };
const card = { width: 300, height: 140 };

describe('positionCoachmark', () => {
  test('uses preferred available placement and clamps horizontal coordinates', () => {
    const result = positionCoachmark(shell, { left: 105, top: 300, width: 20, height: 20 }, card, 'below');
    expect(result.placement).toBe('below');
    expect(result.left).toBe(12);
    expect(result.arrowLeft).toBeGreaterThanOrEqual(18);
    expect(result.targetCenterX).toBe(15);
    expect(result.targetCenterY).toBe(260);
  });

  test('flips below placement above when the target is at the bottom', () => {
    const result = positionCoachmark(shell, { left: 300, top: 590, width: 30, height: 20 }, card, 'below');
    expect(result.placement).toBe('above');
    expect(result.top).toBeLessThan(540);
  });

  test('falls back for missing, zero-sized, and oversized layouts', () => {
    expect(positionCoachmark(shell, null, card, 'above').placement).toBe('floating');
    expect(positionCoachmark(shell, { left: 200, top: 100, width: 0, height: 0 }, card, 'above').placement).toBe('floating');
    expect(positionCoachmark(shell, { left: 200, top: 100, width: 20, height: 20 }, { width: 500, height: 100 }, 'above').placement).toBe('floating');
  });
});
