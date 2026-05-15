import { augmentEntityMap } from '../../src/shared/entity-map-augment';
import {
  emptyVaultData,
  type IdentityVaultData,
  type IdentityRecord,
} from '../../src/shared/identity-vault';

function makeRecord(overrides: Partial<IdentityRecord>): IdentityRecord {
  const base: IdentityRecord = {
    id: 'rec-1',
    originalText: 'John Doe',
    normalizedKey: 'john doe',
    entityType: 'PERSON',
    placeholder: '[PERSON_1]',
    syntheticValue: 'Jordan Park',
    replacementMode: 'placeholder',
    pinned: false,
    createdAt: 0,
    updatedAt: 0,
    lastSeenAt: 0,
    usageCount: 1,
  };
  return { ...base, ...overrides };
}

function makeVault(records: IdentityRecord[]): IdentityVaultData {
  const v = emptyVaultData();
  v.records = records;
  return v;
}

describe('augmentEntityMap', () => {
  test('vault disabled — returns conversation map unchanged', () => {
    const vault = makeVault([makeRecord({})]);
    const stored = { '[PERSON_1]': 'John Doe' };
    const map = augmentEntityMap(stored, vault, false);

    expect(map.size).toBe(1);
    expect(map.getOriginal('[PERSON_1]')).toBe('John Doe');
    expect(map.getOriginal('Jordan Park')).toBeUndefined();
  });

  test('vault empty — returns conversation map unchanged', () => {
    const stored = { '[PERSON_1]': 'John Doe' };
    const map = augmentEntityMap(stored, emptyVaultData(), true);

    expect(map.size).toBe(1);
    expect(map.getOriginal('[PERSON_1]')).toBe('John Doe');
  });

  test('record present in conversation map — synthetic mirror is added', () => {
    const vault = makeVault([
      makeRecord({ placeholder: '[PERSON_1]', syntheticValue: 'Jordan Park' }),
    ]);
    // Conversation map only has the placeholder side.
    const stored = { '[PERSON_1]': 'John Doe' };
    const map = augmentEntityMap(stored, vault, true);

    expect(map.getOriginal('[PERSON_1]')).toBe('John Doe');
    expect(map.getOriginal('Jordan Park')).toBe('John Doe');
  });

  test('record present via synthetic only — placeholder mirror is added', () => {
    const vault = makeVault([
      makeRecord({ placeholder: '[PERSON_1]', syntheticValue: 'Jordan Park' }),
    ]);
    // Conversation map only knows about the synthetic (synthetic-mode paste).
    const stored = { 'Jordan Park': 'John Doe' };
    const map = augmentEntityMap(stored, vault, true);

    expect(map.getOriginal('Jordan Park')).toBe('John Doe');
    expect(map.getOriginal('[PERSON_1]')).toBe('John Doe');
  });

  test('record absent from conversation map — not added', () => {
    const vault = makeVault([
      makeRecord({
        placeholder: '[PERSON_2]',
        syntheticValue: 'Riley Bennett',
      }),
    ]);
    const stored = { '[PERSON_1]': 'David' };
    const map = augmentEntityMap(stored, vault, true);

    expect(map.size).toBe(1);
    expect(map.getOriginal('[PERSON_2]')).toBeUndefined();
    expect(map.getOriginal('Riley Bennett')).toBeUndefined();
  });

  test('idempotent when both sides already mirror', () => {
    const vault = makeVault([
      makeRecord({ placeholder: '[PERSON_1]', syntheticValue: 'Jordan Park' }),
    ]);
    const stored = {
      '[PERSON_1]': 'John Doe',
      'Jordan Park': 'John Doe',
    };
    const map = augmentEntityMap(stored, vault, true);

    expect(map.size).toBe(2);
    expect(map.getOriginal('[PERSON_1]')).toBe('John Doe');
    expect(map.getOriginal('Jordan Park')).toBe('John Doe');
  });

  test('record with empty syntheticValue — placeholder presence still mirrored cleanly', () => {
    const vault = makeVault([
      makeRecord({ placeholder: '[PASSWORD_1]', syntheticValue: '' }),
    ]);
    const stored = { '[PASSWORD_1]': 'correct-horse' };
    const map = augmentEntityMap(stored, vault, true);

    expect(map.size).toBe(1);
    expect(map.getOriginal('[PASSWORD_1]')).toBe('correct-horse');
    // No empty-string key should be inserted.
    expect(map.getOriginal('')).toBeUndefined();
  });

  test('undefined storedMap — vault augmentation skipped (nothing to anchor on)', () => {
    const vault = makeVault([makeRecord({})]);
    const map = augmentEntityMap(undefined, vault, true);
    expect(map.size).toBe(0);
  });

  test('multiple records — only those anchored in conversation map mirror', () => {
    const vault = makeVault([
      makeRecord({
        id: 'a',
        originalText: 'John Doe',
        placeholder: '[PERSON_1]',
        syntheticValue: 'Jordan Park',
      }),
      makeRecord({
        id: 'b',
        originalText: 'Anna Schmidt',
        placeholder: '[PERSON_2]',
        syntheticValue: 'Riley Bennett',
      }),
    ]);
    const stored = { '[PERSON_1]': 'John Doe' };
    const map = augmentEntityMap(stored, vault, true);

    expect(map.getOriginal('Jordan Park')).toBe('John Doe');
    expect(map.getOriginal('[PERSON_2]')).toBeUndefined();
    expect(map.getOriginal('Riley Bennett')).toBeUndefined();
  });
});
