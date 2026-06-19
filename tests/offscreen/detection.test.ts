import { detectPii } from '../../src/offscreen/wasm-bridge';
import {
  detectWithExternalNer,
  getNerStatus,
  resetNerProviderStateForTests,
  setNerProviderFactoryForTests,
} from '../../src/offscreen/detection';
import type { NerProvider } from '../../src/offscreen/ner-provider';

jest.mock('../../src/offscreen/wasm-bridge', () => ({
  detectPii: jest.fn().mockResolvedValue([]),
}));

describe('offscreen detection flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetNerProviderStateForTests();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    resetNerProviderStateForTests();
  });

  function silenceExpectedNerFailureLogs(): jest.SpyInstance {
    return jest.spyOn(console, 'error').mockImplementation(() => undefined);
  }

  test('reports invalid transformer model requests as BardsAI before first detection', () => {
    expect(getNerStatus({ ner_provider: 'transformers', ner_model: 'banana' as any })).toEqual(
      expect.objectContaining({
        mode: 'transformers',
        state: 'idle',
        model: 'bardsai',
        modelLabel: 'BardsAI EU multilingual',
        message: 'BardsAI EU multilingual will load on first detection.',
      })
    );
  });

  test('passes fixture NER candidates into the WASM detector', async () => {
    const text = 'My name is Ada Lovelace and I work at Acme Corp.';
    const config = { ner_provider: 'fixture' as const };

    await detectWithExternalNer(text, config);

    expect(detectPii).toHaveBeenCalledWith(
      text,
      config,
      expect.arrayContaining([
        expect.objectContaining({
          entity_type: 'PERSON',
          text: 'Ada Lovelace',
          source: 'ner',
        }),
        expect.objectContaining({
          entity_type: 'ORGANIZATION',
          text: 'Acme Corp',
          source: 'ner',
        }),
      ])
    );
    expect(getNerStatus(config)).toEqual(
      expect.objectContaining({ mode: 'fixture', state: 'ready' })
    );
  });

  test('off mode skips external NER candidates and forces regex-only config', async () => {
    const text = 'My name is Ada Lovelace.';
    const config = { ner_provider: 'off' as const, ner_enabled: true };

    await detectWithExternalNer(text, config);

    expect(detectPii).toHaveBeenCalledWith(
      text,
      expect.objectContaining({ ner_provider: 'off', ner_enabled: false }),
      []
    );
    expect(getNerStatus(config)).toEqual(
      expect.objectContaining({ mode: 'off', state: 'unavailable' })
    );
  });

  test('regex-only detections do not clear a ready transformer model status', async () => {
    const text = 'John Smith lives in Berlin.';
    const staleConfig = {
      ner_provider: 'transformers' as const,
      ner_model: 'bardsai' as const,
      ner_enabled: true,
    };
    const hikmaAiProvider: NerProvider = {
      mode: 'transformers',
      model: 'hikmaai',
      modelLabel: 'HikmaAI DistilBERT PII',
      detect: jest.fn().mockResolvedValue([]),
    };

    setNerProviderFactoryForTests((_mode, model) => {
      if (model === 'bardsai') {
        return { ...hikmaAiProvider, model: 'bardsai', modelLabel: 'BardsAI EU multilingual' };
      }
      return null;
    });

    await detectWithExternalNer(text, staleConfig);
    await detectWithExternalNer('test', { ner_provider: 'off', ner_enabled: false });

    expect(getNerStatus(staleConfig)).toEqual(
      expect.objectContaining({
        mode: 'transformers',
        state: 'ready',
        model: 'bardsai',
      })
    );
  });

  test('transformers mode reports unavailable after the real runtime fails', async () => {
    const text = 'My name is Ada Lovelace.';
    const config = { ner_provider: 'transformers' as const, ner_enabled: true };
    const consoleError = silenceExpectedNerFailureLogs();

    await detectWithExternalNer(text, config);

    expect(consoleError).toHaveBeenCalledWith(
      '[PG:offscreen] NER provider failed:',
      expect.any(Error)
    );
    expect(detectPii).toHaveBeenCalledWith(
      text,
      expect.objectContaining({ ner_provider: 'transformers', ner_enabled: false }),
      []
    );
    expect(getNerStatus(config)).toEqual(
      expect.objectContaining({
        mode: 'transformers',
        state: 'unavailable',
      })
    );
  });

  test('falls back to regex-only detection when NER inference fails', async () => {
    const text = 'Ada Lovelace works at Acme Corp.';
    const config = { ner_provider: 'fixture' as const, ner_enabled: true };
    const failingProvider: NerProvider = {
      mode: 'fixture',
      detect: jest.fn().mockRejectedValue(new Error('fixture failure')),
    };

    setNerProviderFactoryForTests(() => failingProvider);
    const consoleError = silenceExpectedNerFailureLogs();

    await detectWithExternalNer(text, config);

    expect(consoleError).toHaveBeenCalledWith(
      '[PG:offscreen] NER provider failed:',
      expect.any(Error)
    );
    expect(failingProvider.detect).toHaveBeenCalledWith(text);
    expect(detectPii).toHaveBeenCalledWith(
      text,
      expect.objectContaining({ ner_provider: 'fixture', ner_enabled: false }),
      []
    );
    expect(getNerStatus(config)).toEqual(
      expect.objectContaining({
        mode: 'fixture',
        state: 'failed',
        message: 'fixture failure',
      })
    );
  });

  test('returns NER overhead timing distinct from total detection', async () => {
    const text = 'Ada Lovelace works at Acme Corp.';
    const config = { ner_provider: 'fixture' as const, ner_enabled: true };

    const result = await detectWithExternalNer(text, config);

    expect(result.spans).toEqual([]);
    expect(typeof result.nerMs).toBe('number');
    expect(result.nerMs!).toBeGreaterThanOrEqual(0);
  });

  test('surfaces provider timing metadata through NER status', async () => {
    const text = 'Ada Lovelace works at Acme Corp.';
    const config = { ner_provider: 'transformers' as const, ner_enabled: true };
    const timing = {
      totalMs: 42,
      loadMs: 20,
      inferenceMs: 22,
      chunkCount: 3,
      textBytes: 128,
      wasCold: true,
    };
    const timedProvider: NerProvider = {
      mode: 'transformers',
      detect: jest.fn().mockResolvedValue([]),
      getLastTiming: jest.fn().mockReturnValue(timing),
      getDevice: jest.fn().mockReturnValue('wasm'),
    };

    setNerProviderFactoryForTests(() => timedProvider);

    await detectWithExternalNer(text, config);

    expect(getNerStatus(config)).toEqual(
      expect.objectContaining({
        mode: 'transformers',
        state: 'ready',
        device: 'wasm',
        timings: timing,
      })
    );
  });

  test('uses BardsAI for invalid transformer model requests', async () => {
    const text = 'John Smith lives in Berlin.';
    const config = {
      ner_provider: 'transformers' as const,
      ner_model: 'banana' as any,
      ner_enabled: true,
    };
    const bardsAiProvider: NerProvider = {
      mode: 'transformers',
      model: 'bardsai',
      modelLabel: 'BardsAI EU multilingual',
      detect: jest.fn().mockResolvedValue([]),
    };
    const providerFactory = jest.fn((_mode, model) => {
      if (model === 'bardsai') return bardsAiProvider;
      return null;
    });

    setNerProviderFactoryForTests(providerFactory);

    await detectWithExternalNer(text, config);

    expect(providerFactory).toHaveBeenCalledTimes(1);
    expect(providerFactory).toHaveBeenCalledWith('transformers', 'bardsai', undefined);
    expect(bardsAiProvider.detect).toHaveBeenCalledWith(text);
    expect(getNerStatus(config)).toEqual(
      expect.objectContaining({
        mode: 'transformers',
        state: 'ready',
        model: 'bardsai',
        modelLabel: 'BardsAI EU multilingual',
      })
    );
  });

  test('forwards the q4f16 WebGPU dtype preference from config to the provider factory', async () => {
    const text = 'John Smith lives in Berlin.';
    const config = {
      ner_provider: 'transformers' as const,
      ner_model: 'bardsai' as const,
      ner_webgpu_dtype: 'q4f16' as const,
      ner_enabled: true,
    };
    const bardsAiProvider: NerProvider = {
      mode: 'transformers',
      model: 'bardsai',
      modelLabel: 'BardsAI EU multilingual',
      detect: jest.fn().mockResolvedValue([]),
    };
    const providerFactory = jest.fn(() => bardsAiProvider);

    setNerProviderFactoryForTests(providerFactory);

    await detectWithExternalNer(text, config);

    expect(providerFactory).toHaveBeenCalledWith('transformers', 'bardsai', 'q4f16');
  });

  test('does not fall back to deprecated transformer models when the standard model is unavailable', async () => {
    const text = 'John Smith lives in Berlin.';
    const config = {
      ner_provider: 'transformers' as const,
      ner_model: 'bardsai' as const,
      ner_enabled: true,
    };
    const bardsAiProvider: NerProvider = {
      mode: 'transformers',
      model: 'bardsai',
      modelLabel: 'BardsAI EU multilingual',
      detect: jest.fn().mockRejectedValue(new Error('missing bardsai assets')),
    };
    const providerFactory = jest.fn((_mode, model) => {
      if (model === 'bardsai') return bardsAiProvider;
      return null;
    });

    setNerProviderFactoryForTests(providerFactory);
    const consoleError = silenceExpectedNerFailureLogs();

    await detectWithExternalNer(text, config);

    expect(consoleError).toHaveBeenCalledWith(
      '[PG:offscreen] NER provider failed:',
      expect.any(Error)
    );
    expect(providerFactory).toHaveBeenCalledTimes(1);
    expect(providerFactory).toHaveBeenCalledWith('transformers', 'bardsai', undefined);
    expect(getNerStatus(config)).toEqual(
      expect.objectContaining({
        mode: 'transformers',
        state: 'unavailable',
        model: 'bardsai',
        modelLabel: 'BardsAI EU multilingual',
      })
    );
  });

  test('falls back to regex-only without blocking when transformer assets are missing', async () => {
    const text = 'Ada Lovelace works at Acme Corp.';
    const config = { ner_provider: 'transformers' as const, ner_enabled: true };
    const consoleError = silenceExpectedNerFailureLogs();

    const result = await detectWithExternalNer(text, config);

    expect(consoleError).toHaveBeenCalledWith(
      '[PG:offscreen] NER provider failed:',
      expect.any(Error)
    );
    expect(detectPii).toHaveBeenCalledWith(
      text,
      expect.objectContaining({ ner_provider: 'transformers', ner_enabled: false }),
      []
    );
    expect(result.spans).toEqual([]);
    expect(getNerStatus(config)).toEqual(
      expect.objectContaining({ mode: 'transformers', state: 'unavailable' })
    );
  });

  test('reports loading while a provider is still running', async () => {
    const text = 'Ada Lovelace works at Acme Corp.';
    const config = { ner_provider: 'fixture' as const };
    let resolveDetect: (spans: []) => void = () => {};
    const pendingProvider: NerProvider = {
      mode: 'fixture',
      detect: jest.fn(
        () => new Promise<[]>((resolve) => {
          resolveDetect = resolve;
        })
      ),
    };

    setNerProviderFactoryForTests(() => pendingProvider);
    const detection = detectWithExternalNer(text, config);

    await Promise.resolve();
    expect(getNerStatus(config)).toEqual(
      expect.objectContaining({ mode: 'fixture', state: 'loading' })
    );

    resolveDetect([]);
    await detection;
  });

  test('cancels before starting provider work', async () => {
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      detectWithExternalNer('Ada Lovelace', { ner_provider: 'fixture' }, abortController.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(detectPii).not.toHaveBeenCalled();
  });

  test('cancels after NER before handing off to WASM', async () => {
    const text = 'Ada Lovelace works at Acme Corp.';
    const config = { ner_provider: 'fixture' as const, ner_enabled: true };
    const abortController = new AbortController();
    const cancelingProvider: NerProvider = {
      mode: 'fixture',
      detect: jest.fn().mockImplementation(() => {
        abortController.abort();
        return Promise.resolve([]);
      }),
    };

    setNerProviderFactoryForTests(() => cancelingProvider);

    await expect(detectWithExternalNer(text, config, abortController.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(detectPii).not.toHaveBeenCalled();
  });
});
