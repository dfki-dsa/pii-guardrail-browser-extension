import {
  ACTIVE_NER_MODELS,
  NER_MODELS,
  nerModelChoices,
  nerModelChoiceValue,
  parseNerModelChoice,
} from '../../src/shared/constants';

describe('merged model + precision picker choices', () => {
  test('lists the active q4f16-only model once under its plain label', () => {
    const bardsai = NER_MODELS.find((model) => model.key === 'bardsai')!;
    const choices = nerModelChoices([bardsai]);

    expect(choices).toEqual([
      { value: 'bardsai', key: 'bardsai', dtype: null, label: bardsai.label },
    ]);
  });

  test('lists a model without dtype options once under its plain label', () => {
    const ai4privacy = NER_MODELS.find((model) => model.key === 'ai4privacy')!;
    const choices = nerModelChoices([ai4privacy]);

    expect(choices).toEqual([
      { value: 'ai4privacy', key: 'ai4privacy', dtype: null, label: ai4privacy.label },
    ]);
  });

  test('defaults to the active model list shared by popup and options page', () => {
    const keys = new Set(nerModelChoices().map((choice) => choice.key));

    expect([...keys]).toEqual(ACTIVE_NER_MODELS.map((model) => model.key));
  });

  test('derives the select value from persisted model and dtype settings', () => {
    expect(nerModelChoiceValue('bardsai', 'q4f16')).toBe('bardsai');
    expect(nerModelChoiceValue('bardsai', undefined)).toBe('bardsai');
  });

  test('round-trips every choice value back to a settings patch', () => {
    for (const choice of nerModelChoices(NER_MODELS)) {
      const parsed = parseNerModelChoice(choice.value);
      expect(parsed.nerModel).toBe(choice.key);
      expect(parsed.nerWebGpuDtype).toBe(choice.dtype ?? undefined);
    }
  });

  test('ignores an unknown dtype suffix instead of persisting it', () => {
    expect(parseNerModelChoice('bardsai@q8')).toEqual({ nerModel: 'bardsai' });
  });
});
