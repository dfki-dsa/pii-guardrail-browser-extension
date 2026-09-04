import type { NerStatus, SystemCompatibilityStatus } from './message-types';

export type ChipReason =
  | 'composer-not-found'
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
  /**
   * True once this page could not find a message box at all — neither the one
   * the site adapter knows nor the target of the paste itself. Text either
   * went through unreviewed, or was reviewed and had nowhere to land. Cleared
   * again as soon as a lookup succeeds.
   *
   * Not raised for a page the extension is matching generically: protection
   * held there, and the popup says so quietly. Reserving this for a real
   * failure is what keeps it meaning one.
   */
  composerMissing?: boolean;
}

/**
 * Derive the single chip reason to display, or null when no degraded
 * protection state applies. The one-time critical modal owns the
 * `low-memory-protection` surface while it is still pending; suppressing
 * the chip in that window prevents duplicate contradictory messaging.
 */
export function deriveChipReason({
  status,
  nerStatus,
  composerMissing,
}: ChipReasonInputs): ChipReason | null {
  // Outranks every reason below, and is reported even when no system status
  // has arrived. Those describe detection running in a reduced mode; this one
  // means the extension is not attached to the page at all, so nothing was
  // reviewed. A chip about memory tiers would be beside the point.
  if (composerMissing) return 'composer-not-found';

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

export function chipReasonMessageForStatus(
  reason: ChipReason,
  status?: SystemCompatibilityStatus | null,
): ChipMessage {
  const message = chipReasonMessage(reason);
  const loadFailureMessage = status?.loadFailure?.message?.trim();
  if (reason !== 'model-failed' || !loadFailureMessage) return message;

  return {
    ...message,
    detail: `${loadFailureMessage} Pattern detection remains active. You can retry from Privacy Guardrail settings.`,
  };
}

export function chipReasonMessage(reason: ChipReason): ChipMessage {
  switch (reason) {
    case 'composer-not-found':
      return {
        title: 'Message box not recognized',
        detail: 'Privacy Guardrail cannot find this page’s message box, so text here is not reviewed and reviewed text may not be inserted. Reload the page — if that does not help, the site has changed and the extension needs an update.',
      };
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
        detail: 'Browser-reported memory is between 2 GB and 4 GB. Watch for slowdowns while Local AI is on.',
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
