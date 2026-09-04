import { alignTokensToText, alignmentCoverage } from '../../src/offscreen/token-offsets';


/** Slice `text` by every placed range, for readable assertions. */
function placed(text: string, tokens: string[]): (string | null)[] {
  return alignTokensToText(text, tokens).map((range) =>
    range ? text.slice(range.start, range.end) : null
  );
}

describe('alignTokensToText — SentencePiece / Metaspace (XLM-R)', () => {
  test('places every piece of a shredded address', () => {
    // The tokenizer tears one address into nine pieces, five of them one or two
    // characters — the shape that made the old indexOf recovery drift.
    const text = 'Von: Max Muster max.muster@example.invalid';
    const tokens = [
      '<s>', '▁Von', ':', '▁Max', '▁Must', 'er',
      '▁max', '.', 'mu', 'ster', '@', 'ex', 'a', 'mple', '.', 'in', 'vali', 'd', '</s>',
    ];

    expect(placed(text, tokens)).toEqual([
      null, 'Von', ':', 'Max', 'Must', 'er',
      'max', '.', 'mu', 'ster', '@', 'ex', 'a', 'mple', '.', 'in', 'vali', 'd', null,
    ]);
  });

  test('a one-character piece lands on its own character, not an earlier one', () => {
    // This is the reported bug in miniature. `▁t` is the whole local part of
    // t.tester@…; the letter `t` also appears inside `fällt` (15) and
    // `Schreibt` (29). A forward-only indexOf grabbed the one in `fällt` and
    // expanded it into the whole German word.
    const text = 'Der Termin fällt aus. Schreibt an t.tester@example.invalid';
    const tokens = [
      '▁Der', '▁Termin', '▁fällt', '▁aus', '.', '▁Schreib', 't', '▁an',
      '▁t', '.', 'te', 'ster', '@', 'ex', 'a', 'mple', '.', 'in', 'vali', 'd',
    ];
    const ranges = alignTokensToText(text, tokens);

    expect(text.charAt(15)).toBe('t'); // inside "fällt"
    expect(text.charAt(29)).toBe('t'); // end of "Schreibt"
    expect(text.charAt(34)).toBe('t'); // the local part

    expect(ranges[6]).toEqual({ start: 29, end: 30 }); // the `t` of Schreibt
    expect(ranges[8]).toEqual({ start: 34, end: 35 }); // the local part `t`
    expect(text.slice(ranges[2]!.start, ranges[2]!.end)).toBe('fällt');
  });

  test('distinguishes a piece that occurs twice in the same line', () => {
    const text = 'Max Muster max.muster@example.invalid';
    const tokens = ['▁Max', '▁Must', 'er', '▁max', '.', 'mu', 'ster', '@', 'ex', 'a', 'mple', '.', 'in', 'vali', 'd'];
    const ranges = alignTokensToText(text, tokens);

    // "Muster" the surname, then "muster" the local part — same folded text.
    expect(ranges[1]!.start).toBe(text.indexOf('Muster'));
    expect(ranges[5]!.start).toBe(text.indexOf('muster'));
    expect(ranges[1]!.start).toBeLessThan(ranges[5]!.start);
  });

  test('covers every non-whitespace character of the source text', () => {
    const text = 'Der Termin fällt leider aus und kommt frühestens im Oktober wieder.';
    const tokens = [
      '▁Der', '▁Termin', '▁fällt', '▁leider', '▁aus', '▁und', '▁kommt',
      '▁früh', 'esten', 's', '▁im', '▁Oktober', '▁wieder', '.',
    ];

    const covered = new Set<number>();
    for (const range of alignTokensToText(text, tokens)) {
      if (!range) continue;
      for (let i = range.start; i < range.end; i += 1) covered.add(i);
    }

    const missed = [...text].map((char, i) => (covered.has(i) || /\s/.test(char) ? '' : char)).join('');
    expect(missed).toBe('');
  });

  test('consumes runs of whitespace, tabs and newlines between words', () => {
    const text = 'Von:\tMax\n\nAn:   info@example.invalid';
    const tokens = ['▁Von', ':', '▁Max', '▁An', ':', '▁info', '@', 'ex', 'a', 'mple', '.', 'in', 'vali', 'd'];

    expect(placed(text, tokens)).toEqual([
      'Von', ':', 'Max', 'An', ':', 'info', '@', 'ex', 'a', 'mple', '.', 'in', 'vali', 'd',
    ]);
  });

  test('handles a metaspace-only piece, and keeps umlauts, quotes, currency and emoji aligned', () => {
    // `▁` alone stands for whitespace, not content: it consumes the space so the
    // next piece starts correctly, but claims no characters of its own.
    const text = 'Grüße 👋 „Testfall" — 12 € an Muster';
    const tokens = ['▁Grüße', '▁', '👋', '▁„', 'Test', 'fall', '"', '▁—', '▁12', '▁€', '▁an', '▁Must', 'er'];

    expect(placed(text, tokens)).toEqual([
      'Grüße', null, '👋', '„', 'Test', 'fall', '"', '—', '12', '€', 'an', 'Must', 'er',
    ]);
  });
});

describe('alignTokensToText — WordPiece (uncased DistilBERT)', () => {
  test('folds case and accents so uncased pieces map onto the original text', () => {
    const text = 'Erika Muster works at Muster GmbH';
    const tokens = ['[CLS]', 'erika', 'must', '##er', 'works', 'at', 'must', '##er', 'gmbh', '[SEP]'];

    expect(placed(text, tokens)).toEqual([
      null, 'Erika', 'Must', 'er', 'works', 'at', 'Must', 'er', 'GmbH', null,
    ]);
  });

  test('accent-stripped pieces still land on the accented original', () => {
    const text = 'Erika Müller';
    const tokens = ['erika', 'mu', '##ller'];

    expect(placed(text, tokens)).toEqual(['Erika', 'Mü', 'ller']);
  });

  test('continuation pieces attach without consuming whitespace', () => {
    const text = 'test_user logged in';
    const tokens = ['test', '##_', '##user', 'logged', 'in'];

    expect(placed(text, tokens)).toEqual(['test', '_', 'user', 'logged', 'in']);
  });
});

describe('alignTokensToText — resilience', () => {
  test('resyncs after an unknown token rather than derailing the rest of the sequence', () => {
    const text = 'Kontakt ⛾ info@example.invalid heute';
    const tokens = ['▁Kontakt', '<unk>', '▁info', '@', 'ex', 'a', 'mple', '.', 'in', 'vali', 'd', '▁heute'];

    expect(placed(text, tokens)).toEqual([
      'Kontakt', null, 'info', '@', 'ex', 'a', 'mple', '.', 'in', 'vali', 'd', 'heute',
    ]);
  });

  test('reports coverage so callers can refuse to trust a bad alignment', () => {
    const text = 'Erika Muster';
    const good = alignTokensToText(text, ['▁Erika', '▁Muster']);
    const bad = alignTokensToText(text, ['▁Zzz', '▁Qqq', '▁Www']);

    expect(alignmentCoverage(good)).toBe(1);
    expect(alignmentCoverage(bad)).toBeLessThan(0.8);
  });

  test('returns an empty result for empty input', () => {
    expect(alignTokensToText('', [])).toEqual([]);
    expect(alignmentCoverage([])).toBe(1);
  });
});
