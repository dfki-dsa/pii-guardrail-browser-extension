import { shouldAutoWarmLocalAi } from '../../src/shared/local-ai-warmup-gate';
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

describe('shouldAutoWarmLocalAi', () => {
  test('warms on OK tier with Local AI enabled and WebGPU available', () => {
    expect(shouldAutoWarmLocalAi(baseSettings, baseStatus)).toBe(true);
  });

  test('does not warm when Local AI is off in settings', () => {
    expect(shouldAutoWarmLocalAi({ ...baseSettings, nerProvider: 'off' }, baseStatus)).toBe(false);
  });

  test('does not warm on warning tier', () => {
    expect(shouldAutoWarmLocalAi(baseSettings, { ...baseStatus, tier: 'warning', browserMemoryGb: 12 })).toBe(false);
  });

  test('does not warm on critical tier', () => {
    expect(shouldAutoWarmLocalAi(baseSettings, { ...baseStatus, tier: 'critical', browserMemoryGb: 8 })).toBe(false);
  });

  test('does not warm on unknown memory', () => {
    expect(shouldAutoWarmLocalAi(baseSettings, { ...baseStatus, tier: 'unknown', browserMemoryGb: undefined })).toBe(false);
  });

  test('does not warm on enabled-low-memory-override', () => {
    expect(
      shouldAutoWarmLocalAi(baseSettings, {
        ...baseStatus,
        tier: 'critical',
        browserMemoryGb: 8,
        localAiState: 'enabled-low-memory-override',
      }),
    ).toBe(false);
  });

  test('does not warm on off-low-memory-auto', () => {
    expect(
      shouldAutoWarmLocalAi(baseSettings, { ...baseStatus, localAiState: 'off-low-memory-auto' }),
    ).toBe(false);
  });

  test('does not warm when WebGPU is unavailable', () => {
    expect(shouldAutoWarmLocalAi(baseSettings, { ...baseStatus, webGpu: 'unavailable' })).toBe(false);
  });

  test('does not warm when runtime already on wasm fallback', () => {
    const ner: NerStatus = { mode: 'transformers', state: 'ready', device: 'wasm' };
    expect(shouldAutoWarmLocalAi(baseSettings, baseStatus, ner)).toBe(false);
  });

  test('does not warm without settings or status', () => {
    expect(shouldAutoWarmLocalAi(null, baseStatus)).toBe(false);
    expect(shouldAutoWarmLocalAi(baseSettings, null)).toBe(false);
  });
});
