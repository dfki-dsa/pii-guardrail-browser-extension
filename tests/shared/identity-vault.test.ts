import {
  emptyVaultData,
  normalizeKey,
  upsertEntity,
  findRecord,
  updateRecord,
  deleteRecord,
  recordsByRecency,
  activeReplacement,
  buildReverseIndex,
  loadIdentityVault,
  saveIdentityVault,
  clearIdentityVault,
  type IdentityVaultData,
  type IdentityRecord,
} from '../../src/shared/identity-vault';
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

describe('identity-vault', () => {
  describe('normalizeKey', () => {
    test('lowercases and collapses whitespace', () => {
      expect(normalizeKey('John  Doe')).toBe('john doe');
      expect(normalizeKey('  John Doe  ')).toBe('john doe');
      expect(normalizeKey('JOHN DOE')).toBe('john doe');
    });

    test('handles unicode', () => {
      expect(normalizeKey('Anna Müller')).toBe('anna müller');
    });
  });

  describe('emptyVaultData', () => {
    test('returns a fresh, empty vault', () => {
      const v = emptyVaultData();
      expect(v.records).toEqual([]);
      expect(v.counters).toEqual({});
      expect(v.version).toBe(1);
    });
  });

  describe('upsertEntity', () => {
    test('creates a new record on first insertion', () => {
      const data = emptyVaultData();
      const result = upsertEntity(data, makeSpan('PERSON', 'Alice'));
      expect(result.created).toBe(true);
      expect(result.record.originalText).toBe('Alice');
      expect(result.record.entityType).toBe('PERSON');
      expect(result.record.placeholder).toBe('[PERSON_1]');
      expect(result.record.replacementMode).toBe('placeholder');
      expect(result.record.usageCount).toBe(1);
      expect(data.records).toHaveLength(1);
    });

    test('reuses existing record for same text + type', () => {
      const data = emptyVaultData();
      const r1 = upsertEntity(data, makeSpan('PERSON', 'Alice'));
      const r2 = upsertEntity(data, makeSpan('PERSON', 'Alice'));
      expect(r2.created).toBe(false);
      expect(r2.record.id).toBe(r1.record.id);
      expect(r2.record.usageCount).toBe(2);
      expect(data.records).toHaveLength(1);
    });

    test('reuses existing record for case/whitespace variants', () => {
      const data = emptyVaultData();
      const r1 = upsertEntity(data, makeSpan('PERSON', 'Alice'));
      const r2 = upsertEntity(data, makeSpan('PERSON', '  ALICE '));
      expect(r2.created).toBe(false);
      expect(r2.record.id).toBe(r1.record.id);
    });

    test('treats same text different type as separate records', () => {
      const data = emptyVaultData();
      // "Berlin" could be LOCATION or ORGANIZATION (e.g. Berlin TU)
      const loc = upsertEntity(data, makeSpan('LOCATION', 'Berlin'));
      const org = upsertEntity(data, makeSpan('ORGANIZATION', 'Berlin'));
      expect(loc.record.id).not.toBe(org.record.id);
      expect(data.records).toHaveLength(2);
    });

    test('placeholder counter advances per type independently', () => {
      const data = emptyVaultData();
      const p1 = upsertEntity(data, makeSpan('PERSON', 'Alice')).record;
      const p2 = upsertEntity(data, makeSpan('PERSON', 'Bob')).record;
      const e1 = upsertEntity(data, makeSpan('EMAIL', 'a@b.com')).record;
      expect(p1.placeholder).toBe('[PERSON_1]');
      expect(p2.placeholder).toBe('[PERSON_2]');
      expect(e1.placeholder).toBe('[EMAIL_1]');
    });

    test('synthetic value is pre-generated for capable types', () => {
      const data = emptyVaultData();
      const r = upsertEntity(data, makeSpan('PERSON', 'Alice')).record;
      expect(r.syntheticValue).toBeTruthy();
      expect(r.syntheticValue).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+/);
    });

    test('synthetic value is empty string for opt-out types', () => {
      const data = emptyVaultData();
      const r = upsertEntity(data, makeSpan('PASSWORD', 'hunter2')).record;
      expect(r.syntheticValue).toBe('');
    });

    test('records lastSeenAt and usageCount on reuse', () => {
      const data = emptyVaultData();
      upsertEntity(data, makeSpan('PERSON', 'Alice'), 1000);
      const r2 = upsertEntity(data, makeSpan('PERSON', 'Alice'), 5000);
      expect(r2.record.usageCount).toBe(2);
      expect(r2.record.lastSeenAt).toBe(5000);
      expect(r2.record.createdAt).toBe(1000);
    });
  });

  describe('findRecord', () => {
    test('returns undefined for missing entry', () => {
      const data = emptyVaultData();
      expect(findRecord(data, 'Nobody', 'PERSON')).toBeUndefined();
    });

    test('finds by normalized key', () => {
      const data = emptyVaultData();
      upsertEntity(data, makeSpan('PERSON', 'John Doe'));
      expect(findRecord(data, 'JOHN DOE', 'PERSON')).toBeDefined();
      expect(findRecord(data, '  john   doe  ', 'PERSON')).toBeDefined();
    });

    test('does not cross types', () => {
      const data = emptyVaultData();
      upsertEntity(data, makeSpan('PERSON', 'Alice'));
      expect(findRecord(data, 'Alice', 'EMAIL')).toBeUndefined();
    });
  });

  describe('updateRecord', () => {
    test('updates replacement mode', () => {
      const data = emptyVaultData();
      const r = upsertEntity(data, makeSpan('PERSON', 'Alice')).record;
      const updated = updateRecord(data, r.id, { replacementMode: 'synthetic' });
      expect(updated?.replacementMode).toBe('synthetic');
    });

    test('forces placeholder mode when no synthetic available', () => {
      const data = emptyVaultData();
      const r = upsertEntity(data, makeSpan('PASSWORD', 'hunter2')).record;
      const updated = updateRecord(data, r.id, { replacementMode: 'synthetic' });
      // syntheticValue is empty for PASSWORD, so synthetic should be coerced back.
      expect(updated?.replacementMode).toBe('placeholder');
    });

    test('updates synthetic value', () => {
      const data = emptyVaultData();
      const r = upsertEntity(data, makeSpan('PERSON', 'Alice')).record;
      const updated = updateRecord(data, r.id, { syntheticValue: 'Custom Name' });
      expect(updated?.syntheticValue).toBe('Custom Name');
    });

    test('toggles pinned flag', () => {
      const data = emptyVaultData();
      const r = upsertEntity(data, makeSpan('PERSON', 'Alice')).record;
      expect(r.pinned).toBe(false);
      const updated = updateRecord(data, r.id, { pinned: true });
      expect(updated?.pinned).toBe(true);
    });

    test('returns undefined for missing id', () => {
      const data = emptyVaultData();
      expect(updateRecord(data, 'nonexistent', { pinned: true })).toBeUndefined();
    });
  });

  describe('deleteRecord', () => {
    test('removes by id', () => {
      const data = emptyVaultData();
      const r = upsertEntity(data, makeSpan('PERSON', 'Alice')).record;
      expect(deleteRecord(data, r.id)).toBe(true);
      expect(data.records).toHaveLength(0);
    });

    test('returns false for missing id', () => {
      const data = emptyVaultData();
      expect(deleteRecord(data, 'nonexistent')).toBe(false);
    });
  });

  describe('recordsByRecency', () => {
    test('sorts by lastSeenAt descending', () => {
      const data = emptyVaultData();
      upsertEntity(data, makeSpan('PERSON', 'Alice'), 1000);
      upsertEntity(data, makeSpan('PERSON', 'Bob'), 3000);
      upsertEntity(data, makeSpan('PERSON', 'Carol'), 2000);
      const sorted = recordsByRecency(data);
      expect(sorted.map((r) => r.originalText)).toEqual(['Bob', 'Carol', 'Alice']);
    });
  });

  describe('activeReplacement', () => {
    test('returns placeholder by default', () => {
      const r: IdentityRecord = {
        id: 'x',
        originalText: 'Alice',
        normalizedKey: 'alice',
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
      expect(activeReplacement(r, 'placeholder')).toBe('[PERSON_1]');
      expect(activeReplacement(r, 'synthetic')).toBe('[PERSON_1]');
    });

    test('returns synthetic when record opts in', () => {
      const r: IdentityRecord = {
        id: 'x',
        originalText: 'Alice',
        normalizedKey: 'alice',
        entityType: 'PERSON',
        placeholder: '[PERSON_1]',
        syntheticValue: 'Jordan Park',
        replacementMode: 'synthetic',
        pinned: false,
        createdAt: 0,
        updatedAt: 0,
        lastSeenAt: 0,
        usageCount: 1,
      };
      expect(activeReplacement(r, 'placeholder')).toBe('Jordan Park');
    });

    test('falls back to placeholder when synthetic empty', () => {
      const r: IdentityRecord = {
        id: 'x',
        originalText: 'pwd',
        normalizedKey: 'pwd',
        entityType: 'PASSWORD',
        placeholder: '[PASSWORD_1]',
        syntheticValue: '',
        replacementMode: 'synthetic',
        pinned: false,
        createdAt: 0,
        updatedAt: 0,
        lastSeenAt: 0,
        usageCount: 1,
      };
      expect(activeReplacement(r, 'synthetic')).toBe('[PASSWORD_1]');
    });
  });

  describe('buildReverseIndex', () => {
    test('maps both placeholder and synthetic back to record', () => {
      const data = emptyVaultData();
      const r = upsertEntity(data, makeSpan('PERSON', 'Alice')).record;
      const index = buildReverseIndex(data);
      expect(index.get(r.placeholder)).toBe(r);
      expect(index.get(r.syntheticValue)).toBe(r);
    });

    test('omits empty synthetic values', () => {
      const data = emptyVaultData();
      const r = upsertEntity(data, makeSpan('PASSWORD', 'hunter2')).record;
      const index = buildReverseIndex(data);
      expect(index.get(r.placeholder)).toBe(r);
      expect(index.has('')).toBe(false);
    });
  });

  describe('storage round-trip', () => {
    let storageBacking: Record<string, unknown> = {};
    let savedSetCalls: any[];

    beforeEach(() => {
      storageBacking = {};
      savedSetCalls = [];
      (chrome.storage.local.get as jest.Mock).mockImplementation(async (key: string) => {
        const result: Record<string, unknown> = {};
        if (typeof key === 'string' && key in storageBacking) {
          result[key] = storageBacking[key];
        }
        return result;
      });
      (chrome.storage.local.set as jest.Mock).mockImplementation(async (data: Record<string, unknown>) => {
        savedSetCalls.push(data);
        Object.assign(storageBacking, data);
      });
      (chrome.storage.local.remove as jest.Mock).mockImplementation(async (key: string) => {
        delete storageBacking[key];
      });
    });

    test('save then load returns the same data', async () => {
      const data = emptyVaultData();
      upsertEntity(data, makeSpan('PERSON', 'Alice'));
      upsertEntity(data, makeSpan('EMAIL', 'a@b.com'));

      await saveIdentityVault(data);
      const loaded = await loadIdentityVault();

      expect(loaded.records).toHaveLength(2);
      expect(loaded.records[0].originalText).toBe('Alice');
      expect(loaded.records[1].originalText).toBe('a@b.com');
    });

    test('load returns empty vault when storage empty', async () => {
      const loaded = await loadIdentityVault();
      expect(loaded.records).toEqual([]);
    });

    test('clearIdentityVault removes the storage entry', async () => {
      const data = emptyVaultData();
      upsertEntity(data, makeSpan('PERSON', 'Alice'));
      await saveIdentityVault(data);
      await clearIdentityVault();
      const loaded = await loadIdentityVault();
      expect(loaded.records).toEqual([]);
    });

    test('drops malformed records during load', async () => {
      storageBacking['pg_identity_vault'] = {
        records: [
          { invalid: true }, // missing required fields
          {
            id: 'good',
            originalText: 'Alice',
            normalizedKey: 'alice',
            entityType: 'PERSON',
            placeholder: '[PERSON_1]',
            syntheticValue: 'Jordan Park',
            replacementMode: 'placeholder',
            pinned: false,
            createdAt: 0,
            updatedAt: 0,
            lastSeenAt: 0,
            usageCount: 1,
          },
        ],
        counters: { PERSON: 1 },
        version: 1,
      };
      const loaded = await loadIdentityVault();
      expect(loaded.records).toHaveLength(1);
      expect(loaded.records[0].id).toBe('good');
    });
  });

  describe('cross-session consistency scenario', () => {
    test('same identity pasted twice gets the same placeholder', () => {
      // Simulate: paste once in ChatGPT (vault is empty initially).
      const vault = emptyVaultData();
      const first = upsertEntity(vault, makeSpan('PERSON', 'John Doe'));

      // Now simulate later: same vault loaded in Claude. Same paste.
      const second = upsertEntity(vault, makeSpan('PERSON', 'John Doe'));

      // Same record, same placeholder, no counter advancement.
      expect(second.record.id).toBe(first.record.id);
      expect(second.record.placeholder).toBe('[PERSON_1]');
      expect(vault.counters.PERSON).toBe(1);
    });

    test('two different identities get different placeholders even cross-session', () => {
      const vault = emptyVaultData();
      const a = upsertEntity(vault, makeSpan('PERSON', 'John Doe'));
      // Imagine save/load round-trip happens here in the real flow.
      const b = upsertEntity(vault, makeSpan('PERSON', 'Jane Smith'));
      expect(a.record.placeholder).toBe('[PERSON_1]');
      expect(b.record.placeholder).toBe('[PERSON_2]');
    });
  });
});
