import { shouldShowCriticalLocalAiModal } from '../../src/content/critical-local-ai-modal-status';
import type { SystemCompatibilityStatus } from '../../src/shared/message-types';

const baseStatus: SystemCompatibilityStatus = {
  schemaVersion: 1,
  policyVersion: 1,
  checkedAt: 1,
  browserMemoryGb: 8,
  webGpu: 'available',
  tier: 'critical',
  recommendation: 'auto-disable-local-ai',
  notes: ['Critical browser-reported memory.'],
  localAiState: 'off-low-memory-auto',
  runtimeState: 'not-loaded',
  criticalModal: 'pending',
};

describe('shouldShowCriticalLocalAiModal', () => {
  test('shows only for pending critical low-memory auto-disable on supported content pages', () => {
    expect(shouldShowCriticalLocalAiModal(baseStatus)).toBe(true);
  });

  test.each([
    ['dismissed modal', { criticalModal: 'dismissed' as const }],
    ['warning tier', { tier: 'warning' as const, recommendation: 'warn' as const, browserMemoryGb: 12 }],
    ['ok tier', { tier: 'ok' as const, recommendation: 'none' as const, browserMemoryGb: 16 }],
    ['unknown tier', { tier: 'unknown' as const, recommendation: 'warn' as const, browserMemoryGb: undefined }],
    ['user-choice off', { localAiState: 'off-user-choice' as const }],
    ['load failure off', { localAiState: 'off-load-failure' as const }],
  ])('does not show for %s', (_name, patch) => {
    expect(shouldShowCriticalLocalAiModal({ ...baseStatus, ...patch })).toBe(false);
  });
});
