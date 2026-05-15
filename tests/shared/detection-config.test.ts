import { detectionOptionsFromSettings, fallbackNerStatus } from '../../src/shared/detection-config';
import { DEFAULT_SETTINGS } from '../../src/shared/constants';
import { minResolvedThreshold } from '../../src/shared/sensitivity-resolver';

describe('detection config from settings', () => {
  test('maps persisted NER provider and detector thresholds into request config', () => {
    const overrides = {
      ...DEFAULT_SETTINGS,
      minConfidence: 0.72,
      contextBoost: 0.2,
      contextWindow: 9,
      nerProvider: 'fixture' as const,
      nerModel: 'hikmaai' as const,
    };
    const config = detectionOptionsFromSettings(overrides);

    expect(config).toEqual(
      expect.objectContaining({
        // min_confidence is the lowest resolved threshold across all entity types so WASM
        // never pre-filters a span that the per-entity resolver wants to keep.
        min_confidence: minResolvedThreshold(overrides),
        context_boost: 0.2,
        context_window: 9,
        ner_provider: 'fixture',
        ner_model: 'hikmaai',
        ner_enabled: true,
      })
    );
  });

  test('lets explicit request config override the persisted provider mode', () => {
    const config = detectionOptionsFromSettings(
      { ...DEFAULT_SETTINGS, nerProvider: 'fixture' },
      { ner_provider: 'off', ner_enabled: true }
    );

    expect(config).toEqual(
      expect.objectContaining({
        ner_provider: 'off',
        ner_enabled: false,
      })
    );
  });

  test('builds a failed fallback status for active providers', () => {
    expect(fallbackNerStatus('fixture', 'status check failed')).toEqual({
      mode: 'fixture',
      state: 'failed',
      message: 'status check failed',
    });
  });
});
