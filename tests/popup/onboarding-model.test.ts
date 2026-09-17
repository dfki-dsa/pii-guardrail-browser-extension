import { get } from 'svelte/store';
import { createOnboardingModel } from '../../src/popup/onboarding-model';
import { onboardingSteps } from '../../src/popup/onboarding-content';

describe('onboarding model', () => {
  test('starts manually at step one, bounds navigation, and resets for replay', () => {
    const tour = createOnboardingModel();
    expect(get(tour.active)).toBe(false);
    tour.start();
    expect(get(tour.step)?.id).toBe('privacy');
    expect(get(tour.canGoBack)).toBe(false);
    tour.back();
    expect(get(tour.stepIndex)).toBe(0);
    onboardingSteps.forEach(() => tour.next());
    expect(get(tour.step)?.id).toBe('safety');
    expect(get(tour.canGoNext)).toBe(false);
    tour.end();
    expect(get(tour.active)).toBe(false);
    tour.start();
    expect(get(tour.step)?.id).toBe('privacy');
  });
});
