import { deriveResourceSummary } from '../../src/shared/popup-resource-summary';
import type { NerStatus, Settings, SystemCompatibilityStatus } from '../../src/shared/message-types';
import { DEFAULT_SETTINGS } from '../../src/shared/constants';

const baseSettings: Settings = {
  ...DEFAULT_SETTINGS,
  debug: false,
  contextBoost: 0,
  contextWindow: 0,
  curatedUrls: [],
  allowlist: [],
  blocklist: [],
};

const baseStatus: SystemCompatibilityStatus = {
  schemaVersion: 1,
  policyVersion: 1,
  checkedAt: 0,
  browserMemoryGb: 32,
  webGpu: 'available',
  tier: 'ok',
  recommendation: 'none',
  notes: [],
  localAiState: 'enabled',
  runtimeState: 'not-loaded',
  criticalModal: 'none',
};

describe('deriveResourceSummary', () => {
  test('stays quiet on OK tier with Local AI enabled', () => {
    expect(deriveResourceSummary(baseSettings, baseStatus)).toBeNull();
  });

  test('returns nothing without inputs', () => {
    expect(deriveResourceSummary(null, baseStatus)).toBeNull();
    expect(deriveResourceSummary(baseSettings, null)).toBeNull();
  });

  test('uses browser-reported memory wording for warning tier', () => {
    const result = deriveResourceSummary(baseSettings, { ...baseStatus, tier: 'warning', browserMemoryGb: 12 });
    expect(result?.tone).toBe('warning');
    expect(result?.detail).toMatch(/browser-reported memory is 12 GB/i);
  });

  test('flags unknown memory as warning', () => {
    const result = deriveResourceSummary(baseSettings, { ...baseStatus, tier: 'unknown', browserMemoryGb: undefined });
    expect(result?.tone).toBe('warning');
    expect(result?.title).toMatch(/uncertain/i);
  });

  test('shows critical low-memory protection mode wording', () => {
    const result = deriveResourceSummary(baseSettings, {
      ...baseStatus,
      tier: 'critical',
      browserMemoryGb: 8,
      localAiState: 'off-low-memory-auto',
    });
    expect(result?.tone).toBe('critical');
    expect(result?.detail).toMatch(/8 GB/);
    expect(result?.detail).toMatch(/critical/i);
  });

  test('shows critical override wording', () => {
    const result = deriveResourceSummary(baseSettings, {
      ...baseStatus,
      tier: 'critical',
      browserMemoryGb: 8,
      localAiState: 'enabled-low-memory-override',
    });
    expect(result?.tone).toBe('critical');
    expect(result?.title).toMatch(/enabled despite low memory/i);
  });

  test('shows Local AI off info when settings are off', () => {
    const result = deriveResourceSummary({ ...baseSettings, nerProvider: 'off' }, baseStatus);
    expect(result?.tone).toBe('info');
    expect(result?.title).toMatch(/local ai detection off/i);
  });

  test('shows CPU fallback warning when runtime reports wasm', () => {
    const ner: NerStatus = { mode: 'transformers', state: 'ready', device: 'wasm' };
    const result = deriveResourceSummary(baseSettings, baseStatus, ner);
    expect(result?.tone).toBe('warning');
    expect(result?.title).toMatch(/running on cpu/i);
  });

  test('off-load-failure surfaces critical failure copy', () => {
    const result = deriveResourceSummary(baseSettings, { ...baseStatus, localAiState: 'off-load-failure' });
    expect(result?.tone).toBe('critical');
    expect(result?.title).toMatch(/failed to load/i);
  });
});
