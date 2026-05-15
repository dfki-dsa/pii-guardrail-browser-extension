import { resolveText } from '../../src/shared/placeholder-resolver';
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

describe('resolveText — canonical placeholders', () => {
  test('resolves a single canonical placeholder', () => {
    const map = new EntityMap();
    map.add(makeSpan('PERSON', 'David'));

    const { matches, deAnonText } = resolveText('Hi [PERSON_1]!', map);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      matchText: '[PERSON_1]',
      originalText: 'David',
      styleKey: 'person',
      kind: 'placeholder',
    });
    expect(deAnonText).toBe('Hi David!');
  });

  test('resolves multiple distinct placeholders in order', () => {
    const map = new EntityMap();
    map.add(makeSpan('PERSON', 'Alice'));
    map.add(makeSpan('EMAIL', 'a@x.com'));

    const { matches, deAnonText } = resolveText(
      '[PERSON_1] uses [EMAIL_1].',
      map,
    );
    expect(matches.map((m) => m.originalText)).toEqual(['Alice', 'a@x.com']);
    expect(matches.map((m) => m.start)).toEqual([0, 16]);
    expect(deAnonText).toBe('Alice uses a@x.com.');
  });

  test('passes through unknown placeholders unchanged', () => {
    const map = new EntityMap();
    map.add(makeSpan('PERSON', 'David'));

    const { matches, deAnonText } = resolveText('[PERSON_99] is unknown', map);
    expect(matches).toHaveLength(0);
    expect(deAnonText).toBe('[PERSON_99] is unknown');
  });

  test('handles text with no placeholders', () => {
    const map = new EntityMap();
    map.add(makeSpan('PERSON', 'David'));
    const { matches, deAnonText } = resolveText('hello world', map);
    expect(matches).toEqual([]);
    expect(deAnonText).toBe('hello world');
  });

  test('uses lowercased type as styleKey for placeholders', () => {
    const map = new EntityMap();
    map.add(makeSpan('BANK_ACCOUNT', '12345'));
    const { matches } = resolveText('Account [BANK_ACCOUNT_1]', map);
    expect(matches[0].styleKey).toBe('bank_account');
  });
});

describe('resolveText — mangled (variant) placeholders', () => {
  test('matches "PERSON 1" (space separator, no brackets) against canonical', () => {
    const map = new EntityMap();
    map.add(makeSpan('PERSON', 'Björn'));

    const { matches, deAnonText } = resolveText('Hi PERSON 1, hello.', map);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      matchText: 'PERSON 1',
      originalText: 'Björn',
      styleKey: 'person',
      kind: 'placeholder',
    });
    expect(deAnonText).toBe('Hi Björn, hello.');
  });

  test('matches lowercased bracketed variant `[person_1]`', () => {
    const map = new EntityMap();
    map.add(makeSpan('PERSON', 'Anna'));
    const { matches, deAnonText } = resolveText('see [person_1] there', map);
    expect(matches).toHaveLength(1);
    expect(matches[0].matchText.toLowerCase()).toBe('[person_1]');
    expect(deAnonText).toBe('see Anna there');
  });

  test('rejects partial-word collision `PERSON_1A`', () => {
    const map = new EntityMap();
    map.add(makeSpan('PERSON', 'Alice'));
    const { matches, deAnonText } = resolveText('codename PERSON_1A', map);
    expect(matches).toHaveLength(0);
    expect(deAnonText).toBe('codename PERSON_1A');
  });

  test('PERSON_12 is not consumed by [PERSON_1] when both exist (longest-first wins)', () => {
    const map = new EntityMap();
    map.add(makeSpan('PERSON', 'Anna')); // [PERSON_1]
    for (let i = 0; i < 10; i++) {
      map.add(makeSpan('PERSON', `extra-${i}`));
    }
    map.add(makeSpan('PERSON', 'Lukas')); // [PERSON_12]

    const { matches, deAnonText } = resolveText('hi [PERSON_12]', map);
    expect(matches).toHaveLength(1);
    expect(matches[0].originalText).toBe('Lukas');
    expect(deAnonText).toBe('hi Lukas');
  });
});

describe('resolveText — synthetic echoes', () => {
  test('matches synthetic value as a whole word', () => {
    const map = new EntityMap();
    map.addExternal('Jordan Park', 'John Doe');

    const { matches, deAnonText } = resolveText(
      'I spoke with Jordan Park yesterday.',
      map,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      matchText: 'Jordan Park',
      originalText: 'John Doe',
      styleKey: 'misc',
      kind: 'synthetic',
    });
    expect(deAnonText).toBe('I spoke with John Doe yesterday.');
  });

  test('rejects synthetic match inside a longer word', () => {
    const map = new EntityMap();
    map.addExternal('Anna', 'Käthe');
    const { matches, deAnonText } = resolveText('Annabeth was here', map);
    expect(matches).toHaveLength(0);
    expect(deAnonText).toBe('Annabeth was here');
  });

  test('longest synthetic key wins when keys overlap', () => {
    const map = new EntityMap();
    map.addExternal('Jordan', 'Mike');
    map.addExternal('Jordan Park', 'John Doe');
    const { matches, deAnonText } = resolveText('see Jordan Park', map);
    expect(matches).toHaveLength(1);
    expect(matches[0].originalText).toBe('John Doe');
    expect(deAnonText).toBe('see John Doe');
  });

  test('Unicode-aware boundary: diacritics are word characters', () => {
    const map = new EntityMap();
    map.addExternal('Anna', 'Käthe');
    const { matches } = resolveText('Annaä test', map);
    // 'ä' is a word char so Anna|ä is not a whole-word boundary
    expect(matches).toHaveLength(0);
  });
});

describe('resolveText — overlap precedence', () => {
  test('placeholder match wins when a synthetic overlaps it', () => {
    const map = new EntityMap();
    map.add(makeSpan('PERSON', 'David'));
    // Add a synthetic whose key happens to overlap with the placeholder
    // text so we exercise the precedence rule.
    map.addExternal('PERSON_1', 'Synthetic-Other');

    const { matches, deAnonText } = resolveText('Hi [PERSON_1]!', map);
    expect(matches).toHaveLength(1);
    expect(matches[0].kind).toBe('placeholder');
    expect(matches[0].originalText).toBe('David');
    expect(deAnonText).toBe('Hi David!');
  });

  test('non-overlapping placeholder + synthetic both surface', () => {
    const map = new EntityMap();
    map.add(makeSpan('PERSON', 'David'));
    map.addExternal('Jordan Park', 'John Doe');

    const { matches, deAnonText } = resolveText(
      'Hi [PERSON_1] and Jordan Park.',
      map,
    );
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.kind)).toEqual(['placeholder', 'synthetic']);
    expect(deAnonText).toBe('Hi David and John Doe.');
  });
});

describe('resolveText — word-boundary edge cases', () => {
  test('placeholder at start-of-text resolves', () => {
    const map = new EntityMap();
    map.add(makeSpan('PERSON', 'A'));
    const { deAnonText } = resolveText('[PERSON_1] runs.', map);
    expect(deAnonText).toBe('A runs.');
  });

  test('placeholder at end-of-text resolves', () => {
    const map = new EntityMap();
    map.add(makeSpan('PERSON', 'Z'));
    const { deAnonText } = resolveText('say hi to [PERSON_1]', map);
    expect(deAnonText).toBe('say hi to Z');
  });

  test('synthetic at start-of-text', () => {
    const map = new EntityMap();
    map.addExternal('Jordan', 'John');
    const { deAnonText } = resolveText('Jordan called.', map);
    expect(deAnonText).toBe('John called.');
  });

  test('synthetic at end-of-text', () => {
    const map = new EntityMap();
    map.addExternal('Jordan', 'John');
    const { deAnonText } = resolveText('called Jordan', map);
    expect(deAnonText).toBe('called John');
  });
});

describe('resolveText — empty / degenerate inputs', () => {
  test('empty entity map returns empty matches', () => {
    const map = new EntityMap();
    const { matches, deAnonText } = resolveText('hi [PERSON_1]', map);
    expect(matches).toEqual([]);
    expect(deAnonText).toBe('hi [PERSON_1]');
  });

  test('empty text returns empty matches', () => {
    const map = new EntityMap();
    map.add(makeSpan('PERSON', 'David'));
    const { matches, deAnonText } = resolveText('', map);
    expect(matches).toEqual([]);
    expect(deAnonText).toBe('');
  });
});
