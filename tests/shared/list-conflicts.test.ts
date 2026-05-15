import { findConflictingPattern, normalizeListPattern } from '../../src/shared/list-conflicts';
import type { AllowlistEntry, BlocklistEntry } from '../../src/shared/message-types';

function allowEntry(pattern: string): AllowlistEntry {
  return { pattern, scope: 'any', addedAt: 0, source: 'manual' };
}

function blockEntry(pattern: string): BlocklistEntry {
  return { pattern, scope: 'any', addedAt: 0, source: 'manual' };
}

describe('list conflict helpers', () => {
  test('normalizes case and repeated whitespace', () => {
    expect(normalizeListPattern('  Project   Bluebird  ')).toBe('project bluebird');
  });

  test('finds an allowlist conflict case-insensitively', () => {
    expect(findConflictingPattern('project bluebird', [allowEntry('Project Bluebird')])).toBe(
      'Project Bluebird',
    );
  });

  test('finds a blocklist conflict after whitespace normalization', () => {
    expect(findConflictingPattern('Project Bluebird', [blockEntry('Project   Bluebird')])).toBe(
      'Project   Bluebird',
    );
  });

  test('returns null when no conflict exists', () => {
    expect(findConflictingPattern('Project Bluebird', [blockEntry('Project Starling')])).toBeNull();
  });
});
