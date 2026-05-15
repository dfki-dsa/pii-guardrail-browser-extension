import type { DetectionOptions, NerProviderMode, NerStatus, Settings } from './message-types';
import { minResolvedThreshold } from './sensitivity-resolver';

export function detectionOptionsFromSettings(
  settings: Settings,
  overrides?: DetectionOptions,
): DetectionOptions {
  const provider = overrides?.ner_provider ?? settings.nerProvider;
  const model = overrides?.ner_model ?? settings.nerModel;
  return {
    min_confidence: minResolvedThreshold(settings),
    context_boost: settings.contextBoost,
    context_window: settings.contextWindow,
    ner_enabled: provider !== 'off',
    ner_provider: provider,
    ner_model: model,
    ...overrides,
    ...(provider === 'off' ? { ner_enabled: false } : {}),
  };
}

export function fallbackNerStatus(
  mode: NerProviderMode,
  message = 'NER status is unavailable.',
): NerStatus {
  return {
    mode,
    state: mode === 'off' ? 'unavailable' : 'failed',
    message,
  };
}
