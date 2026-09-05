import {
  alignedTokensToSpans,
  applyNerThresholdPolicy,
  chunkTextByTokens,
  createTransformersNerProvider,
  resetNerProviderCachesForTests,
  type NerTokenizerLike,
  type TokenClassificationItem,
} from '../../src/offscreen/ner-provider';
import { alignTokensToText } from '../../src/offscreen/token-offsets';
import { sliceTextByByteOffsets } from '../../src/shared/text-offsets';

/**
 * The token list, indices, labels and scores below are the genuine output of
 * the BardsAI q4f16 model on this exact text, captured so the test pins real
 * behaviour rather than an idealised guess. Two properties matter:
 */
const THREAD_TEXT =
  'Von: Max Muster max.muster@example.invalid\n' +
  'Cc: Erika Beispiel <erika.beispiel@example.invalid>, Klaus Muster <klaus.muster@example.invalid>\n' +
  'Letzte Rückmeldung bis Freitag! Der Termin fällt leider aus und kommt frühestens im Oktober wieder.\n' +
  'Schreibt lieber an t.tester@example.invalid.';

const THREAD_PIECES = ['<s>','▁Von',':','▁Max','▁Must','er','▁max','.','mu','ster','@','ex','a','mple','.','in','vali','d','▁C','c',':','▁Erik','a','▁Beispiel','▁<','e','rika','.','bei','spiel','@','ex','a','mple','.','in','vali','d','>',',','▁Klaus','▁Must','er','▁<','klaus','.','mu','ster','@','ex','a','mple','.','in','vali','d','>','▁Letzte','▁Rück','meldung','▁bis','▁Freitag','!','▁Der','▁Termin','▁fällt','▁leider','▁aus','▁und','▁kommt','▁früh','esten','s','▁im','▁Oktober','▁wieder','.','▁Schreib','t','▁lieber','▁an','▁t','.','te','ster','@','ex','a','mple','.','in','vali','d','.','</s>'];

const THREAD_OUTPUT: TokenClassificationItem[] = ([
  [3,'B-PERSON_NAME',1],[4,'I-PERSON_NAME',1],[5,'I-PERSON_NAME',1],
  [6,'B-EMAIL_ADDRESS',0.994],[7,'B-EMAIL_ADDRESS',0.491],[8,'B-EMAIL_ADDRESS',0.986],[9,'B-EMAIL_ADDRESS',0.959],
  [11,'B-ORGANIZATION_NAME',0.993],[12,'I-ORGANIZATION_NAME',0.938],[13,'I-ORGANIZATION_NAME',0.982],[14,'I-ORGANIZATION_NAME',0.978],[15,'I-ORGANIZATION_NAME',0.992],[16,'I-ORGANIZATION_NAME',0.995],[17,'I-ORGANIZATION_NAME',0.993],
  [21,'B-PERSON_NAME',0.999],[22,'I-PERSON_NAME',0.997],[23,'I-PERSON_NAME',0.999],
  [25,'B-EMAIL_ADDRESS',0.963],[26,'B-EMAIL_ADDRESS',0.943],[28,'B-EMAIL_ADDRESS',0.839],[29,'B-EMAIL_ADDRESS',0.835],
  [31,'B-ORGANIZATION_NAME',0.981],[32,'I-ORGANIZATION_NAME',0.799],[33,'I-ORGANIZATION_NAME',0.956],[34,'I-ORGANIZATION_NAME',0.963],[35,'I-ORGANIZATION_NAME',0.981],[36,'I-ORGANIZATION_NAME',0.986],[37,'I-ORGANIZATION_NAME',0.984],
  [40,'B-PERSON_NAME',1],[41,'I-PERSON_NAME',1],[42,'I-PERSON_NAME',1],
  [44,'B-EMAIL_ADDRESS',0.989],[45,'B-EMAIL_ADDRESS',0.394],[46,'B-EMAIL_ADDRESS',0.928],[47,'B-EMAIL_ADDRESS',0.84],
  [49,'B-ORGANIZATION_NAME',0.987],[50,'B-ORGANIZATION_NAME',0.553],[51,'I-ORGANIZATION_NAME',0.941],[52,'I-ORGANIZATION_NAME',0.982],[53,'I-ORGANIZATION_NAME',0.987],[54,'I-ORGANIZATION_NAME',0.989],[55,'I-ORGANIZATION_NAME',0.989],
  [81,'B-EMAIL_ADDRESS',0.984],[82,'B-EMAIL_ADDRESS',0.718],[83,'B-EMAIL_ADDRESS',0.979],[84,'B-EMAIL_ADDRESS',0.916],
  [86,'B-ORGANIZATION_NAME',0.98],[87,'B-ORGANIZATION_NAME',0.7],[88,'I-ORGANIZATION_NAME',0.931],[89,'I-ORGANIZATION_NAME',0.965],[90,'I-ORGANIZATION_NAME',0.987],[91,'I-ORGANIZATION_NAME',0.99],[92,'I-ORGANIZATION_NAME',0.987],
] as [number, string, number][]).map(([index, entity, score]) => ({
  index,
  entity,
  score,
  word: THREAD_PIECES[index],
}));

function spansForThread() {
  const ranges = alignTokensToText(THREAD_TEXT, THREAD_PIECES);
  return alignedTokensToSpans(THREAD_TEXT, THREAD_OUTPUT, ranges, 'bardsai');
}

describe('alignedTokensToSpans — mislocated-span regression', () => {
  const shown = applyNerThresholdPolicy(spansForThread(), 'bardsai');
  const texts = shown.map((span) => span.text);

  test('the fixture really does contain a one-character address fragment', () => {
    // Guards the fixture itself: if a future capture loses this shape, the
    // regression below stops testing anything.
    expect(THREAD_PIECES[81]).toBe('▁t');
    expect(THREAD_OUTPUT.find((item) => item.index === 81)?.entity).toBe('B-EMAIL_ADDRESS');
  });

  test('the model labels the German words O, so no span may cover them', () => {
    const labelled = new Set(THREAD_OUTPUT.map((item) => item.index));
    expect(labelled.has(65)).toBe(false); // ▁fällt
    expect(labelled.has(75)).toBe(false); // ▁wieder

    expect(texts).not.toContain('fällt');
    expect(texts).not.toContain('wieder');
    expect(texts.some((text) => /fällt|wieder|leider|Oktober|Termin|Rückmeldung/.test(text))).toBe(false);
  });

  test('recovers each address in full, local part and domain together', () => {
    expect(texts).toEqual(
      expect.arrayContaining([
        'max.muster@example.invalid',
        'erika.beispiel@example.invalid',
        'klaus.muster@example.invalid',
        't.tester@example.invalid',
      ])
    );
  });

  test('keeps the people separate instead of gluing them across the comma', () => {
    expect(texts).toEqual(expect.arrayContaining(['Max Muster', 'Erika Beispiel', 'Klaus Muster']));
    expect(texts).not.toContain('Erika Beispiel, Klaus Muster');
  });

  test('never runs a span across a line break', () => {
    for (const span of shown) {
      expect(span.text).not.toContain('\n');
    }
  });

  test('every byte offset round-trips to the span text', () => {
    for (const span of shown) {
      expect(sliceTextByByteOffsets(THREAD_TEXT, span.start, span.end)).toBe(span.text);
    }
  });

  test('scores the span from its opening token, keeping real addresses above the 0.80 gate', () => {
    const email = shown.find((span) => span.text === 'max.muster@example.invalid')!;
    // Member scores are [0.994, 0.491, 0.986, 0.959, …]; the mean would sit
    // under the EMAIL threshold and drop a genuine address.
    expect(email.score).toBeCloseTo(0.994, 3);
    expect(email.entity_type).toBe('EMAIL');
  });

  test('nothing is lost to the threshold gate on clean input', () => {
    expect(spansForThread()).toHaveLength(shown.length);
  });
});

describe('alignedTokensToSpans — grouping rules', () => {
  function build(text: string, tokens: string[], labels: Record<number, [string, number]>) {
    const ranges = alignTokensToText(text, tokens);
    const output: TokenClassificationItem[] = Object.entries(labels).map(([index, [entity, score]]) => ({
      index: Number(index),
      entity,
      score,
      word: tokens[Number(index)],
    }));
    return alignedTokensToSpans(text, output, ranges, 'bardsai');
  }

  test('joins flush sub-word pieces into one span', () => {
    const text = 'Kontakt max.muster@example.invalid';
    const tokens = ['▁Kontakt', '▁max', '.', 'mu', 'ster', '@', 'ex', 'a', 'mple', '.', 'in', 'vali', 'd'];
    const spans = build(text, tokens, {
      1: ['B-EMAIL_ADDRESS', 0.99], 2: ['B-EMAIL_ADDRESS', 0.5], 3: ['B-EMAIL_ADDRESS', 0.6],
      4: ['B-EMAIL_ADDRESS', 0.6], 5: ['B-EMAIL_ADDRESS', 0.6], 6: ['B-EMAIL_ADDRESS', 0.9],
      7: ['B-EMAIL_ADDRESS', 0.9], 8: ['B-EMAIL_ADDRESS', 0.9], 9: ['B-EMAIL_ADDRESS', 0.9],
      10: ['B-EMAIL_ADDRESS', 0.9], 11: ['B-EMAIL_ADDRESS', 0.9], 12: ['B-EMAIL_ADDRESS', 0.9],
    });

    expect(spans).toEqual([
      expect.objectContaining({ entity_type: 'EMAIL', text: 'max.muster@example.invalid', score: 0.99 }),
    ]);
  });

  test('joins multi-word names across a single space', () => {
    const text = 'Cc: Erika Beispiel, Klaus Muster';
    const tokens = ['▁C', 'c', ':', '▁Erik', 'a', '▁Beispiel', ',', '▁Klaus', '▁Must', 'er'];
    const spans = build(text, tokens, {
      3: ['B-PERSON_NAME', 0.99], 4: ['I-PERSON_NAME', 0.98], 5: ['I-PERSON_NAME', 0.98],
      7: ['B-PERSON_NAME', 0.97], 8: ['I-PERSON_NAME', 0.96], 9: ['I-PERSON_NAME', 0.96],
    });

    expect(spans).toEqual([
      expect.objectContaining({ entity_type: 'PERSON', text: 'Erika Beispiel' }),
      expect.objectContaining({ entity_type: 'PERSON', text: 'Klaus Muster' }),
    ]);
  });

  test('stitches an EMAIL local part onto the ORGANIZATION the model made of its domain', () => {
    const text = 'Mail an t.tester@example.invalid bitte';
    const tokens = ['▁Mail', '▁an', '▁t', '.', 'te', 'ster', '@', 'ex', 'a', 'mple', '.', 'in', 'vali', 'd', '▁bitte'];
    const spans = build(text, tokens, {
      2: ['B-EMAIL_ADDRESS', 0.98], 3: ['B-EMAIL_ADDRESS', 0.72], 4: ['B-EMAIL_ADDRESS', 0.98],
      5: ['B-EMAIL_ADDRESS', 0.92], 6: ['B-EMAIL_ADDRESS', 0.9],
      7: ['B-ORGANIZATION_NAME', 0.95], 8: ['I-ORGANIZATION_NAME', 0.95], 9: ['I-ORGANIZATION_NAME', 0.95],
      10: ['I-ORGANIZATION_NAME', 0.95], 11: ['I-ORGANIZATION_NAME', 0.95], 12: ['I-ORGANIZATION_NAME', 0.95],
      13: ['I-ORGANIZATION_NAME', 0.95],
    });

    expect(spans).toEqual([
      expect.objectContaining({
        entity_type: 'EMAIL',
        text: 't.tester@example.invalid',
        score: 0.98,
      }),
    ]);
  });

  test('stitches across an unlabelled @ as well', () => {
    const text = 'An: verteiler-3@example.invalid';
    const tokens = ['▁An', ':', '▁verte', 'iler', '-3', '@', 'ex', 'a', 'mple', '.', 'in', 'vali', 'd'];
    const spans = build(text, tokens, {
      2: ['B-EMAIL_ADDRESS', 0.99], 3: ['B-EMAIL_ADDRESS', 0.6], 4: ['B-EMAIL_ADDRESS', 0.4],
      6: ['B-ORGANIZATION_NAME', 0.9], 7: ['I-ORGANIZATION_NAME', 0.9], 8: ['I-ORGANIZATION_NAME', 0.9],
      9: ['I-ORGANIZATION_NAME', 0.9], 10: ['I-ORGANIZATION_NAME', 0.9], 11: ['I-ORGANIZATION_NAME', 0.9],
      12: ['I-ORGANIZATION_NAME', 0.9],
    });

    expect(spans).toEqual([
      expect.objectContaining({ entity_type: 'EMAIL', text: 'verteiler-3@example.invalid' }),
    ]);
  });

  test('completes a half-labelled word but stops at a non-word boundary', () => {
    const text = 'Muster schrieb an max.muster@example.invalid';
    const tokens = ['▁Must', 'er', '▁schrieb', '▁an', '▁max', '.', 'mu', 'ster', '@', 'ex', 'a', 'mple', '.', 'in', 'vali', 'd'];
    const spans = build(text, tokens, {
      0: ['B-PERSON_NAME', 0.99],
      4: ['B-EMAIL_ADDRESS', 0.99], 5: ['B-EMAIL_ADDRESS', 0.6], 6: ['B-EMAIL_ADDRESS', 0.6],
      7: ['B-EMAIL_ADDRESS', 0.6], 8: ['B-EMAIL_ADDRESS', 0.6],
    });

    // `▁Must` alone is completed to the whole word...
    expect(spans[0]).toEqual(expect.objectContaining({ entity_type: 'PERSON', text: 'Muster' }));
    // ...but a span ending on `@` is not allowed to grow into the domain.
    expect(spans[1].text).toBe('max.muster@');
  });

  test('drops predictions whose token could not be placed', () => {
    const text = 'Erika Muster';
    const ranges = alignTokensToText(text, ['▁Erika', '▁Muster']);
    const spans = alignedTokensToSpans(
      text,
      [
        { index: 0, entity: 'B-PERSON_NAME', score: 0.99, word: '▁Erika' },
        { index: 7, entity: 'B-EMAIL_ADDRESS', score: 0.99, word: 'ghost' },
      ],
      ranges,
      'bardsai'
    );

    expect(spans).toEqual([expect.objectContaining({ text: 'Erika' })]);
  });

  test('ignores items with no index, which cannot be located', () => {
    const ranges = alignTokensToText('Erika Muster', ['▁Erika', '▁Muster']);
    expect(
      alignedTokensToSpans('Erika Muster', [{ entity_group: 'PERSON_NAME', score: 0.99, word: 'Erika' }], ranges)
    ).toEqual([]);
  });
});

describe('chunkTextByTokens', () => {
  /** Whitespace tokenizer that mimics Metaspace word-initial markers. */
  function stubTokenizer(modelMaxLength?: number): NerTokenizerLike {
    return {
      model_max_length: modelMaxLength,
      tokenize(text: string): string[] {
        return text.split(/(\s+)/).filter((part) => part.trim().length > 0).map((word) => `▁${word}`);
      },
    };
  }

  test('returns a single chunk when the text fits the token budget', () => {
    const text = 'Erika Muster schreibt an info@example.invalid';
    const chunks = chunkTextByTokens(text, stubTokenizer(512), { maxTokens: 100 })!;

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ text, startChar: 0, endChar: text.length, startByte: 0 });
  });

  test('splits on token boundaries and loses no source text', () => {
    const words = Array.from({ length: 200 }, (_, i) => `wort${i}`);
    const text = words.join(' ');
    const chunks = chunkTextByTokens(text, stubTokenizer(512), { maxTokens: 40, overlapTokens: 5 })!;

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text).toBe(text.slice(chunk.startChar, chunk.endChar));
      // A chunk boundary never lands inside a word.
      expect(chunk.text.trim().split(/\s+/).every((word) => words.includes(word))).toBe(true);
    }
    expect(chunks[0].startChar).toBe(0);
    expect(chunks[chunks.length - 1].endChar).toBe(text.length);
  });

  test('respects the encoder position limit rather than a character budget', () => {
    // 5000 characters of German is ~1470 tokens on this tokenizer — far past the
    // 512 positions the model actually reads.
    const text = Array.from({ length: 900 }, (_, i) => `begriff${i}`).join(' ');
    const chunks = chunkTextByTokens(text, stubTokenizer(512))!;

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.trim().split(/\s+/).length).toBeLessThanOrEqual(480);
    }
  });

  test('counts pieces the aligner could not place against the chunk budget', () => {
    // Every sixth word comes back as <unk>, which the aligner cannot place but
    // the encoder still charges a position for. Budgeting by placed tokens alone
    // let a nominal 40-token chunk carry ~48 real pieces.
    const unkTokenizer: NerTokenizerLike = {
      model_max_length: 512,
      tokenize(text: string): string[] {
        return text
          .split(/(\s+)/)
          .filter((part) => part.trim().length > 0)
          .map((word, index) => (index % 6 === 5 ? '<unk>' : `\u2581${word}`));
      },
    };

    const text = Array.from({ length: 300 }, (_, i) => `wort${i}`).join(' ');
    const chunks = chunkTextByTokens(text, unkTokenizer, { maxTokens: 40, overlapTokens: 5 })!;

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(unkTokenizer.tokenize(chunk.text).length).toBeLessThanOrEqual(40);
    }
    // and still no source character falls outside every chunk
    expect(chunks[0].startChar).toBe(0);
    expect(chunks[chunks.length - 1].endChar).toBe(text.length);
  });

  test('returns null when the tokenizer throws so the caller can fall back', () => {
    const throwing: NerTokenizerLike = {
      tokenize() {
        throw new Error('tokenizer unavailable');
      },
    };

    expect(chunkTextByTokens('some text', throwing)).toBeNull();
  });

  test('returns an empty plan for empty text', () => {
    expect(chunkTextByTokens('', stubTokenizer())).toEqual([]);
  });
});

describe('transformers provider — offset path selection', () => {
  const extensionUrl = (path: string) => `chrome-extension://test/${path}`;

  function makeEnv(): any {
    return {
      allowRemoteModels: true,
      allowLocalModels: false,
      localModelPath: '',
      useBrowserCache: true,
      useFSCache: true,
      useWasmCache: true,
      backends: { onnx: { wasm: {} } },
    };
  }

  beforeEach(() => {
    resetNerProviderCachesForTests();
  });

  test('asks for raw per-token output when a tokenizer is available to align with', async () => {
    const text = 'Mail an info@example.invalid';
    const classifier: any = jest.fn().mockResolvedValue([
      { index: 2, entity: 'B-EMAIL_ADDRESS', score: 0.99, word: '▁info' },
      { index: 3, entity: 'B-EMAIL_ADDRESS', score: 0.95, word: '@' },
      { index: 4, entity: 'B-EMAIL_ADDRESS', score: 0.95, word: 'example' },
      { index: 5, entity: 'B-EMAIL_ADDRESS', score: 0.95, word: '.' },
      { index: 6, entity: 'B-EMAIL_ADDRESS', score: 0.95, word: 'invalid' },
    ]);
    classifier.tokenizer = {
      model_max_length: 512,
      tokenize: () => ['▁Mail', '▁an', '▁info', '@', 'example', '.', 'invalid'],
    };

    const provider = createTransformersNerProvider({
      modelKey: 'bardsai',
      getExtensionUrl: extensionUrl,
      assetExists: jest.fn().mockResolvedValue(true),
      detectWebGpu: jest.fn().mockResolvedValue(false),
      loadTransformers: jest
        .fn()
        .mockResolvedValue({ env: makeEnv(), pipeline: jest.fn().mockResolvedValue(classifier) }),
    });

    const spans = await provider.detect(text);

    expect(classifier).toHaveBeenCalledWith(text, { aggregation_strategy: 'none' });
    expect(spans).toEqual([
      expect.objectContaining({ entity_type: 'EMAIL', text: 'info@example.invalid', score: 0.99 }),
    ]);
  });

  test('falls back to aggregated output when the pipeline exposes no tokenizer', async () => {
    const classifier: any = jest.fn().mockResolvedValue([]);

    const provider = createTransformersNerProvider({
      modelKey: 'bardsai',
      getExtensionUrl: extensionUrl,
      assetExists: jest.fn().mockResolvedValue(true),
      detectWebGpu: jest.fn().mockResolvedValue(false),
      loadTransformers: jest
        .fn()
        .mockResolvedValue({ env: makeEnv(), pipeline: jest.fn().mockResolvedValue(classifier) }),
    });

    await provider.detect('no pii here');

    expect(classifier).toHaveBeenCalledWith('no pii here', { aggregation_strategy: 'simple' });
  });
});
