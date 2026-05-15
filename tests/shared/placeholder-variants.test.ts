/**
 * Unit tests for the placeholder variant matcher. These exercise every
 * accepted variant form and the negative / boundary rules described in
 * `docs/prd-placeholder-restoration-robustness.md`. New mangling forms
 * observed in the wild should be added here as permanent regressions.
 */

import {
  buildVariantRegex,
  findVariantMatches,
  hasPotentialPlaceholderShape,
  parsePlaceholder,
} from '../../src/shared/placeholder-variants';

describe('parsePlaceholder', () => {
  test('parses canonical placeholders', () => {
    expect(parsePlaceholder('[PERSON_1]')).toEqual({ type: 'PERSON', index: 1 });
    expect(parsePlaceholder('[EMAIL_12]')).toEqual({ type: 'EMAIL', index: 12 });
    expect(parsePlaceholder('[BANK_ACCOUNT_3]')).toEqual({
      type: 'BANK_ACCOUNT',
      index: 3,
    });
  });

  test('rejects synthetic and arbitrary keys', () => {
    expect(parsePlaceholder('Jordan Park')).toBeNull();
    expect(parsePlaceholder('[person_1]')).toBeNull();
    expect(parsePlaceholder('PERSON_1')).toBeNull();
    expect(parsePlaceholder('[PERSON_1')).toBeNull();
    expect(parsePlaceholder('[1_PERSON]')).toBeNull();
  });
});

describe('buildVariantRegex', () => {
  const accepted: { canonical: string; variants: string[] }[] = [
    {
      canonical: '[PERSON_1]',
      variants: [
        '[PERSON_1]',
        '[PERSON 1]',
        'PERSON_1',
        'PERSON 1',
        '[person_1]',
        '[PERSON1]',
        'PERSON1',
        '[PERSON_1',
        'PERSON_1]',
      ],
    },
    {
      canonical: '[EMAIL_2]',
      variants: ['[EMAIL_2]', 'EMAIL_2', 'email 2', '[EMAIL2]', 'Email_2'],
    },
    {
      canonical: '[PHONE_3]',
      variants: ['[PHONE_3]', 'PHONE 3', 'PHONE3', '[phone_3]'],
    },
  ];

  for (const { canonical, variants } of accepted) {
    test(`accepts every documented variant of ${canonical}`, () => {
      const regex = buildVariantRegex(canonical);
      for (const v of variants) {
        const re = new RegExp(regex.source, regex.flags);
        expect(re.test(v)).toBe(true);
      }
    });
  }
});

describe('findVariantMatches — accepted variants', () => {
  test('matches each documented variant when the canonical is known', () => {
    const known = ['[PERSON_1]'];
    const samples = [
      'Hi [PERSON_1] here',
      'Hi [PERSON 1] here',
      'Hi PERSON_1 here',
      'Hi PERSON 1 here',
      'Hi [person_1] here',
      'Hi [PERSON1] here',
      'Hi PERSON1 here',
      'Hi [PERSON_1 here',
      'Hi PERSON_1] here',
    ];
    for (const s of samples) {
      const matches = findVariantMatches(s, known);
      expect(matches).toHaveLength(1);
      expect(matches[0].canonical).toBe('[PERSON_1]');
    }
  });
});

describe('findVariantMatches — negative cases', () => {
  test('unknown index does not match', () => {
    const known = ['[PERSON_1]'];
    expect(findVariantMatches('Hi [PERSON_99] there', known)).toEqual([]);
    expect(findVariantMatches('Hi PERSON_99 there', known)).toEqual([]);
  });

  test('multi-digit boundary trap — PERSON_10 is not matched as PERSON_1', () => {
    const known = ['[PERSON_1]'];
    expect(findVariantMatches('We saw PERSON_10 yesterday', known)).toEqual([]);
    expect(findVariantMatches('We saw PERSON 10 yesterday', known)).toEqual([]);
    expect(findVariantMatches('We saw [PERSON_10] yesterday', known)).toEqual([]);
  });

  test('type-suffix collision — GMAILEMAIL_1 does not match EMAIL_1', () => {
    const known = ['[EMAIL_1]'];
    expect(findVariantMatches('Send to GMAILEMAIL_1 now', known)).toEqual([]);
  });

  test('all-caps non-type tokens are never matched', () => {
    const known = ['[PERSON_1]', '[EMAIL_1]'];
    expect(findVariantMatches('See ASCII_1 and HTTP_2', known)).toEqual([]);
    expect(findVariantMatches('See ASCII1 and HTTP2', known)).toEqual([]);
  });

  test('letter immediately after the index rejects bracket-less match', () => {
    const known = ['[PERSON_1]'];
    expect(findVariantMatches('PERSON_1A is here', known)).toEqual([]);
    expect(findVariantMatches('PERSON1A is here', known)).toEqual([]);
  });

  test('letter immediately before the type rejects bracket-less match', () => {
    const known = ['[PERSON_1]'];
    expect(findVariantMatches('XPERSON_1 is here', known)).toEqual([]);
  });
});

describe('findVariantMatches — boundary cases', () => {
  test('possessive trailing apostrophe', () => {
    const known = ['[PERSON_1]'];
    const matches = findVariantMatches("PERSON_1's friend", known);
    expect(matches).toHaveLength(1);
    expect(matches[0].matchText).toBe('PERSON_1');
  });

  test('trailing punctuation', () => {
    const known = ['[PERSON_1]'];
    for (const punct of ['.', ',', '!', '?', ';', ':']) {
      const matches = findVariantMatches(`Hi PERSON_1${punct}`, known);
      expect(matches).toHaveLength(1);
      expect(matches[0].matchText).toBe('PERSON_1');
    }
  });

  test('sentence start, parenthesised, quoted', () => {
    const known = ['[PERSON_1]'];
    expect(findVariantMatches('PERSON_1 said hi.', known)).toHaveLength(1);
    expect(findVariantMatches('(PERSON_1) said hi.', known)).toHaveLength(1);
    expect(findVariantMatches('"PERSON_1" said hi.', known)).toHaveLength(1);
  });
});

describe('findVariantMatches — apply-safe order', () => {
  test('mixed forms in a single text are returned in start order', () => {
    const known = ['[PERSON_1]', '[EMAIL_1]'];
    const text = 'PERSON 1 wrote to email_1 about [PERSON_1].';
    const matches = findVariantMatches(text, known);
    expect(matches.map((m) => m.matchText)).toEqual([
      'PERSON 1',
      'email_1',
      '[PERSON_1]',
    ]);
    for (let i = 1; i < matches.length; i += 1) {
      expect(matches[i].start).toBeGreaterThanOrEqual(matches[i - 1].end);
    }
  });

  test('longest-index wins on overlap — PERSON_12 over PERSON_1', () => {
    const known = ['[PERSON_1]', '[PERSON_12]'];
    const text = 'Yesterday PERSON 12 met PERSON_1.';
    const matches = findVariantMatches(text, known);
    expect(matches.map((m) => m.canonical)).toEqual([
      '[PERSON_12]',
      '[PERSON_1]',
    ]);
    expect(matches[0].matchText).toBe('PERSON 12');
    expect(matches[1].matchText).toBe('PERSON_1');
  });
});

describe('hasPotentialPlaceholderShape', () => {
  test('triggers on canonical and mangled forms', () => {
    expect(hasPotentialPlaceholderShape('[PERSON_1]')).toBe(true);
    expect(hasPotentialPlaceholderShape('PERSON_1')).toBe(true);
    expect(hasPotentialPlaceholderShape('PERSON 1')).toBe(true);
    expect(hasPotentialPlaceholderShape('PERSON1')).toBe(true);
  });

  test('ignores plain prose', () => {
    expect(hasPotentialPlaceholderShape('Just a sentence.')).toBe(false);
    expect(hasPotentialPlaceholderShape('A1')).toBe(false);
  });
});
