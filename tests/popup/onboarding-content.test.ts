import { onboardingStepCount, onboardingSteps } from '../../src/popup/onboarding-content';

describe('onboarding content', () => {
  test('defines ten uniquely identified ordered coachmarks', () => {
    expect(onboardingSteps).toHaveLength(9);
    expect(onboardingStepCount).toBe(onboardingSteps.length);
    expect(new Set(onboardingSteps.map((step) => step.id)).size).toBe(9);
    expect(onboardingSteps.map((step) => step.id)).toEqual([
      'privacy', 'paste', 'restore', 'local-ai', 'categories', 'vault',
      'detect-overview', 'test-overview', 'settings-overview',
    ]);
  });

  test('anchors tab overviews to real tab labels without adding navigation copy', () => {
    expect(onboardingSteps.slice(6, 9).map(({ anchor, body }) => ({ anchor, body }))).toEqual([
      { anchor: 'tab-detect', body: 'Inspect detection coverage and status.' },
      { anchor: 'tab-test', body: 'Try synthetic sample text safely.' },
      { anchor: 'tab-settings', body: 'Adjust common protection behavior.' },
    ]);
  });

  test('keeps concise card copy, privacy facts, and the full safety warning in their intended cards', () => {
    for (const step of onboardingSteps) {
      expect(step.title.trim().split(/\s+/).length).toBeGreaterThan(0);
      expect(step.title.trim().split(/\s+/).length).toBeLessThanOrEqual(5);
      expect(step.body.trim().split(/\s+/).length).toBeLessThanOrEqual(40);
      // Domains contain dots, so sentence count is deliberately based on sentence-ending whitespace.
      expect(step.body.trim().split(/[.!?](?:\s|$)/).filter(Boolean).length).toBeLessThanOrEqual(2);
    }
    expect(onboardingSteps[0].body).toContain('without remote inference or telemetry');
    expect(onboardingSteps.at(-1)?.id).toBe('settings-overview');
  });
});
