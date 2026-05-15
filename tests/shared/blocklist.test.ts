import { applyBlocklist, applyAllowlist } from '../../src/shared/feedback';
import type { BlocklistEntry, AllowlistEntry, PiiSpan } from '../../src/shared/message-types';

function span(
  text: string,
  start: number,
  end: number,
  entity_type: PiiSpan['entity_type'] = 'PERSON',
  score = 0.9,
): PiiSpan {
  return { start, end, entity_type, score, text, source: 'ner' };
}

function blockEntry(
  pattern: string,
  scope: BlocklistEntry['scope'] = 'any',
): BlocklistEntry {
  return { pattern, scope, addedAt: 0, source: 'manual' };
}

function allowEntry(pattern: string): AllowlistEntry {
  return { pattern, scope: 'any', addedAt: 0, source: 'manual' };
}

// [description, text, inputSpans, blocklist, expectedEntityTypes, expectedTexts]
type BlocklistCase = [
  string,
  string,
  PiiSpan[],
  BlocklistEntry[],
  string[],
  string[],
];

const CASES: BlocklistCase[] = [
  [
    'empty blocklist returns spans unchanged',
    'Hello World',
    [span('Hello', 0, 5)],
    [],
    ['PERSON'],
    ['Hello'],
  ],
  [
    'injects span for blocklist match (scope any → MISC)',
    'Project Bluebird is confidential',
    [],
    [blockEntry('Project Bluebird')],
    ['MISC'],
    ['Project Bluebird'],
  ],
  [
    'injects with explicit entity type override',
    'Project Bluebird is confidential',
    [],
    [blockEntry('Project Bluebird', 'ORGANIZATION')],
    ['ORGANIZATION'],
    ['Project Bluebird'],
  ],
  [
    'no duplicate when detector already found the span at same range',
    'Project Bluebird',
    [span('Project Bluebird', 0, 16, 'PERSON')],
    [blockEntry('Project Bluebird', 'ORGANIZATION')],
    ['PERSON'],
    ['Project Bluebird'],
  ],
  [
    'multiple blocklist entries inject independently',
    'Alpha Beta',
    [],
    [blockEntry('Alpha', 'EMAIL'), blockEntry('Beta', 'PHONE')],
    ['EMAIL', 'PHONE'],
    ['Alpha', 'Beta'],
  ],
  [
    'wildcard blocklist pattern matches family of strings',
    'acme-prod is running',
    [],
    [blockEntry('acme-*', 'ORGANIZATION')],
    ['ORGANIZATION'],
    ['acme-prod'],
  ],
  [
    'case-insensitive blocklist match',
    'project bluebird is here',
    [],
    [blockEntry('Project Bluebird')],
    ['MISC'],
    ['project bluebird'],
  ],
  [
    'word-boundary: blocklist does not match partial word',
    'Bluebirds fly',
    [],
    [blockEntry('Bluebird')],
    [],
    [],
  ],
  [
    'existing spans unaffected when blocklist adds new span',
    'Alice went to Project Bluebird',
    [span('Alice', 0, 5, 'PERSON')],
    [blockEntry('Project Bluebird', 'ORGANIZATION')],
    ['PERSON', 'ORGANIZATION'],
    ['Alice', 'Project Bluebird'],
  ],
];

describe('applyBlocklist', () => {
  test.each(CASES)('%s', (_desc, text, inputSpans, blocklist, expectedTypes, expectedTexts) => {
    const result = applyBlocklist(text, inputSpans, blocklist);
    expect(result.map((s) => s.entity_type)).toEqual(expectedTypes);
    expect(result.map((s) => s.text)).toEqual(expectedTexts);
  });

  test('injected spans have score 1.0 and source manual', () => {
    const result = applyBlocklist('Alpha', [], [blockEntry('Alpha')]);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(1.0);
    expect(result[0].source).toBe('manual');
  });
});

// Conflict: blocklist wins over allowlist
// The pipeline applies allowlist first, then applyBlocklist on the result.
describe('blocklist vs allowlist conflict', () => {
  test('blocklist wins when string is in both lists', () => {
    const text = 'Project Bluebird is here';
    const existingSpan = span('Project Bluebird', 8, 24, 'PERSON');

    // Step 1: allowlist suppresses the natural detection
    const afterAllowlist = applyAllowlist([existingSpan], [allowEntry('Project Bluebird')]);
    expect(afterAllowlist).toHaveLength(0);

    // Step 2: blocklist re-injects it
    const final = applyBlocklist(text, afterAllowlist, [blockEntry('Project Bluebird', 'ORGANIZATION')]);
    expect(final).toHaveLength(1);
    expect(final[0].entity_type).toBe('ORGANIZATION');
    expect(final[0].text).toBe('Project Bluebird');
  });

  test('blocklist wins when no detector found the string either', () => {
    const text = 'Project Bluebird is here';

    const afterAllowlist = applyAllowlist([], [allowEntry('Project Bluebird')]);
    expect(afterAllowlist).toHaveLength(0);

    const final = applyBlocklist(text, afterAllowlist, [blockEntry('Project Bluebird')]);
    expect(final).toHaveLength(1);
    expect(final[0].entity_type).toBe('MISC');
  });
});
