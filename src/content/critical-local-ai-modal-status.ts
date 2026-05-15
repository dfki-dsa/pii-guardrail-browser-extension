import type { SystemCompatibilityStatus } from '../shared/message-types';

export function shouldShowCriticalLocalAiModal(status: SystemCompatibilityStatus | null | undefined): boolean {
  return status?.criticalModal === 'pending'
    && status.localAiState === 'off-low-memory-auto'
    && status.tier === 'critical';
}
