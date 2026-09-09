import { PACKAGE_ROWS, TOTAL_DOWNLOAD_MB } from '../../src/shared/onboarding-facts';

describe('onboarding facts', () => {
  test('the stated total is consistent with its own breakdown', () => {
    const summed = PACKAGE_ROWS.reduce((total, row) => total + row.mb, 0);
    expect(Math.abs(summed - TOTAL_DOWNLOAD_MB)).toBeLessThan(10);
  });

  test('the model dominates, largest first', () => {
    // StepSize scales its bars against PACKAGE_ROWS[0] and the copy claims the
    // model is most of the download. Both break silently if the order changes.
    const sizes = PACKAGE_ROWS.map((row) => row.mb);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(PACKAGE_ROWS[0].label).toBe('Detection model');
    expect(PACKAGE_ROWS[0].mb / TOTAL_DOWNLOAD_MB).toBeGreaterThan(0.6);
  });
});
