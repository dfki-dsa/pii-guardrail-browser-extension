export type OnboardingPlacement = 'above' | 'below';

export type OnboardingStep = {
  id: string;
  anchor: string;
  fallbackAnchor: string;
  title: string;
  body: string;
  placement: OnboardingPlacement;
};

/** Ordered, replayable Protect tour content. These IDs are intentionally stable. */
export const onboardingSteps: readonly OnboardingStep[] = [
  {
    id: 'privacy',
    anchor: 'onboarding-help',
    fallbackAnchor: 'protection-status',
    title: 'Local and private',
    body: 'Privacy Guardrail checks text locally without remote inference or telemetry. You choose what to send to the chat provider.',
    placement: 'above',
  },
  {
    id: 'paste',
    anchor: 'paste-review',
    fallbackAnchor: 'protection-status',
    title: 'Review before pasting',
    body: 'While protection is on, pasting into a supported chat opens a review on that page if any actionable sensitive data is detected. Keep or ignore each suggestion, then choose Replace & paste.',
    placement: 'below',
  },
  {
    id: 'restore',
    anchor: 'replacement-mode',
    fallbackAnchor: 'identity-vault',
    title: 'Replace and restore',
    body: 'Replace sensitive values with placeholders such as [EMAIL_1]. Known originals can be restored locally in supported replies and copied text.',
    placement: 'above',
  },
  {
    id: 'local-ai',
    anchor: 'local-ai-status',
    fallbackAnchor: 'protection-status',
    title: 'Local AI and patterns',
    body: 'Local AI helps spot names and other free text on your device. When it is unavailable, pattern detection still checks structured values such as emails.',
    placement: 'below',
  },
  {
    id: 'categories',
    anchor: 'detection-categories',
    fallbackAnchor: 'categories-heading',
    title: 'Choose what to detect',
    body: 'Choose which categories to detect. More settings includes sensitivity, allowlist and blocklist controls.',
    placement: 'below',
  },
  {
    id: 'vault',
    anchor: 'identity-vault',
    fallbackAnchor: 'manage-vault',
    title: 'Your local vault',
    body: 'The identity vault keeps consistent replacements and can store sensitive originals on this device. Manage vault lets you review or clear them.',
    placement: 'above',
  },
  {
    id: 'detect-overview',
    anchor: 'tab-detect',
    fallbackAnchor: 'tab-navigation',
    title: 'Detect',
    body: 'Inspect detection coverage and status.',
    placement: 'below',
  },
  {
    id: 'test-overview',
    anchor: 'tab-test',
    fallbackAnchor: 'tab-navigation',
    title: 'Test',
    body: 'Try synthetic sample text safely.',
    placement: 'below',
  },
  {
    id: 'settings-overview',
    anchor: 'tab-settings',
    fallbackAnchor: 'tab-navigation',
    title: 'Settings',
    body: 'Adjust common protection behavior.',
    placement: 'below',
  },
] as const;

export const onboardingStepCount = onboardingSteps.length;
