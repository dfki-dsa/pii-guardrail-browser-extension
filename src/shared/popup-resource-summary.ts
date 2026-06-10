import type { NerStatus, Settings, SystemCompatibilityStatus } from './message-types';

export type ResourceSummaryTone = 'ok' | 'warning' | 'critical' | 'info' | 'muted';

export interface ResourceSummary {
  tone: ResourceSummaryTone;
  title: string;
  detail: string;
}

/**
 * Derive the popup's compact Local AI resource summary from cached
 * compatibility storage, settings, and (optional) runtime NER status.
 *
 * Returns null on OK systems with Local AI enabled and no CPU/WASM
 * fallback — those systems should stay quiet in the popup.
 */
export function deriveResourceSummary(
  settings: Settings | null,
  status: SystemCompatibilityStatus | null,
  nerStatus?: NerStatus | null,
): ResourceSummary | null {
  if (!settings || !status) return null;

  if (status.localAiState === 'off-load-failure') {
    return {
      tone: 'critical',
      title: 'Local AI failed to load',
      detail: 'Pattern detection remains active. Open System Compatibility in Settings to see the error and retry.',
    };
  }

  if (status.localAiState === 'off-low-memory-auto') {
    return {
      tone: 'critical',
      title: 'Low memory — local inference disabled',
      detail: `Browser-reported memory is ${memoryWording(status)} (below the safe threshold). Local AI is off to protect browser stability. Pattern detection remains active. You can override this in System Compatibility settings.`,
    };
  }

  if (status.localAiState === 'enabled-low-memory-override') {
    return {
      tone: 'critical',
      title: 'Local AI enabled despite low memory',
      detail: `Browser-reported memory is ${memoryWording(status)} (below the safe threshold). Keeping Local AI on may slow or freeze this browser. Turn it off in System Compatibility settings if you notice problems.`,
    };
  }

  if (settings.nerProvider === 'off' || status.localAiState === 'off-user-choice') {
    return {
      tone: 'info',
      title: 'Local AI detection off',
      detail: 'Pattern detection remains active. Names, organizations, locations, and context-only PII may be missed.',
    };
  }

  if (nerStatus?.state === 'ready' && nerStatus.device === 'wasm') {
    return {
      tone: 'warning',
      title: 'Local AI is running on CPU',
      detail: 'WebGPU was not used. Detection may be slower than usual.',
    };
  }

  if (status.tier === 'warning') {
    return {
      tone: 'warning',
      title: 'Local AI may be resource-intensive',
      detail: `Browser-reported memory is ${memoryWording(status)} (between 8 GB and 14 GB). Watch for slowdowns while Local AI is on.`,
    };
  }

  if (status.tier === 'unknown') {
    return {
      tone: 'warning',
      title: 'Compatibility uncertain',
      detail: 'Browser-reported memory is unavailable, so Local AI compatibility could not be fully assessed.',
    };
  }

  // OK tier with Local AI enabled and no fallback — stay quiet.
  return null;
}

function memoryWording(status: SystemCompatibilityStatus): string {
  return typeof status.browserMemoryGb === 'number'
    ? `${status.browserMemoryGb} GB`
    : 'unavailable';
}
