import { derived, get, writable, type Readable } from 'svelte/store';
import { onboardingSteps, type OnboardingStep } from './onboarding-content';

export type OnboardingModel = {
  active: Readable<boolean>;
  stepIndex: Readable<number>;
  step: Readable<OnboardingStep | null>;
  canGoBack: Readable<boolean>;
  canGoNext: Readable<boolean>;
  start: () => void;
  back: () => void;
  next: () => void;
  end: () => void;
};

/** In-memory navigation only: closing the popup intentionally discards progress. */
export function createOnboardingModel(steps = onboardingSteps): OnboardingModel {
  const active = writable(false);
  const stepIndex = writable(0);
  const step = derived([active, stepIndex], ([$active, $stepIndex]) => $active ? steps[$stepIndex] ?? null : null);
  const canGoBack = derived([active, stepIndex], ([$active, $stepIndex]) => $active && $stepIndex > 0);
  const canGoNext = derived([active, stepIndex], ([$active, $stepIndex]) => $active && $stepIndex < steps.length - 1);

  return {
    active,
    stepIndex,
    step,
    canGoBack,
    canGoNext,
    start: () => { stepIndex.set(0); active.set(true); },
    back: () => stepIndex.update((index) => Math.max(0, index - 1)),
    next: () => stepIndex.update((index) => Math.min(steps.length - 1, index + 1)),
    end: () => { active.set(false); stepIndex.set(0); },
  };
}
