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
      detail: 'Pattern detection remains active. Retry from Local AI settings.',
    };
  }

  if (status.localAiState === 'off-low-memory-auto') {
    return {
      tone: 'critical',
      title: 'Low memory protection mode',
      detail: `Local AI is off because browser-reported memory is ${memoryWording(status)} (critical). Pattern detection remains active.`,
    };
  }

  if (status.localAiState === 'enabled-low-memory-override') {
    return {
      tone: 'critical',
      title: 'Local AI enabled despite low memory',
      detail: `Browser-reported memory is ${memoryWording(status)} (critical). Local AI may slow or freeze this browser.`,
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
