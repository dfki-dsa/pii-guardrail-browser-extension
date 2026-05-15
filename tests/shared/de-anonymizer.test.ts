import { deAnonymize, findPlaceholders, hasPlaceholders } from '../../src/shared/de-anonymizer';
import { EntityMap } from '../../src/shared/entity-map';
import type { PiiSpan } from '../../src/shared/message-types';

function makeSpan(entityType: string, text: string): PiiSpan {
  return {
    start: 0,
    end: text.length,
    entity_type: entityType as any,
    score: 0.9,
    text,
    source: 'regex',
  };
}

describe('deAnonymize', () => {
  test('replaces placeholders with original values', () => {
    const map = new EntityMap();
    map.add(makeSpan('PERSON', 'David'));
    map.add(makeSpan('EMAIL', 'david@corp.com'));

    const text = 'Hello [PERSON_1], your email is [EMAIL_1].';
    const result = deAnonymize(text, map);
    expect(result).toBe('Hello David, your email is david@corp.com.');
  });

  test('preserves unknown placeholders', () => {
    const map = new EntityMap();
    const text = 'Hello [PERSON_99]';
    const result = deAnonymize(text, map);
    expect(result).toBe('Hello [PERSON_99]');
  });

  test('handles text with no placeholders', () => {
    const map = new EntityMap();
    const result = deAnonymize('Hello world', map);
    expect(result).toBe('Hello world');
  });

  test('handles multiple same-type placeholders', () => {
    const map = new EntityMap();
    map.add(makeSpan('PERSON', 'Alice'));
    map.add(makeSpan('PERSON', 'Bob'));

    const text = '[PERSON_1] met [PERSON_2] at the park';
    const result = deAnonymize(text, map);
    expect(result).toBe('Alice met Bob at the park');
  });

  test('replaces new NER entity placeholders with original values', () => {
    const map = new EntityMap();
    map.add(makeSpan('ADDRESS', '42 Cedar St'));
    map.add(makeSpan('URL', 'https://portal.example/private'));
    map.add(makeSpan('USERNAME', 'alice_admin'));
    map.add(makeSpan('PASSWORD', 'correct-horse'));
    map.add(makeSpan('BANK_ACCOUNT', '1234567890'));

    const text =
      'Use [URL_1] for [USERNAME_1] at [ADDRESS_1]; password [PASSWORD_1], account [BANK_ACCOUNT_1].';
    const result = deAnonymize(text, map);

    expect(result).toBe(
      'Use https://portal.example/private for alice_admin at 42 Cedar St; password correct-horse, account 1234567890.'
    );
  });
});

describe('findPlaceholders', () => {
  test('finds all placeholders in text', () => {
    const text = '[PERSON_1] emailed [EMAIL_1] about [LOCATION_2]';
    const result = findPlaceholders(text);
    expect(result).toEqual(['[PERSON_1]', '[EMAIL_1]', '[LOCATION_2]']);
  });

  test('finds placeholders for new NER entity types', () => {
    const text = '[ADDRESS_1] [URL_1] [USERNAME_1] [PASSWORD_1] [BANK_ACCOUNT_1]';
    const result = findPlaceholders(text);
    expect(result).toEqual([
      '[ADDRESS_1]',
      '[URL_1]',
      '[USERNAME_1]',
      '[PASSWORD_1]',
      '[BANK_ACCOUNT_1]',
    ]);
  });

  test('returns empty array for no placeholders', () => {
    expect(findPlaceholders('Hello world')).toEqual([]);
  });
});

describe('hasPlaceholders', () => {
  test('returns true when placeholders present', () => {
    expect(hasPlaceholders('Hello [PERSON_1]')).toBe(true);
  });

  test('returns true on repeated calls with placeholder text', () => {
    expect(hasPlaceholders('Hello [PERSON_1]')).toBe(true);
    expect(hasPlaceholders('Hello [PERSON_1]')).toBe(true);
  });

  test('returns false when no placeholders', () => {
    expect(hasPlaceholders('Hello world')).toBe(false);
  });

  test('returns false for bracket-like text that is not a placeholder', () => {
    expect(hasPlaceholders('[not a placeholder]')).toBe(false);
  });

  test('strict semantics — mangled placeholders are not flagged', () => {
    // Mangled forms must NOT trip the strict canonical check; tolerant
    // detection lives in `placeholder-variants.findVariantMatches`.
    expect(hasPlaceholders('PERSON_1')).toBe(false);
    expect(hasPlaceholders('PERSON 1')).toBe(false);
    expect(hasPlaceholders('[person_1]')).toBe(false);
  });
});

describe('deAnonymize — mangled placeholder restoration', () => {
  test('restores LLM-mangled variants gated by the entity map', () => {
    const map = new EntityMap();
    map.add(makeSpan('PERSON', 'David'));
    map.add(makeSpan('EMAIL', 'david@corp.com'));

    const cases: { text: string; expected: string }[] = [
      { text: 'Hi PERSON_1!', expected: 'Hi David!' },
      { text: 'Hi PERSON 1!', expected: 'Hi David!' },
      { text: 'Hi [PERSON 1]!', expected: 'Hi David!' },
      { text: 'Hi [person_1]!', expected: 'Hi David!' },
      { text: 'Hi PERSON1!', expected: 'Hi David!' },
      { text: 'Hi [PERSON_1!', expected: 'Hi David!' },
      { text: 'Hi PERSON_1]!', expected: 'Hi David!' },
      {
        text: 'Mail email_1, then [EMAIL_1] again',
        expected: 'Mail david@corp.com, then david@corp.com again',
      },
    ];
    for (const { text, expected } of cases) {
      expect(deAnonymize(text, map)).toBe(expected);
    }
  });

  test('mixes canonical and mangled placeholders in one response', () => {
    const map = new EntityMap();
    map.add(makeSpan('PERSON', 'Alice'));
    map.add(makeSpan('EMAIL', 'alice@test.com'));
    const text = 'PERSON 1 wrote to email_1 about [PERSON_1].';
    expect(deAnonymize(text, map)).toBe(
      'Alice wrote to alice@test.com about Alice.',
    );
  });

  test('longest-index wins — PERSON_12 over PERSON_1', () => {
    const map = new EntityMap();
    // Force per-type counter so we get PERSON_1 and PERSON_12 (skip 2-11)
    for (let i = 0; i < 12; i += 1) {
      map.add(makeSpan('PERSON', `Person${i + 1}`));
    }
    const text = 'Talk to PERSON 12 about PERSON_1.';
    expect(deAnonymize(text, map)).toBe('Talk to Person12 about Person1.');
  });

  test('ignores arbitrary all-caps tokens that are not in the map', () => {
    const map = new EntityMap();
    map.add(makeSpan('PERSON', 'David'));
    expect(deAnonymize('See HTTP_2, ASCII_1, GMAIL_OAUTH_1', map)).toBe(
      'See HTTP_2, ASCII_1, GMAIL_OAUTH_1',
    );
  });

  test('rejects type-suffix collisions and digit-bleed', () => {
    const map = new EntityMap();
    map.add(makeSpan('EMAIL', 'foo@bar.com'));
    map.add(makeSpan('PERSON', 'David'));
    // GMAILEMAIL_1 must not match EMAIL_1 (left side is a letter)
    expect(deAnonymize('Send to GMAILEMAIL_1', map)).toBe(
      'Send to GMAILEMAIL_1',
    );
    // PERSON_10 must not partially restore PERSON_1
    expect(deAnonymize('We saw PERSON_10', map)).toBe('We saw PERSON_10');
  });

  test('returns text unchanged when entity map is empty', () => {
    const map = new EntityMap();
    expect(deAnonymize('Hi PERSON_1', map)).toBe('Hi PERSON_1');
  });
});

describe('hasReversibleContent — mangled detection', () => {
  // Imported lazily to keep the existing test file's surface intact.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { hasReversibleContent } = require('../../src/shared/de-anonymizer');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { emptyVaultData } = require('../../src/shared/identity-vault');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { anonymizeWithVault } = require('../../src/shared/anonymizer');

  test('flags responses whose only reversible content is a mangled placeholder', () => {
    const vault = emptyVaultData();
    anonymizeWithVault(
      'Alice here',
      [makeSpan('PERSON', 'Alice')],
      vault,
      'placeholder',
    );

    expect(hasReversibleContent('PERSON 1 said hi', vault)).toBe(true);
    expect(hasReversibleContent('person_1 said hi', vault)).toBe(true);
    expect(hasReversibleContent('Nothing here', vault)).toBe(false);
  });
});
