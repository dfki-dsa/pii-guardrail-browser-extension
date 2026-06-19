import {
  applyNerThresholdPolicy,
  chunkTextForNer,
  createFixtureNerProvider,
  createNerProvider,
  createTransformersNerProvider,
  mapAi4PrivacyLabelToEntityType,
  mapBardsAiLabelToEntityType,
  mapHikmaAiLabelToEntityType,
  mergeOverlappingNerSpans,
  NerProviderUnavailableError,
  nerThresholdForEntityType,
  passesNerThreshold,
  resetNerProviderCachesForTests,
  transformerOutputToSpans,
} from '../../src/offscreen/ner-provider';

describe('fixture NER provider', () => {
  test('returns deterministic NER candidate spans with byte offsets', async () => {
    const text =
      'Anna Müller from Beispiel GmbH lives in München. Use https://portal.example/private with alice_admin.';
    const provider = createFixtureNerProvider();

    const spans = await provider.detect(text);

    expect(spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity_type: 'PERSON',
          text: 'Anna Müller',
          source: 'ner',
        }),
        expect.objectContaining({
          entity_type: 'ORGANIZATION',
          text: 'Beispiel GmbH',
          source: 'ner',
        }),
        expect.objectContaining({
          entity_type: 'LOCATION',
          text: 'München',
          source: 'ner',
        }),
        expect.objectContaining({
          entity_type: 'URL',
          text: 'https://portal.example/private',
          source: 'ner',
        }),
        expect.objectContaining({
          entity_type: 'USERNAME',
          text: 'alice_admin',
          source: 'ner',
        }),
      ])
    );

    const person = spans.find((span) => span.text === 'Anna Müller')!;
    const personStart = new TextEncoder().encode(text.slice(0, text.indexOf('Anna Müller'))).length;
    const personEnd = personStart + new TextEncoder().encode('Anna Müller').length;
    expect(person.start).toBe(personStart);
    expect(person.end).toBe(personEnd);
  });
});

describe('transformers NER provider', () => {
  const extensionUrl = (path: string) => `chrome-extension://test/${path}`;

  afterEach(() => {
    resetNerProviderCachesForTests();
  });

  test('configures Transformers.js for local-only extension assets and q4f16 WASM fallback', async () => {
    const onnxWasm: any = { wasmPaths: { mjs: 'cdn://stale.mjs', wasm: 'cdn://stale.wasm' } };
    const env: any = {
      allowRemoteModels: true,
      allowLocalModels: false,
      localModelPath: '',
      useBrowserCache: true,
      useFSCache: true,
      useWasmCache: true,
      backends: { onnx: { wasm: onnxWasm } },
    };
    const classifier = jest.fn().mockResolvedValue([
      {
        entity_group: 'PERSON_NAME',
        score: 0.93,
        word: 'Ada Lovelace',
        start: 11,
        end: 23,
      },
    ]);
    const pipeline = jest.fn().mockResolvedValue(classifier);
    const assetExists = jest.fn().mockResolvedValue(true);
    const provider = createTransformersNerProvider({
      getExtensionUrl: extensionUrl,
      assetExists,
      detectWebGpu: jest.fn().mockResolvedValue(false),
      loadTransformers: jest.fn().mockResolvedValue({ env, pipeline }),
    });

    const spans = await provider.detect('My name is Ada Lovelace.');

    expect(env.allowRemoteModels).toBe(false);
    expect(env.allowLocalModels).toBe(true);
    expect(env.localModelPath).toBe('chrome-extension://test/models/');
    expect(env.useBrowserCache).toBe(false);
    expect(env.useFSCache).toBe(false);
    expect(env.useWasmCache).toBe(false);
    // Mutated in place so ORT actually sees the override (not replaced —
    // env.backends.onnx is a shallow spread of ONNX_ENV).
    expect(env.backends.onnx.wasm).toBe(onnxWasm);
    expect(onnxWasm.wasmPaths).toEqual({
      mjs: 'chrome-extension://test/vendor/onnxruntime-web/ort-wasm-simd-threaded.mjs',
      wasm: 'chrome-extension://test/vendor/onnxruntime-web/ort-wasm-simd-threaded.wasm',
    });
    expect(onnxWasm.numThreads).toBe(1);
    expect(onnxWasm.proxy).toBe(false);
    expect(assetExists).toHaveBeenCalledWith(
      'chrome-extension://test/models/ner/bardsai-eu-pii-anonimization-multilang/onnx/model_q4f16.onnx'
    );
    expect(assetExists).toHaveBeenCalledWith(
      'chrome-extension://test/models/ner/bardsai-eu-pii-anonimization-multilang/onnx/model_q4f16.onnx.data'
    );
    expect(assetExists).not.toHaveBeenCalledWith(
      'chrome-extension://test/models/ner/bardsai-eu-pii-anonimization-multilang/onnx/model_quantized.onnx'
    );
    expect(pipeline).toHaveBeenCalledWith('token-classification', 'ner/bardsai-eu-pii-anonimization-multilang', {
      dtype: 'q4f16',
      local_files_only: true,
      device: 'wasm',
      session_options: {
        externalData: [
          { path: 'model_q4f16.onnx.data', data: 'onnx/model_q4f16.onnx.data' },
        ],
      },
    });
    expect(classifier).toHaveBeenCalledWith('My name is Ada Lovelace.', {
      aggregation_strategy: 'simple',
    });
    expect(spans).toEqual([
      expect.objectContaining({
        entity_type: 'PERSON',
        text: 'Ada Lovelace',
        source: 'ner',
      }),
    ]);
    expect(provider.getDevice?.()).toBe('wasm');
  });

  test('uses HikmaAI fp16 artifact on WebGPU', async () => {
    const onnxWasm: any = {};
    const env: any = {
      allowRemoteModels: true,
      allowLocalModels: false,
      localModelPath: '',
      useBrowserCache: true,
      useFSCache: true,
      useWasmCache: true,
      backends: { onnx: { wasm: onnxWasm } },
    };
    const classifier = jest.fn().mockResolvedValue([]);
    const pipeline = jest.fn().mockResolvedValue(classifier);
    const assetExists = jest.fn().mockResolvedValue(true);
    const provider = createTransformersNerProvider({
      modelKey: 'hikmaai',
      getExtensionUrl: extensionUrl,
      assetExists,
      detectWebGpu: jest.fn().mockResolvedValue(true),
      loadTransformers: jest.fn().mockResolvedValue({ env, pipeline }),
    });

    await provider.detect('no pii here');

    expect(assetExists).toHaveBeenCalledWith(
      'chrome-extension://test/models/ner/hikmaai-distilbert-pii/onnx/model_fp16.onnx'
    );
    expect(assetExists).not.toHaveBeenCalledWith(
      'chrome-extension://test/models/ner/hikmaai-distilbert-pii/onnx/model_quantized.onnx'
    );
    expect(onnxWasm.wasmPaths).toEqual({
      mjs: 'chrome-extension://test/vendor/onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs',
      wasm: 'chrome-extension://test/vendor/onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm',
    });
    expect(pipeline).toHaveBeenCalledWith(
      'token-classification',
      'ner/hikmaai-distilbert-pii',
      {
        dtype: 'fp16',
        local_files_only: true,
        device: 'webgpu',
      }
    );
    expect(provider.getDevice?.()).toBe('webgpu');
  });

  test('uses BardsAI q4f16 external-data artifact on WebGPU by default', async () => {
    const onnxWasm: any = {};
    const env: any = {
      allowRemoteModels: true,
      allowLocalModels: false,
      localModelPath: '',
      useBrowserCache: true,
      useFSCache: true,
      useWasmCache: true,
      backends: { onnx: { wasm: onnxWasm } },
    };
    const classifier = jest.fn().mockResolvedValue([]);
    const pipeline = jest.fn().mockResolvedValue(classifier);
    const assetExists = jest.fn().mockResolvedValue(true);
    const provider = createTransformersNerProvider({
      modelKey: 'bardsai',
      getExtensionUrl: extensionUrl,
      assetExists,
      detectWebGpu: jest.fn().mockResolvedValue(true),
      loadTransformers: jest.fn().mockResolvedValue({ env, pipeline }),
    });

    await provider.detect('no pii here');

    expect(assetExists).toHaveBeenCalledWith(
      'chrome-extension://test/models/ner/bardsai-eu-pii-anonimization-multilang/onnx/model_q4f16.onnx'
    );
    expect(assetExists).toHaveBeenCalledWith(
      'chrome-extension://test/models/ner/bardsai-eu-pii-anonimization-multilang/onnx/model_q4f16.onnx.data'
    );
    expect(assetExists).not.toHaveBeenCalledWith(
      'chrome-extension://test/models/ner/bardsai-eu-pii-anonimization-multilang/onnx/model_quantized.onnx'
    );
    expect(pipeline).toHaveBeenCalledWith(
      'token-classification',
      'ner/bardsai-eu-pii-anonimization-multilang',
      {
        dtype: 'q4f16',
        local_files_only: true,
        device: 'webgpu',
        // The external-data `path` must match the `location` recorded inside
        // model_q4f16.onnx; `data` is resolved relative to the model dir.
        session_options: {
          externalData: [
            { path: 'model_q4f16.onnx.data', data: 'onnx/model_q4f16.onnx.data' },
          ],
        },
      }
    );
    expect(provider.getDevice?.()).toBe('webgpu');
  });

  test('uses q4f16 on the WASM fallback path', async () => {
    const env: any = {
      allowRemoteModels: true,
      allowLocalModels: false,
      localModelPath: '',
      useBrowserCache: true,
      useFSCache: true,
      useWasmCache: true,
      backends: { onnx: { wasm: {} } },
    };
    const classifier = jest.fn().mockResolvedValue([]);
    const pipeline = jest.fn().mockResolvedValue(classifier);
    const assetExists = jest.fn().mockResolvedValue(true);
    const provider = createTransformersNerProvider({
      modelKey: 'bardsai',
      getExtensionUrl: extensionUrl,
      assetExists,
      detectWebGpu: jest.fn().mockResolvedValue(false),
      loadTransformers: jest.fn().mockResolvedValue({ env, pipeline }),
    });

    await provider.detect('no pii here');

    expect(assetExists).toHaveBeenCalledWith(
      'chrome-extension://test/models/ner/bardsai-eu-pii-anonimization-multilang/onnx/model_q4f16.onnx'
    );
    expect(assetExists).toHaveBeenCalledWith(
      'chrome-extension://test/models/ner/bardsai-eu-pii-anonimization-multilang/onnx/model_q4f16.onnx.data'
    );
    expect(assetExists).not.toHaveBeenCalledWith(
      'chrome-extension://test/models/ner/bardsai-eu-pii-anonimization-multilang/onnx/model_fp16.onnx'
    );
    expect(assetExists).not.toHaveBeenCalledWith(
      'chrome-extension://test/models/ner/bardsai-eu-pii-anonimization-multilang/onnx/model_quantized.onnx'
    );
    expect(pipeline).toHaveBeenCalledWith(
      'token-classification',
      'ner/bardsai-eu-pii-anonimization-multilang',
      {
        dtype: 'q4f16',
        local_files_only: true,
        device: 'wasm',
        session_options: {
          externalData: [
            { path: 'model_q4f16.onnx.data', data: 'onnx/model_q4f16.onnx.data' },
          ],
        },
      }
    );
  });

  test('keeps q8 as the legacy WASM fallback for models without a CPU dtype', async () => {
    const env: any = {
      allowRemoteModels: true,
      allowLocalModels: false,
      localModelPath: '',
      useBrowserCache: true,
      useFSCache: true,
      useWasmCache: true,
      backends: { onnx: { wasm: {} } },
    };
    const classifier = jest.fn().mockResolvedValue([]);
    const pipeline = jest.fn().mockResolvedValue(classifier);
    const assetExists = jest.fn().mockResolvedValue(true);
    const provider = createTransformersNerProvider({
      modelKey: 'ai4privacy',
      getExtensionUrl: extensionUrl,
      assetExists,
      detectWebGpu: jest.fn().mockResolvedValue(false),
      loadTransformers: jest.fn().mockResolvedValue({ env, pipeline }),
    });

    await provider.detect('no pii here');

    expect(assetExists).toHaveBeenCalledWith(
      'chrome-extension://test/models/ner/ai4privacy/onnx/model_quantized.onnx'
    );
    expect(pipeline).toHaveBeenCalledWith(
      'token-classification',
      'ner/ai4privacy',
      {
        dtype: 'q8',
        local_files_only: true,
        device: 'wasm',
      }
    );
  });

  test('reports missing local model or runtime assets before loading Transformers.js', async () => {
    const loadTransformers = jest.fn();
    const provider = createTransformersNerProvider({
      getExtensionUrl: extensionUrl,
      assetExists: jest.fn().mockResolvedValue(false),
      loadTransformers,
    });

    await expect(provider.detect('Ada Lovelace')).rejects.toThrow(NerProviderUnavailableError);
    await expect(provider.detect('Ada Lovelace')).rejects.toThrow(
      'Missing transformer NER assets'
    );
    expect(loadTransformers).not.toHaveBeenCalled();
  });

  test('caches provider initialization across repeated detections', async () => {
    const env: any = {
      allowRemoteModels: true,
      allowLocalModels: false,
      localModelPath: '',
      useBrowserCache: true,
      useFSCache: true,
      useWasmCache: false,
      backends: { onnx: { wasm: {} } },
    };
    const classifier = jest.fn().mockResolvedValue([]);
    const pipeline = jest.fn().mockResolvedValue(classifier);
    const assetExists = jest.fn().mockResolvedValue(true);
    const provider = createTransformersNerProvider({
      getExtensionUrl: extensionUrl,
      assetExists,
      loadTransformers: jest.fn().mockResolvedValue({ env, pipeline }),
    });

    await provider.detect('Ada Lovelace');
    await provider.detect('David Smith');

    expect(pipeline).toHaveBeenCalledTimes(1);
    // 5 q4f16 model assets + 4 runtime assets (incl. asyncify variants).
    expect(assetExists).toHaveBeenCalledTimes(9);
    expect(classifier).toHaveBeenCalledTimes(2);
  });

  test('shares one pipeline initialization across concurrent detect callers', async () => {
    const env: any = {
      allowRemoteModels: true,
      allowLocalModels: false,
      localModelPath: '',
      useBrowserCache: true,
      useFSCache: true,
      useWasmCache: false,
      backends: { onnx: { wasm: {} } },
    };
    let releasePipeline: ((value: jest.Mock) => void) | undefined;
    const classifier = jest.fn().mockResolvedValue([]);
    // Defer pipeline resolution so multiple callers queue behind the same
    // in-flight ensurePipeline() promise — this is the "concurrent load
    // sharing" guarantee the PRD requires.
    const pipeline = jest.fn(
      () =>
        new Promise((resolve) => {
          releasePipeline = resolve as (value: jest.Mock) => void;
        }),
    );
    const loadTransformers = jest.fn().mockResolvedValue({ env, pipeline });
    const assetExists = jest.fn().mockResolvedValue(true);
    const provider = createTransformersNerProvider({
      getExtensionUrl: extensionUrl,
      assetExists,
      detectWebGpu: jest.fn().mockResolvedValue(false),
      loadTransformers,
    });

    const first = provider.detect('Ada Lovelace');
    const second = provider.detect('David Smith');
    // Concurrent caller arrives while ensurePipeline is still pending.
    const third = provider.detect('Anna Müller');

    // Drain microtasks until pipeline() is invoked (webgpu detection +
    // asset checks + transformers load are all awaited beforehand).
    for (let i = 0; i < 50 && !releasePipeline; i++) await Promise.resolve();
    expect(releasePipeline).toBeDefined();
    releasePipeline!(classifier);
    await Promise.all([first, second, third]);

    expect(loadTransformers).toHaveBeenCalledTimes(1);
    expect(pipeline).toHaveBeenCalledTimes(1);
    expect(classifier).toHaveBeenCalledTimes(3);
  });

  test('default provider factory reuses the transformer provider instance', () => {
    const first = createNerProvider('transformers');
    const second = createNerProvider('transformers');

    expect(first).toBe(second);
  });

  test('default provider factory reuses the q4f16 transformer provider instance', () => {
    const first = createNerProvider('transformers', 'bardsai', 'q4f16');
    const second = createNerProvider('transformers', 'bardsai', 'q4f16');

    expect(second).toBe(first);
  });

  test('maps representative AI4Privacy labels into the compact entity taxonomy', () => {
    const cases = [
      ['B-FIRSTNAME', 'PERSON'],
      ['LAST_NAME', 'PERSON'],
      ['COMPANY_NAME', 'ORGANIZATION'],
      ['CITY', 'LOCATION'],
      ['STREET_ADDRESS', 'ADDRESS'],
      ['URL', 'URL'],
      ['USERNAME', 'USERNAME'],
      ['PASSWORD', 'PASSWORD'],
      ['PIN', 'PASSWORD'],
      ['ACCOUNT_NUMBER', 'BANK_ACCOUNT'],
      ['EMAIL_ADDRESS', 'EMAIL'],
      ['PHONE_NUMBER', 'PHONE'],
      ['CREDIT_CARD_NUMBER', 'CREDIT_CARD'],
      ['IBAN_CODE', 'IBAN'],
      ['IP_ADDRESS', 'IP_ADDRESS'],
      ['DATE_OF_BIRTH', 'DATE'],
      ['PASSPORT_NUMBER', 'MISC'],
    ] as const;

    for (const [label, entityType] of cases) {
      expect(mapAi4PrivacyLabelToEntityType(label)).toBe(entityType);
    }
  });

  test('deliberately ignores unsupported or undesirable AI4Privacy labels', () => {
    expect(mapAi4PrivacyLabelToEntityType('AGE')).toBeNull();
    expect(mapAi4PrivacyLabelToEntityType('JOBTYPE')).toBeNull();
    expect(mapAi4PrivacyLabelToEntityType('TIME')).toBeNull();
  });

  test('maps BardsAI labels into the app taxonomy without dropping sensitive categories', () => {
    const cases = [
      ['PERSON_NAME', 'PERSON'],
      ['ORGANIZATION_NAME', 'ORGANIZATION'],
      ['LOCATION', 'LOCATION'],
      ['POSTAL_ADDRESS', 'ADDRESS'],
      ['IDENTIFYING_LINK', 'URL'],
      ['CONTACT_HANDLE', 'USERNAME'],
      ['AUTH_SECRET', 'PASSWORD'],
      ['BANK_ACCOUNT_IDENTIFIER', 'BANK_ACCOUNT'],
      ['EMAIL_ADDRESS', 'EMAIL'],
      ['PHONE_NUMBER', 'PHONE'],
      ['PAYMENT_CARD', 'CREDIT_CARD'],
      ['IP_ADDRESS', 'IP_ADDRESS'],
      ['DATE_OF_BIRTH', 'DATE'],
      ['HEALTH_DATA', 'MISC'],
      ['POLITICAL_OPINION', 'MISC'],
      ['VEHICLE_IDENTIFIER', 'MISC'],
    ] as const;

    for (const [label, entityType] of cases) {
      expect(mapBardsAiLabelToEntityType(label)).toBe(entityType);
    }
  });

  test('maps HikmaAI BIO labels into the app taxonomy', () => {
    const cases = [
      ['B-GIVENNAME', 'PERSON'],
      ['I-SURNAME', 'PERSON'],
      ['B-DATEOFBIRTH', 'DATE'],
      ['B-USERNAME', 'USERNAME'],
      ['B-PASSWORD', 'PASSWORD'],
      ['B-EMAIL', 'EMAIL'],
      ['I-TELEPHONENUM', 'PHONE'],
      ['B-STREET', 'ADDRESS'],
      ['B-BUILDINGNUM', 'ADDRESS'],
      ['B-ZIPCODE', 'ADDRESS'],
      ['B-CITY', 'LOCATION'],
      ['B-CREDITCARDNUMBER', 'CREDIT_CARD'],
      ['B-ACCOUNTNUM', 'BANK_ACCOUNT'],
      ['B-SOCIALNUM', 'SSN'],
      ['B-TAXNUM', 'MISC'],
      ['B-DRIVERLICENSENUM', 'MISC'],
      ['B-IDCARDNUM', 'MISC'],
    ] as const;

    for (const [label, entityType] of cases) {
      expect(mapHikmaAiLabelToEntityType(label)).toBe(entityType);
    }

    expect(mapHikmaAiLabelToEntityType('O')).toBeNull();
    expect(mapHikmaAiLabelToEntityType('B-UNKNOWN')).toBeNull();
  });

  test('applies per-type NER thresholds and treats MISC conservatively', () => {
    expect(nerThresholdForEntityType('PERSON')).toBe(0.55);
    expect(nerThresholdForEntityType('ORGANIZATION')).toBe(0.5);
    expect(nerThresholdForEntityType('BANK_ACCOUNT')).toBe(0.5);
    expect(nerThresholdForEntityType('MISC')).toBe(0.7);
    expect(passesNerThreshold({ entity_type: 'PERSON', score: 0.54 })).toBe(false);
    expect(passesNerThreshold({ entity_type: 'PERSON', score: 0.55 })).toBe(true);
    expect(passesNerThreshold({ entity_type: 'ORGANIZATION', score: 0.49 })).toBe(false);
    expect(passesNerThreshold({ entity_type: 'ORGANIZATION', score: 0.5 })).toBe(true);
    expect(passesNerThreshold({ entity_type: 'BANK_ACCOUNT', score: 0.49 })).toBe(false);
    expect(passesNerThreshold({ entity_type: 'BANK_ACCOUNT', score: 0.5 })).toBe(true);
    expect(passesNerThreshold({ entity_type: 'MISC', score: 0.69 })).toBe(false);
    expect(passesNerThreshold({ entity_type: 'MISC', score: 0.7 })).toBe(true);
    expect(nerThresholdForEntityType('MISC', 'bardsai')).toBe(0.7);
    expect(passesNerThreshold({ entity_type: 'MISC', score: 0.69 }, 'bardsai')).toBe(false);
    expect(passesNerThreshold({ entity_type: 'MISC', score: 0.7 }, 'bardsai')).toBe(true);
  });

  test('recovers byte offsets for uncased model output without start/end fields', () => {
    const text = 'Ada Lovelace works at Acme Corp in Berlin.';

    const spans = transformerOutputToSpans(text, [
      { entity_group: 'FIRSTNAME', score: 0.99, word: 'ada' },
      { entity_group: 'COMPANYNAME', score: 0.92, word: 'acme corp' },
      { entity_group: 'CITY', score: 0.94, word: 'berlin' },
    ], 'ai4privacy');

    expect(spans).toEqual([
      expect.objectContaining({ entity_type: 'PERSON', text: 'Ada' }),
      expect.objectContaining({ entity_type: 'ORGANIZATION', text: 'Acme Corp' }),
      expect.objectContaining({ entity_type: 'LOCATION', text: 'Berlin' }),
    ]);

    const adaStart = new TextEncoder().encode(text.slice(0, text.indexOf('Ada'))).length;
    const ada = spans.find((span) => span.text === 'Ada')!;
    expect(ada.start).toBe(adaStart);
    expect(ada.end).toBe(adaStart + new TextEncoder().encode('Ada').length);
  });

  test('recovers byte offsets for tokenized punctuation in model output', () => {
    const text =
      'Open https://portal.example/private with alice_admin. Password: P@ssw0rd123!';

    const spans = transformerOutputToSpans(text, [
      { entity_group: 'URL', score: 0.98, word: 'https : / / portal. example / private' },
      { entity_group: 'USERNAME', score: 0.98, word: 'alice _ admin' },
      { entity_group: 'PASSWORD', score: 0.88, word: 'p @ ssw0rd123' },
    ], 'ai4privacy');

    expect(spans).toEqual([
      expect.objectContaining({
        entity_type: 'URL',
        text: 'https://portal.example/private',
      }),
      expect.objectContaining({
        entity_type: 'USERNAME',
        text: 'alice_admin',
      }),
      expect.objectContaining({
        entity_type: 'PASSWORD',
        text: 'P@ssw0rd123',
      }),
    ]);
  });

  test('converts token-classification fixtures while ignoring unsupported labels', () => {
    const text = 'Ada works at Acme in Berlin. Passport X123.';

    const spans = transformerOutputToSpans(text, [
      { entity_group: 'PERSON_NAME', score: 0.8, word: 'Ada', start: 0, end: 3 },
      { entity_group: 'ORGANIZATION_NAME', score: 0.81, word: 'Acme', start: 13, end: 17 },
      { entity_group: 'LOCATION', score: 0.82, word: 'Berlin', start: 21, end: 27 },
      { entity_group: 'AGE', score: 0.99, word: 'works', start: 4, end: 9 },
      { entity_group: 'HEALTH_DATA', score: 0.94, word: 'X123', start: 38, end: 42 },
      { entity_group: 'HEALTH_DATA', score: 0.95, word: 'X123', start: 38, end: 42 },
    ]);

    expect(spans).toEqual([
      expect.objectContaining({ entity_type: 'PERSON', text: 'Ada', score: 0.8 }),
      expect.objectContaining({ entity_type: 'ORGANIZATION', text: 'Acme', score: 0.81 }),
      expect.objectContaining({ entity_type: 'LOCATION', text: 'Berlin', score: 0.82 }),
      expect.objectContaining({ entity_type: 'MISC', text: 'X123', score: 0.94 }),
      expect.objectContaining({ entity_type: 'MISC', text: 'X123', score: 0.95 }),
    ]);
    expect(spans).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ text: 'works' })])
    );
  });

  test('stitches adjacent BardsAI token fragments before thresholding', () => {
    const text = 'Email john@example.com and mention condition asthma.';

    const spans = transformerOutputToSpans(
      text,
      [
        { entity_group: 'EMAIL_ADDRESS', score: 0.99, word: 'joh' },
        { entity_group: 'EMAIL_ADDRESS', score: 0.98, word: 'n' },
        { entity_group: 'EMAIL_ADDRESS', score: 0.88, word: 'ex' },
        { entity_group: 'EMAIL_ADDRESS', score: 0.65, word: 'a' },
        { entity_group: 'EMAIL_ADDRESS', score: 0.56, word: 'mple' },
        { entity_group: 'EMAIL_ADDRESS', score: 0.27, word: '.' },
        { entity_group: 'EMAIL_ADDRESS', score: 0.38, word: 'com' },
        { entity_group: 'HEALTH_DATA', score: 0.72, word: 'asth' },
      ],
      'bardsai'
    );

    expect(applyNerThresholdPolicy(spans, 'bardsai')).toEqual([
      expect.objectContaining({ entity_type: 'EMAIL', text: 'john@example.com', score: 0.99 }),
      expect.objectContaining({ entity_type: 'MISC', text: 'asthma', score: 0.72 }),
    ]);
  });

  test('stitches adjacent HikmaAI street fragments into one ADDRESS span', () => {
    const text = 'Office at Andreas Hofer Weg 455 in Innsbruck.';

    const spans = transformerOutputToSpans(
      text,
      [
        { entity_group: 'STREET', score: 0.82, word: 'Andreas' },
        { entity_group: 'STREET', score: 0.78, word: 'Hofer Weg' },
        { entity_group: 'BUILDINGNUM', score: 0.91, word: '455' },
        { entity_group: 'CITY', score: 0.88, word: 'Innsbruck' },
      ],
      'hikmaai'
    );

    expect(spans).toEqual([
      expect.objectContaining({
        entity_type: 'ADDRESS',
        text: 'Andreas Hofer Weg 455',
        score: 0.91,
      }),
      expect.objectContaining({ entity_type: 'LOCATION', text: 'Innsbruck' }),
    ]);
  });

  test('stitches adjacent AI4Privacy person fragments into one PERSON span', () => {
    const text = 'Patient: Tsenka Azmira Deysing Burdack arrived today.';

    const spans = transformerOutputToSpans(
      text,
      [
        { entity_group: 'FIRSTNAME', score: 0.81, word: 'Tsenka' },
        { entity_group: 'MIDDLENAME', score: 0.74, word: 'Azmira' },
        { entity_group: 'MIDDLENAME', score: 0.72, word: 'Deysing' },
        { entity_group: 'LASTNAME', score: 0.86, word: 'Burdack' },
      ],
      'ai4privacy'
    );

    expect(spans).toEqual([
      expect.objectContaining({
        entity_type: 'PERSON',
        text: 'Tsenka Azmira Deysing Burdack',
        score: 0.86,
      }),
    ]);
  });
});

describe('production transformer NER provider', () => {
  const extensionUrl = (path: string) => `chrome-extension://test/${path}`;

  function makeEnv(): any {
    return {
      allowRemoteModels: true,
      allowLocalModels: false,
      localModelPath: '',
      useBrowserCache: true,
      useFSCache: true,
      useWasmCache: false,
      backends: { onnx: { wasm: {} } },
    };
  }

  afterEach(() => {
    resetNerProviderCachesForTests();
  });

  test('applies per-type NER threshold policy before returning spans', async () => {
    const env = makeEnv();
    const classifier = jest.fn().mockResolvedValue([
      // PERSON threshold 0.55 — Ada Smith passes at 0.6.
      { entity_group: 'PERSON_NAME', score: 0.6, word: 'Ada Smith', start: 0, end: 9 },
      // BardsAI MISC threshold 0.7 — weak health-data guess drops.
      { entity_group: 'HEALTH_DATA', score: 0.69, word: 'X123', start: 35, end: 39 },
    ]);
    const pipeline = jest.fn().mockResolvedValue(classifier);
    const provider = createTransformersNerProvider({
      getExtensionUrl: extensionUrl,
      assetExists: jest.fn().mockResolvedValue(true),
      loadTransformers: jest.fn().mockResolvedValue({ env, pipeline }),
    });

    const spans = await provider.detect('Ada Smith from Acme over BigCo has X123 here.');

    expect(spans).toEqual([
      expect.objectContaining({ entity_type: 'PERSON', text: 'Ada Smith', score: 0.6 }),
    ]);
  });

  test('produces all required entity types from a representative fixture', async () => {
    const text =
      'Ada Lovelace works in Berlin near 42 Cedar St. ' +
      'Login with alice_admin / hunter2pass; account 1234567890.';
    const env = makeEnv();
    const classifier = jest.fn().mockImplementation(async (input: string) => {
      const find = (needle: string) => {
        const start = input.indexOf(needle);
        return { start, end: start + needle.length };
      };
      return [
        { entity_group: 'PERSON_NAME', score: 0.95, word: 'Ada Lovelace', ...find('Ada Lovelace') },
        { entity_group: 'LOCATION', score: 0.92, word: 'Berlin', ...find('Berlin') },
        { entity_group: 'POSTAL_ADDRESS', score: 0.91, word: '42 Cedar St', ...find('42 Cedar St') },
        { entity_group: 'CONTACT_HANDLE', score: 0.9, word: 'alice_admin', ...find('alice_admin') },
        { entity_group: 'AUTH_SECRET', score: 0.88, word: 'hunter2pass', ...find('hunter2pass') },
        { entity_group: 'BANK_ACCOUNT_IDENTIFIER', score: 0.9, word: '1234567890', ...find('1234567890') },
      ];
    });
    const pipeline = jest.fn().mockResolvedValue(classifier);
    const provider = createTransformersNerProvider({
      getExtensionUrl: extensionUrl,
      assetExists: jest.fn().mockResolvedValue(true),
      loadTransformers: jest.fn().mockResolvedValue({ env, pipeline }),
    });

    const spans = await provider.detect(text);
    const types = spans.map((s) => s.entity_type).sort();

    expect(types).toEqual(
      ['ADDRESS', 'BANK_ACCOUNT', 'LOCATION', 'PASSWORD', 'PERSON', 'USERNAME']
    );

    const person = spans.find((s) => s.entity_type === 'PERSON')!;
    const personStart = new TextEncoder().encode(text.slice(0, text.indexOf('Ada Lovelace'))).length;
    expect(person.start).toBe(personStart);
    expect(person.text).toBe('Ada Lovelace');
    expect(person.source).toBe('ner');
  });

  test('applyNerThresholdPolicy filters spans below per-type thresholds', () => {
    const filtered = applyNerThresholdPolicy([
      { start: 0, end: 3, entity_type: 'PERSON', score: 0.5, text: 'Ada', source: 'ner' },
      { start: 4, end: 9, entity_type: 'PERSON', score: 0.6, text: 'Smith', source: 'ner' },
      { start: 10, end: 13, entity_type: 'MISC', score: 0.85, text: 'XYZ', source: 'ner' },
      { start: 14, end: 17, entity_type: 'MISC', score: 0.92, text: 'ABC', source: 'ner' },
    ]);
    expect(filtered.map((s) => s.text)).toEqual(['Smith', 'XYZ', 'ABC']);
  });

  test('chunks long text with overlap and byte offsets', () => {
    const text = `Intro ${'x'.repeat(30)} Anna Müller works here.`;
    const chunks = chunkTextForNer(text, { maxChunkChars: 24, overlapChars: 8 });

    expect(chunks.length).toBeGreaterThan(1);
    for (let index = 1; index < chunks.length; index += 1) {
      expect(chunks[index].startChar).toBeLessThan(chunks[index - 1].endChar);
      expect(chunks[index].startByte).toBe(
        new TextEncoder().encode(text.slice(0, chunks[index].startChar)).length
      );
      expect(chunks[index].endByte).toBe(
        new TextEncoder().encode(text.slice(0, chunks[index].endChar)).length
      );
    }
  });

  test('shifts chunked transformer spans and merges overlap duplicates predictably', async () => {
    const text = `Eve ${'x'.repeat(20)} Ada Lovelace works near Berlin.`;
    const env = makeEnv();
    const classifier = jest.fn().mockImplementation(async (input: string) => {
      const items: any[] = [];
      const add = (word: string, entity_group: string, score: number) => {
        const start = input.indexOf(word);
        if (start !== -1) {
          items.push({ entity_group, score, word, start, end: start + word.length });
        }
      };

      add('Eve', 'PERSON_NAME', 0.95);
      add('Ada Lovelace', 'PERSON_NAME', 0.95);
      add('Berlin', 'LOCATION', 0.92);
      return items;
    });
    const pipeline = jest.fn().mockResolvedValue(classifier);
    const provider = createTransformersNerProvider({
      getExtensionUrl: extensionUrl,
      assetExists: jest.fn().mockResolvedValue(true),
      loadTransformers: jest.fn().mockResolvedValue({ env, pipeline }),
      chunking: { maxChunkChars: 30, overlapChars: 20 },
    });

    const spans = await provider.detect(text);

    expect(classifier.mock.calls.length).toBeGreaterThan(1);
    expect(spans.map((span) => span.text)).toEqual([
      'Eve',
      'Ada Lovelace',
      'Berlin',
    ]);
    const ada = spans.find((span) => span.text === 'Ada Lovelace')!;
    const adaStart = new TextEncoder().encode(text.slice(0, text.indexOf('Ada Lovelace'))).length;
    expect(ada.start).toBe(adaStart);
    expect(ada.end).toBe(adaStart + new TextEncoder().encode('Ada Lovelace').length);

    const timing = provider.getLastTiming?.();
    expect(timing).toEqual(
      expect.objectContaining({
        wasCold: true,
        chunkCount: expect.any(Number),
        loadMs: expect.any(Number),
        inferenceMs: expect.any(Number),
        totalMs: expect.any(Number),
      })
    );
    expect(timing!.chunkCount!).toBeGreaterThan(1);
    expect(classifier).toHaveBeenCalledTimes(timing!.chunkCount!);

    await provider.detect(text);
    expect(provider.getLastTiming?.()).toEqual(expect.objectContaining({ wasCold: false }));
  });

  test('mergeOverlappingNerSpans keeps stronger same-type chunk results', () => {
    const merged = mergeOverlappingNerSpans([
      { start: 10, end: 18, entity_type: 'PERSON', score: 0.7, text: 'Lovelace', source: 'ner' },
      { start: 6, end: 18, entity_type: 'PERSON', score: 0.7, text: 'Ada Lovelace', source: 'ner' },
      { start: 30, end: 39, entity_type: 'LOCATION', score: 0.8, text: 'Berlin', source: 'ner' },
      { start: 30, end: 39, entity_type: 'LOCATION', score: 0.9, text: 'Berlin', source: 'ner' },
    ]);

    expect(merged).toEqual([
      expect.objectContaining({ text: 'Ada Lovelace', entity_type: 'PERSON' }),
      expect.objectContaining({ text: 'Berlin', entity_type: 'LOCATION', score: 0.9 }),
    ]);
  });
});
