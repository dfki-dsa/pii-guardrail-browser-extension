import {
  chipReasonMessage,
  deriveChipReason,
  type ChipReason,
} from '../../src/shared/page-status-chip-reason';
import type { NerStatus, SystemCompatibilityStatus } from '../../src/shared/message-types';

function status(overrides: Partial<SystemCompatibilityStatus> = {}): SystemCompatibilityStatus {
  return {
    schemaVersion: 1,
    policyVersion: 1,
    checkedAt: 1,
    browserMemoryGb: 16,
    webGpu: 'available',
    tier: 'ok',
    recommendation: 'none',
    notes: [],
    localAiState: 'enabled',
    runtimeState: 'not-loaded',
    criticalModal: 'none',
    ...overrides,
  };
}

describe('deriveChipReason', () => {
  test('returns null when no status is available', () => {
    expect(deriveChipReason({ status: null })).toBeNull();
    expect(deriveChipReason({ status: undefined })).toBeNull();
  });

  test('returns null on a healthy OK system with Local AI enabled', () => {
    expect(deriveChipReason({ status: status() })).toBeNull();
  });

  test('returns model-failed for off-load-failure regardless of tier', () => {
    expect(
      deriveChipReason({
        status: status({ localAiState: 'off-load-failure', tier: 'ok' }),
      }),
    ).toBe('model-failed');
  });

  test('returns low-memory-protection only after the critical modal is dismissed', () => {
    const auto = status({
      tier: 'critical',
      browserMemoryGb: 8,
      recommendation: 'auto-disable-local-ai',
      localAiState: 'off-low-memory-auto',
    });
    expect(deriveChipReason({ status: { ...auto, criticalModal: 'pending' } })).toBeNull();
    expect(deriveChipReason({ status: { ...auto, criticalModal: 'dismissed' } })).toBe(
      'low-memory-protection',
    );
  });

  test('returns enabled-despite-low-memory for an explicit critical override', () => {
    expect(
      deriveChipReason({
        status: status({
          tier: 'critical',
          browserMemoryGb: 8,
          localAiState: 'enabled-low-memory-override',
          criticalModal: 'dismissed',
        }),
      }),
    ).toBe('enabled-despite-low-memory');
  });

  test('returns pattern-only when the user turned Local AI off explicitly', () => {
    expect(
      deriveChipReason({ status: status({ localAiState: 'off-user-choice' }) }),
    ).toBe('pattern-only');
  });

  test('returns low-memory-warning on warning tier with Local AI enabled', () => {
    expect(
      deriveChipReason({
        status: status({ tier: 'warning', browserMemoryGb: 12, recommendation: 'warn' }),
      }),
    ).toBe('low-memory-warning');
  });

  test('returns unknown-memory on unknown tier with Local AI enabled', () => {
    expect(
      deriveChipReason({
        status: status({
          tier: 'unknown',
          browserMemoryGb: undefined,
          recommendation: 'warn',
        }),
      }),
    ).toBe('unknown-memory');
  });

  test('returns running-on-cpu when the model is loaded on WASM/CPU on an OK system', () => {
    const ner: NerStatus = { mode: 'transformers', state: 'ready', device: 'wasm' };
    expect(
      deriveChipReason({
        status: status({ runtimeState: 'ready' }),
        nerStatus: ner,
      }),
    ).toBe('running-on-cpu');
  });

  test('does not show running-on-cpu when Local AI is off (defensive)', () => {
    const ner: NerStatus = { mode: 'transformers', state: 'ready', device: 'wasm' };
    expect(
      deriveChipReason({
        status: status({ localAiState: 'off-user-choice' }),
        nerStatus: ner,
      }),
    ).toBe('pattern-only');
  });
});

describe('chipReasonMessage', () => {
  const required: Record<ChipReason, RegExp> = {
    'pattern-only': /pattern detection only/i,
    'low-memory-protection': /low memory protection/i,
    'enabled-despite-low-memory': /enabled despite low memory/i,
    'model-failed': /failed to load/i,
    'low-memory-warning': /resource-intensive|may be resource/i,
    'unknown-memory': /uncertain|unavailable/i,
    'running-on-cpu': /running on cpu/i,
  };

  for (const [reason, pattern] of Object.entries(required) as [ChipReason, RegExp][]) {
    test(`${reason} message uses its differentiating phrase`, () => {
      const message = chipReasonMessage(reason);
      const combined = `${message.title} ${message.detail}`;
      expect(combined).toMatch(pattern);
    });
  }

  test('pattern-only details name what may be missed without Local AI', () => {
    const message = chipReasonMessage('pattern-only');
    expect(message.detail).toMatch(/names/i);
    expect(message.detail).toMatch(/organizations/i);
    expect(message.detail).toMatch(/locations/i);
  });
});
