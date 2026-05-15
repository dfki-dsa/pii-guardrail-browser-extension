import type { NerRuntimeState } from './message-types';
import {
  SYSTEM_COMPATIBILITY_POLICY_VERSION,
  decideSystemCompatibility,
  type BrowserMemoryTier,
  type PassiveSystemSignals,
  type WebGpuAvailability,
  type LocalAiRecommendation,
} from './system-compatibility-policy';

export const SYSTEM_CHECK_STORAGE_KEY = 'pg_system_check';
export const SYSTEM_CHECK_SCHEMA_VERSION = 1;

export type LocalAiProtectionState =
  | 'enabled'
  | 'off-user-choice'
  | 'off-low-memory-auto'
  | 'off-load-failure'
  | 'enabled-low-memory-override';

export interface SystemCheckResult {
  schemaVersion: number;
  policyVersion: number;
  checkedAt: number;
  browserMemoryGb?: number;
  webGpu: WebGpuAvailability;
  tier: BrowserMemoryTier;
  recommendation: LocalAiRecommendation;
  notes: string[];
  localAiState: LocalAiProtectionState;
  runtimeState: NerRuntimeState | 'unknown' | 'not-loaded';
  criticalModal: 'none' | 'pending' | 'dismissed';
  lowMemoryOverride: boolean;
  recommendationDeclinedAt?: number;
  loadFailure?: { message: string; at: number };
}

export function buildSystemCheckResult(
  signals: PassiveSystemSignals,
  now = Date.now(),
  previous?: SystemCheckResult | null,
): SystemCheckResult {
  const decision = decideSystemCompatibility(signals);
  return {
    schemaVersion: SYSTEM_CHECK_SCHEMA_VERSION,
    policyVersion: decision.policyVersion,
    checkedAt: now,
    browserMemoryGb: signals.browserMemoryGb,
    webGpu: signals.webGpu,
    tier: decision.tier,
    recommendation: decision.recommendation,
    notes: decision.notes,
    localAiState: previous?.localAiState ?? 'enabled',
    runtimeState: previous?.runtimeState ?? 'not-loaded',
    criticalModal: previous?.criticalModal ?? 'none',
    lowMemoryOverride: previous?.lowMemoryOverride ?? false,
    recommendationDeclinedAt: previous?.recommendationDeclinedAt,
    loadFailure: previous?.loadFailure,
  };
}

function isWebGpuAvailability(value: unknown): value is WebGpuAvailability {
  return value === 'available' || value === 'unavailable' || value === 'unknown';
}

function isLocalAiProtectionState(value: unknown): value is LocalAiProtectionState {
  return value === 'enabled'
    || value === 'off-user-choice'
    || value === 'off-low-memory-auto'
    || value === 'off-load-failure'
    || value === 'enabled-low-memory-override';
}

function isRuntimeState(value: unknown): value is SystemCheckResult['runtimeState'] {
  return value === 'idle'
    || value === 'unavailable'
    || value === 'loading'
    || value === 'ready'
    || value === 'failed'
    || value === 'unknown'
    || value === 'not-loaded';
}

export function normalizeSystemCheckResult(raw: unknown): SystemCheckResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<SystemCheckResult>;
  if (candidate.schemaVersion !== SYSTEM_CHECK_SCHEMA_VERSION) return null;
  if (candidate.policyVersion !== SYSTEM_COMPATIBILITY_POLICY_VERSION) return null;
  if (!isWebGpuAvailability(candidate.webGpu)) return null;

  const rebuilt = buildSystemCheckResult(
    {
      browserMemoryGb: typeof candidate.browserMemoryGb === 'number' ? candidate.browserMemoryGb : undefined,
      webGpu: candidate.webGpu,
    },
    typeof candidate.checkedAt === 'number' ? candidate.checkedAt : Date.now(),
    candidate as SystemCheckResult,
  );

  return {
    ...rebuilt,
    localAiState: isLocalAiProtectionState(candidate.localAiState) ? candidate.localAiState : 'enabled',
    runtimeState: isRuntimeState(candidate.runtimeState) ? candidate.runtimeState : 'not-loaded',
    criticalModal: candidate.criticalModal === 'pending' || candidate.criticalModal === 'dismissed'
      ? candidate.criticalModal
      : 'none',
    lowMemoryOverride: candidate.lowMemoryOverride === true,
    recommendationDeclinedAt: typeof candidate.recommendationDeclinedAt === 'number'
      ? candidate.recommendationDeclinedAt
      : undefined,
    loadFailure: candidate.loadFailure && typeof candidate.loadFailure === 'object'
      && typeof candidate.loadFailure.message === 'string'
      && typeof candidate.loadFailure.at === 'number'
      ? candidate.loadFailure
      : undefined,
  };
}

export async function loadSystemCheckResult(): Promise<SystemCheckResult | null> {
  const result = await chrome.storage.local.get(SYSTEM_CHECK_STORAGE_KEY);
  return normalizeSystemCheckResult(result[SYSTEM_CHECK_STORAGE_KEY]);
}

export async function saveSystemCheckResult(result: SystemCheckResult): Promise<void> {
  await chrome.storage.local.set({ [SYSTEM_CHECK_STORAGE_KEY]: normalizeSystemCheckResult(result) ?? result });
}

export async function markCriticalModalDismissed(): Promise<SystemCheckResult | null> {
  const current = await loadSystemCheckResult();
  if (!current) return null;
  const next: SystemCheckResult = { ...current, criticalModal: 'dismissed' };
  await saveSystemCheckResult(next);
  return next;
}

export async function recordLowMemoryOverride(): Promise<SystemCheckResult | null> {
  const current = await loadSystemCheckResult();
  if (!current) return null;
  const next: SystemCheckResult = {
    ...current,
    localAiState: 'enabled-low-memory-override',
    lowMemoryOverride: true,
    loadFailure: undefined,
  };
  await saveSystemCheckResult(next);
  return next;
}

export async function recordLocalAiEnabled(): Promise<SystemCheckResult | null> {
  const current = await loadSystemCheckResult();
  if (!current) return null;
  const next: SystemCheckResult = {
    ...current,
    localAiState: 'enabled',
    loadFailure: undefined,
  };
  await saveSystemCheckResult(next);
  return next;
}

export async function recordRuntimeState(
  runtimeState: SystemCheckResult['runtimeState'],
): Promise<SystemCheckResult | null> {
  const current = await loadSystemCheckResult();
  if (!current) return null;
  if (current.runtimeState === runtimeState) return current;
  const next: SystemCheckResult = { ...current, runtimeState };
  await saveSystemCheckResult(next);
  return next;
}

export async function recordLowMemoryAutoDisable(result: SystemCheckResult): Promise<SystemCheckResult> {
  const next: SystemCheckResult = {
    ...result,
    localAiState: 'off-low-memory-auto',
    criticalModal: 'pending',
    lowMemoryOverride: false,
    recommendationDeclinedAt: undefined,
  };
  await saveSystemCheckResult(next);
  return next;
}

export async function recordUserLocalAiOff(result: SystemCheckResult): Promise<SystemCheckResult> {
  const next: SystemCheckResult = {
    ...result,
    localAiState: 'off-user-choice',
  };
  await saveSystemCheckResult(next);
  return next;
}

export async function recordRecommendationDeclined(now = Date.now()): Promise<SystemCheckResult | null> {
  const current = await loadSystemCheckResult();
  if (!current) return null;
  const next: SystemCheckResult = { ...current, recommendationDeclinedAt: now };
  await saveSystemCheckResult(next);
  return next;
}

export async function recordLoadFailure(message: string, now = Date.now()): Promise<SystemCheckResult | null> {
  const current = await loadSystemCheckResult();
  if (!current) return null;
  const next: SystemCheckResult = {
    ...current,
    localAiState: 'off-load-failure',
    runtimeState: 'failed',
    loadFailure: { message, at: now },
  };
  await saveSystemCheckResult(next);
  return next;
}
