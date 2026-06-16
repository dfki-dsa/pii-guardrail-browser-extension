/**
 * Release-readiness invariants for Local AI degraded/failure behavior.
 *
 * Tracks docs/issues/public-beta-launch/12-local-ai-release-readiness-validation.md.
 * This file composes the already-implemented helpers from the
 * system-compatibility-local-ai-resource-guard slice set and asserts the
 * release-blocking invariants in one place. It deliberately does not
 * re-test runtime wiring already covered by:
 *
 *   - tests/background/service-worker-system-check.test.ts
 *   - tests/shared/system-check-storage.test.ts
 *   - tests/shared/popup-resource-summary.test.ts
 *   - tests/shared/page-status-chip-reason.test.ts
 *   - tests/shared/local-ai-warmup-gate.test.ts
 *   - tests/system-check/lifecycle.test.ts
 *   - tests/popup/popup-model.test.ts
 *   - tests/content/critical-local-ai-modal-status.test.ts
 *
 * If you change a public-beta Local AI surface, prefer extending those
 * targeted tests and keep this file as a high-level contract.
 */

import { DEFAULT_SETTINGS } from '../../src/shared/constants';
import { detectionOptionsFromSettings } from '../../src/shared/detection-config';
import { shouldAutoWarmLocalAi } from '../../src/shared/local-ai-warmup-gate';
import { deriveChipReason, chipReasonMessage } from '../../src/shared/page-status-chip-reason';
import { deriveResourceSummary } from '../../src/shared/popup-resource-summary';
import type {
  LocalAiProtectionState,
  NerStatus,
  Settings,
  SystemCompatibilityStatus,
} from '../../src/shared/message-types';

function compatibility(
  partial: Partial<SystemCompatibilityStatus> = {},
): SystemCompatibilityStatus {
  return {
    schemaVersion: 1,
    policyVersion: 1,
    checkedAt: 1700000000000,
    webGpu: 'available',
    tier: 'ok',
    recommendation: 'none',
    notes: [],
    localAiState: 'enabled',
    runtimeState: 'idle',
    criticalModal: 'none',
    browserMemoryGb: 16,
    ...partial,
  };
}

function settings(partial: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...partial };
}

// All Local AI states where the model is not actively running. These are
// the states a beta release must surface unambiguously and must not
// silently treat as "full Local AI protection succeeded".
const NON_RUNNING_LOCAL_AI_STATES: LocalAiProtectionState[] = [
  'off-user-choice',
  'off-low-memory-auto',
  'off-load-failure',
  'enabled-low-memory-override',
];

describe('Local AI release readiness: pattern detection stays active', () => {
  test('detection config still carries regex parameters when Local AI is off', () => {
    const config = detectionOptionsFromSettings(settings({ nerProvider: 'off' }));
    expect(config.ner_enabled).toBe(false);
    expect(config.ner_provider).toBe('off');
    // The WASM regex pipeline needs these to actually run.
    expect(typeof config.min_confidence).toBe('number');
    expect(typeof config.context_boost).toBe('number');
    expect(typeof config.context_window).toBe('number');
  });

  test.each(NON_RUNNING_LOCAL_AI_STATES)(
    'popup resource summary keeps pattern-only messaging visible for %s',
    (state) => {
      const status = compatibility({
        localAiState: state,
        tier: state === 'off-low-memory-auto' || state === 'enabled-low-memory-override' ? 'critical' : 'ok',
        browserMemoryGb: 6,
      });
      const provider = state === 'off-user-choice' ? 'off' : 'transformers';
      const summary = deriveResourceSummary(settings({ nerProvider: provider }), status);
      expect(summary).not.toBeNull();
      // 'enabled-low-memory-override' surfaces a risk warning, not a
      // pattern-only message; the other three explicitly tell the user
      // that pattern detection remains active.
      if (state !== 'enabled-low-memory-override') {
        expect(summary!.detail.toLowerCase()).toContain('pattern detection');
      } else {
        expect(summary!.detail.toLowerCase()).toContain('local ai');
      }
    },
  );
});

describe('Local AI release readiness: degraded states are visible', () => {
  test('off-load-failure surfaces in popup summary and page chip with retry guidance', () => {
    const status = compatibility({
      localAiState: 'off-load-failure',
      runtimeState: 'failed',
      loadFailure: { message: 'WASM init failed', at: Date.now() },
    });
    const summary = deriveResourceSummary(settings({ nerProvider: 'off' }), status);
    expect(summary).toEqual({
      tone: 'critical',
      title: 'Local AI failed to load',
      detail: 'Pattern detection remains active. Open System Compatibility in Settings to see the error and retry.',
    });

    const chipReason = deriveChipReason({ status });
    expect(chipReason).toBe('model-failed');
    expect(chipReasonMessage(chipReason!).detail.toLowerCase()).toContain('pattern detection');
  });

  test('off-low-memory-auto surfaces critical messaging once the modal has been dismissed', () => {
    const status = compatibility({
      localAiState: 'off-low-memory-auto',
      tier: 'critical',
      criticalModal: 'dismissed',
      browserMemoryGb: 6,
    });
    expect(deriveChipReason({ status })).toBe('low-memory-protection');
    const summary = deriveResourceSummary(settings({ nerProvider: 'off' }), status);
    expect(summary?.tone).toBe('critical');
    expect(summary?.detail.toLowerCase()).toContain('pattern detection');
  });

  test('off-user-choice surfaces pattern-only messaging in popup and chip', () => {
    const status = compatibility({ localAiState: 'off-user-choice' });
    expect(deriveChipReason({ status })).toBe('pattern-only');
    const summary = deriveResourceSummary(settings({ nerProvider: 'off' }), status);
    expect(summary?.tone).toBe('info');
    expect(summary?.detail.toLowerCase()).toContain('pattern detection');
  });

  test('CPU/WASM fallback is surfaced after the model has loaded in that mode', () => {
    const status = compatibility({ localAiState: 'enabled', runtimeState: 'ready' });
    const nerStatus: NerStatus = { mode: 'transformers', state: 'ready', device: 'wasm' };
    expect(deriveChipReason({ status, nerStatus })).toBe('running-on-cpu');
    const summary = deriveResourceSummary(settings(), status, nerStatus);
    expect(summary).toEqual({
      tone: 'warning',
      title: 'Local AI is running on CPU',
      detail: 'WebGPU was not used. Detection may be slower than usual.',
    });
  });
});

describe('Local AI release readiness: no model load when Local AI is off or degraded', () => {
  test('auto-warm gate refuses when Local AI is off', () => {
    expect(
      shouldAutoWarmLocalAi(settings({ nerProvider: 'off' }), compatibility()),
    ).toBe(false);
  });

  test.each<LocalAiProtectionState>([
    'off-user-choice',
    'off-low-memory-auto',
    'off-load-failure',
    'enabled-low-memory-override',
  ])('auto-warm gate refuses when localAiState is %s', (state) => {
    expect(
      shouldAutoWarmLocalAi(
        settings({ nerProvider: state === 'enabled-low-memory-override' ? 'transformers' : 'off' }),
        compatibility({ localAiState: state, tier: state === 'off-low-memory-auto' ? 'critical' : 'ok' }),
      ),
    ).toBe(false);
  });

  test('auto-warm gate refuses when WebGPU is unavailable even on OK memory', () => {
    expect(
      shouldAutoWarmLocalAi(
        settings(),
        compatibility({ webGpu: 'unavailable' }),
      ),
    ).toBe(false);
  });

  test('auto-warm gate refuses when the runtime has already loaded on CPU', () => {
    expect(
      shouldAutoWarmLocalAi(
        settings(),
        compatibility(),
        { mode: 'transformers', state: 'ready', device: 'wasm' } satisfies NerStatus,
      ),
    ).toBe(false);
  });

  test('auto-warm gate allows the happy path: OK tier, enabled, WebGPU available, model not yet loaded', () => {
    expect(
      shouldAutoWarmLocalAi(
        settings(),
        compatibility(),
        { mode: 'transformers', state: 'idle' } satisfies NerStatus,
      ),
    ).toBe(true);
  });
});

describe('Local AI release readiness: explicit retry surface', () => {
  test('after a load failure the chip and summary direct the user to a retry path', () => {
    const status = compatibility({
      localAiState: 'off-load-failure',
      runtimeState: 'failed',
      loadFailure: { message: 'WASM init failed', at: Date.now() },
    });
    const chip = chipReasonMessage(deriveChipReason({ status })!);
    expect(chip.detail.toLowerCase()).toContain('retry');
    const summary = deriveResourceSummary(settings({ nerProvider: 'off' }), status);
    expect(summary?.detail.toLowerCase()).toContain('retry');
  });
});
