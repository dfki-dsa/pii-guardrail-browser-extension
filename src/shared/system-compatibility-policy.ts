export const SYSTEM_COMPATIBILITY_POLICY_VERSION = 1;

export type BrowserMemoryTier = 'critical' | 'warning' | 'ok' | 'unknown';
export type WebGpuAvailability = 'available' | 'unavailable' | 'unknown';
export type LocalAiRecommendation = 'auto-disable-local-ai' | 'warn' | 'none';

export interface PassiveSystemSignals {
  /** Approximate browser-reported memory in GB (navigator.deviceMemory). */
  browserMemoryGb?: number;
  webGpu: WebGpuAvailability;
}

export interface SystemCompatibilityDecision {
  policyVersion: number;
  tier: BrowserMemoryTier;
  recommendation: LocalAiRecommendation;
  notes: string[];
}

export function classifyBrowserMemory(browserMemoryGb?: number): BrowserMemoryTier {
  if (typeof browserMemoryGb !== 'number' || !Number.isFinite(browserMemoryGb) || browserMemoryGb <= 0) {
    return 'unknown';
  }
  if (browserMemoryGb <= 8) return 'critical';
  if (browserMemoryGb <= 14) return 'warning';
  return 'ok';
}

export function decideSystemCompatibility(signals: PassiveSystemSignals): SystemCompatibilityDecision {
  const tier = classifyBrowserMemory(signals.browserMemoryGb);
  const notes: string[] = [];

  if (tier === 'critical') {
    notes.push('Browser-reported memory is 8 GB or less. Local AI detection may exhaust resources on this system.');
  } else if (tier === 'warning') {
    notes.push('Browser-reported memory is greater than 8 GB and up to 14 GB. Local AI detection may be resource-intensive.');
  } else if (tier === 'unknown') {
    notes.push('Browser-reported memory is unavailable, so compatibility could not be fully assessed.');
  } else {
    notes.push('Browser-reported memory is above 14 GB. No resource concern is known.');
  }

  if (signals.webGpu === 'unavailable') {
    notes.push('Passive WebGPU availability was not detected; Local AI may use slower CPU/WASM execution if loaded.');
  } else if (signals.webGpu === 'unknown') {
    notes.push('Passive WebGPU availability could not be determined.');
  }

  return {
    policyVersion: SYSTEM_COMPATIBILITY_POLICY_VERSION,
    tier,
    recommendation: tier === 'critical' ? 'auto-disable-local-ai' : tier === 'ok' ? 'none' : 'warn',
    notes,
  };
}
