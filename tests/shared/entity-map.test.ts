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

describe('EntityMap', () => {
  test('assigns sequential placeholders per type', () => {
    const map = new EntityMap();
    const p1 = map.add(makeSpan('PERSON', 'Alice'));
    const p2 = map.add(makeSpan('PERSON', 'Bob'));
    expect(p1).toBe('[PERSON_1]');
    expect(p2).toBe('[PERSON_2]');
  });

  test('reuses placeholder for same text', () => {
    const map = new EntityMap();
    const p1 = map.add(makeSpan('PERSON', 'Alice'));
    const p2 = map.add(makeSpan('PERSON', 'Alice'));
    expect(p1).toBe(p2);
    expect(map.size).toBe(1);
  });

  test('different types get independent counters', () => {
    const map = new EntityMap();
    const p1 = map.add(makeSpan('PERSON', 'Alice'));
    const e1 = map.add(makeSpan('EMAIL', 'alice@test.com'));
    expect(p1).toBe('[PERSON_1]');
    expect(e1).toBe('[EMAIL_1]');
  });

  test('getOriginal returns correct value', () => {
    const map = new EntityMap();
    map.add(makeSpan('PERSON', 'Alice'));
    expect(map.getOriginal('[PERSON_1]')).toBe('Alice');
    expect(map.getOriginal('[PERSON_99]')).toBeUndefined();
  });

  test('getPlaceholder returns correct placeholder', () => {
    const map = new EntityMap();
    map.add(makeSpan('PERSON', 'Alice'));
    expect(map.getPlaceholder('Alice')).toBe('[PERSON_1]');
    expect(map.getPlaceholder('Unknown')).toBeUndefined();
  });

  test('serialization roundtrip', () => {
    const map = new EntityMap();
    map.add(makeSpan('PERSON', 'Alice'));
    map.add(makeSpan('EMAIL', 'alice@test.com'));

    const stored = map.toStored();
    const restored = new EntityMap(stored);

    expect(restored.getOriginal('[PERSON_1]')).toBe('Alice');
    expect(restored.getOriginal('[EMAIL_1]')).toBe('alice@test.com');
    expect(restored.size).toBe(2);
  });

  test('serialization roundtrip preserves new NER entity placeholders', () => {
    const map = new EntityMap();
    map.add(makeSpan('ADDRESS', '42 Cedar St'));
    map.add(makeSpan('URL', 'https://portal.example/private'));
    map.add(makeSpan('USERNAME', 'alice_admin'));
    map.add(makeSpan('PASSWORD', 'correct-horse'));
    map.add(makeSpan('BANK_ACCOUNT', '1234567890'));

    const restored = new EntityMap(map.toStored());

    expect(restored.getOriginal('[ADDRESS_1]')).toBe('42 Cedar St');
    expect(restored.getOriginal('[URL_1]')).toBe('https://portal.example/private');
    expect(restored.getOriginal('[USERNAME_1]')).toBe('alice_admin');
    expect(restored.getOriginal('[PASSWORD_1]')).toBe('correct-horse');
    expect(restored.getOriginal('[BANK_ACCOUNT_1]')).toBe('1234567890');
    expect(restored.add(makeSpan('URL', 'https://portal.example/next'))).toBe('[URL_2]');
  });

  test('restored map continues numbering correctly', () => {
    const map = new EntityMap();
    map.add(makeSpan('PERSON', 'Alice'));

    const restored = new EntityMap(map.toStored());
    const p2 = restored.add(makeSpan('PERSON', 'Bob'));
    expect(p2).toBe('[PERSON_2]');
  });

  test('entries returns all mappings', () => {
    const map = new EntityMap();
    map.add(makeSpan('PERSON', 'Alice'));
    map.add(makeSpan('EMAIL', 'a@b.com'));

    const entries = map.entries();
    expect(entries).toHaveLength(2);
    expect(entries).toContainEqual(['[PERSON_1]', 'Alice']);
    expect(entries).toContainEqual(['[EMAIL_1]', 'a@b.com']);
  });
});
