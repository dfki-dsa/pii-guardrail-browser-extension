import {
  generateSyntheticValue,
  supportsSynthetic,
  poolSize,
  SYNTHETIC_CAPABLE_TYPES,
} from '../../src/shared/synthetic-pool';
import type { EntityType } from '../../src/shared/message-types';

describe('synthetic-pool', () => {
  describe('supportsSynthetic', () => {
    test('returns true for unstructured PII types', () => {
      expect(supportsSynthetic('PERSON')).toBe(true);
      expect(supportsSynthetic('LOCATION')).toBe(true);
      expect(supportsSynthetic('ORGANIZATION')).toBe(true);
      expect(supportsSynthetic('EMAIL')).toBe(true);
      expect(supportsSynthetic('ADDRESS')).toBe(true);
    });

    test('returns true for structured types with reserved test ranges', () => {
      expect(supportsSynthetic('CREDIT_CARD')).toBe(true);
      expect(supportsSynthetic('SSN')).toBe(true);
      expect(supportsSynthetic('IBAN')).toBe(true);
      expect(supportsSynthetic('IP_ADDRESS')).toBe(true);
      expect(supportsSynthetic('PHONE')).toBe(true);
      expect(supportsSynthetic('BANK_ACCOUNT')).toBe(true);
    });

    test('returns false for opt-out types', () => {
      expect(supportsSynthetic('PASSWORD')).toBe(false);
      expect(supportsSynthetic('URL')).toBe(false);
      expect(supportsSynthetic('DATE')).toBe(false);
    });

    test('SYNTHETIC_CAPABLE_TYPES matches supportsSynthetic', () => {
      const types: EntityType[] = [
        'PERSON', 'EMAIL', 'PHONE', 'CREDIT_CARD', 'SSN', 'IBAN',
        'IP_ADDRESS', 'LOCATION', 'ORGANIZATION', 'ADDRESS', 'URL',
        'USERNAME', 'PASSWORD', 'BANK_ACCOUNT', 'DATE', 'MISC',
      ];
      for (const t of types) {
        expect(SYNTHETIC_CAPABLE_TYPES.has(t)).toBe(supportsSynthetic(t));
      }
    });
  });

  describe('generateSyntheticValue', () => {
    test('PERSON returns realistic name', () => {
      const v = generateSyntheticValue('PERSON', 0);
      expect(v).toBeTruthy();
      expect(typeof v).toBe('string');
      expect(v).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+/);
    });

    test('LOCATION returns place name', () => {
      const v = generateSyntheticValue('LOCATION', 0);
      expect(v).toBeTruthy();
    });

    test('EMAIL embeds person name with example.com domain', () => {
      const v = generateSyntheticValue('EMAIL', 0);
      expect(v).toMatch(/@example\.(com|org|net)$/);
    });

    test('EMAIL with personSeed reuses the seed', () => {
      const v = generateSyntheticValue('EMAIL', 0, { personSeed: 'Casey Morrow' });
      expect(v).toMatch(/^casey\.morrow@/);
    });

    test('PHONE returns NANP 555-01xx test number', () => {
      const v = generateSyntheticValue('PHONE', 0);
      expect(v).toMatch(/\+1 \(555\) 010-/);
    });

    test('CREDIT_CARD returns a known test number', () => {
      const v = generateSyntheticValue('CREDIT_CARD', 0);
      // First Visa test card
      expect(v).toBe('4111 1111 1111 1111');
    });

    test('SSN uses 900-92 reserved range', () => {
      const v = generateSyntheticValue('SSN', 0);
      expect(v).toMatch(/^900-92-/);
    });

    test('IP_ADDRESS uses RFC 5737 documentation ranges', () => {
      const v = generateSyntheticValue('IP_ADDRESS', 0);
      expect(v).toMatch(/^(192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/);
    });

    test('PASSWORD returns null (no synthetic available)', () => {
      expect(generateSyntheticValue('PASSWORD', 0)).toBeNull();
    });

    test('URL returns null', () => {
      expect(generateSyntheticValue('URL', 0)).toBeNull();
    });

    test('DATE returns null', () => {
      expect(generateSyntheticValue('DATE', 0)).toBeNull();
    });

    test('different indices yield different values within pool size', () => {
      const v0 = generateSyntheticValue('PERSON', 0);
      const v1 = generateSyntheticValue('PERSON', 1);
      const v2 = generateSyntheticValue('PERSON', 2);
      expect(v0).not.toBe(v1);
      expect(v1).not.toBe(v2);
    });

    test('pool exhaustion adds suffix instead of recycling', () => {
      const size = poolSize('PHONE');
      const cycle1 = generateSyntheticValue('PHONE', 0);
      const cycle2 = generateSyntheticValue('PHONE', size);
      // The base value is the same (we wrap around), but a cycle suffix
      // disambiguates it.
      expect(cycle1).not.toBe(cycle2);
      expect(cycle2).toContain(cycle1!.split('-').slice(0, -1).join('-'));
    });

    test('PERSON pool exhaustion appends numeric suffix', () => {
      const size = poolSize('PERSON');
      const cycle1 = generateSyntheticValue('PERSON', 0);
      const cycle2 = generateSyntheticValue('PERSON', size);
      expect(cycle1).not.toBe(cycle2);
      expect(cycle2).toMatch(/ \d+$/);
    });
  });

  describe('poolSize', () => {
    test('returns positive sizes for synthetic-capable types', () => {
      expect(poolSize('PERSON')).toBeGreaterThan(0);
      expect(poolSize('LOCATION')).toBeGreaterThan(0);
      expect(poolSize('ORGANIZATION')).toBeGreaterThan(0);
    });

    test('returns 0 for unsupported types', () => {
      expect(poolSize('PASSWORD')).toBe(0);
      expect(poolSize('URL')).toBe(0);
      expect(poolSize('DATE')).toBe(0);
    });
  });
});
