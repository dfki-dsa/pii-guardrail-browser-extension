import type { NerStatus, SystemCompatibilityStatus } from './message-types';

export type ChipReason =
  | 'low-memory-protection'
  | 'enabled-despite-low-memory'
  | 'pattern-only'
  | 'model-failed'
  | 'low-memory-warning'
  | 'unknown-memory'
  | 'running-on-cpu';

export interface ChipReasonInputs {
  status: SystemCompatibilityStatus | null | undefined;
  nerStatus?: NerStatus | null;
}

/**
 * Derive the single chip reason to display, or null when no degraded
 * protection state applies. The one-time critical modal owns the
 * `low-memory-protection` surface while it is still pending; suppressing
 * the chip in that window prevents duplicate contradictory messaging.
 */
export function deriveChipReason({ status, nerStatus }: ChipReasonInputs): ChipReason | null {
  if (!status) return null;

  if (status.localAiState === 'off-load-failure') return 'model-failed';

  if (status.localAiState === 'off-low-memory-auto' && status.tier === 'critical') {
    return status.criticalModal === 'pending' ? null : 'low-memory-protection';
  }

  if (status.localAiState === 'enabled-low-memory-override') return 'enabled-despite-low-memory';

  if (status.localAiState === 'off-user-choice') return 'pattern-only';

  if (status.localAiState === 'enabled' && status.tier === 'warning') return 'low-memory-warning';

  if (status.localAiState === 'enabled' && status.tier === 'unknown') return 'unknown-memory';

  if (
    nerStatus?.device === 'wasm'
    && nerStatus.state === 'ready'
    && status.localAiState === 'enabled'
  ) {
    return 'running-on-cpu';
  }

  return null;
}

export interface ChipMessage {
  title: string;
  detail: string;
}

export function chipReasonMessage(reason: ChipReason): ChipMessage {
  switch (reason) {
    case 'pattern-only':
      return {
        title: 'Pattern detection only',
        detail: 'Local AI detection is off. Names, organizations, locations, and context-only PII may be missed.',
      };
    case 'low-memory-protection':
      return {
        title: 'Low memory protection mode',
        detail: 'Local AI detection was turned off because browser-reported memory is critical. Pattern detection remains active.',
      };
    case 'enabled-despite-low-memory':
      return {
        title: 'Local AI enabled despite low memory',
        detail: 'Browser-reported memory is critical. Local AI detection may slow or freeze this browser.',
      };
    case 'model-failed':
      return {
        title: 'Local AI model failed to load',
        detail: 'Pattern detection remains active. You can retry from Privacy Guardrail settings.',
      };
    case 'low-memory-warning':
      return {
        title: 'Local AI may be resource-intensive',
        detail: 'Browser-reported memory is between 8 GB and 14 GB. Watch for slowdowns while Local AI is on.',
      };
    case 'unknown-memory':
      return {
        title: 'Compatibility uncertain',
        detail: 'Browser-reported memory is unavailable, so Local AI compatibility could not be fully assessed.',
      };
    case 'running-on-cpu':
      return {
        title: 'Local AI is running on CPU',
        detail: 'WebGPU was not used. Detection may be slower than usual.',
      };
  }
}
