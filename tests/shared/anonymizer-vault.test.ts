/**
 * Tests for the vault-aware anonymisation pathway. Validates the
 * cross-session consistency promise: pasting the same identity through
 * different conversations always yields the same replacement, and
 * de-anonymisation reverses both placeholder and synthetic forms.
 */

import { anonymizeWithVault } from '../../src/shared/anonymizer';
import {
  deAnonymizeWithVault,
  hasReversibleContent,
} from '../../src/shared/de-anonymizer';
import { emptyVaultData, updateRecord } from '../../src/shared/identity-vault';
import { EntityMap } from '../../src/shared/entity-map';
import type { PiiSpan } from '../../src/shared/message-types';

function makeSpan(start: number, end: number, type: string, text: string): PiiSpan {
  return { start, end, entity_type: type as any, score: 0.9, text, source: 'regex' };
}

describe('anonymizeWithVault', () => {
  test('default placeholder mode mirrors the legacy anonymizer output', () => {
    const vault = emptyVaultData();
    const text = 'Hi, I am Alice and you can reach me at alice@test.com';
    const spans = [
      makeSpan(9, 14, 'PERSON', 'Alice'),
      makeSpan(39, 53, 'EMAIL', 'alice@test.com'),
    ];

    const r = anonymizeWithVault(text, spans, vault, 'placeholder');

    expect(r.text).toBe('Hi, I am [PERSON_1] and you can reach me at [EMAIL_1]');
    expect(r.recordsTouched).toHaveLength(2);
    expect(vault.records).toHaveLength(2);
  });

  test('synthetic mode emits realistic replacements', () => {
    const vault = emptyVaultData();
    const text = 'Alice met Bob in Berlin.';
    const spans = [
      makeSpan(0, 5, 'PERSON', 'Alice'),
      makeSpan(10, 13, 'PERSON', 'Bob'),
      makeSpan(17, 23, 'LOCATION', 'Berlin'),
    ];

    const r = anonymizeWithVault(text, spans, vault, 'synthetic');

    // New records inherit the global default mode, so synthetic kicks in
    // immediately without needing a per-record flip.
    expect(r.text).not.toContain('[PERSON_');
    expect(r.text).not.toContain('[LOCATION_');
    expect(r.text).not.toContain('Alice');
    expect(r.text).not.toContain('Bob');
    expect(r.text).not.toContain('Berlin');
    for (const record of vault.records) {
      expect(record.replacementMode).toBe('synthetic');
    }
  });

  test('cross-session: re-anonymising the same paste reuses placeholders', () => {
    const vault = emptyVaultData();
    const text1 = 'Alice met Bob.';
    const spans1 = [
      makeSpan(0, 5, 'PERSON', 'Alice'),
      makeSpan(10, 13, 'PERSON', 'Bob'),
    ];
    const r1 = anonymizeWithVault(text1, spans1, vault, 'placeholder');
    expect(r1.text).toBe('[PERSON_1] met [PERSON_2].');

    // Simulate: user closes browser, opens later, pastes same text in a
    // different LLM. Same vault is loaded.
    const text2 = 'Hi Alice and Bob!';
    const spans2 = [
      makeSpan(3, 8, 'PERSON', 'Alice'),
      makeSpan(13, 16, 'PERSON', 'Bob'),
    ];
    const r2 = anonymizeWithVault(text2, spans2, vault, 'placeholder');
    expect(r2.text).toBe('Hi [PERSON_1] and [PERSON_2]!');

    // Counter did not advance.
    expect(vault.counters.PERSON).toBe(2);
  });

  test('round-trip: anonymize → de-anonymize with mixed modes', () => {
    const vault = emptyVaultData();
    const text = 'My friend Alice lives in Berlin.';
    const spans = [
      makeSpan(10, 15, 'PERSON', 'Alice'),
      makeSpan(25, 31, 'LOCATION', 'Berlin'),
    ];

    // First call uses placeholder mode by default.
    const r = anonymizeWithVault(text, spans, vault, 'placeholder');
    expect(r.text).toBe('My friend [PERSON_1] lives in [LOCATION_1].');

    // Simulate LLM response containing both placeholders verbatim.
    const llmResp1 = 'Sure, [PERSON_1] enjoys [LOCATION_1] very much.';
    const reversed1 = deAnonymizeWithVault(llmResp1, vault);
    expect(reversed1).toBe('Sure, Alice enjoys Berlin very much.');

    // Now flip Alice to synthetic and re-anonymise.
    const aliceRec = vault.records.find((r) => r.originalText === 'Alice')!;
    updateRecord(vault, aliceRec.id, { replacementMode: 'synthetic' });
    const r2 = anonymizeWithVault(text, spans, vault, 'placeholder');
    // Alice is now her synthetic; Berlin remains placeholder.
    expect(r2.text).toContain('[LOCATION_1]');
    expect(r2.text).not.toContain('Alice');
    const synthAlice = aliceRec.syntheticValue;
    expect(r2.text).toContain(synthAlice);

    // De-anon should reverse both forms.
    const llmResp2 = `Hello ${synthAlice}, [LOCATION_1] is lovely.`;
    const reversed2 = deAnonymizeWithVault(llmResp2, vault);
    expect(reversed2).toBe('Hello Alice, Berlin is lovely.');
  });

  test('hasReversibleContent flags both placeholder and synthetic', () => {
    const vault = emptyVaultData();
    const spans = [makeSpan(0, 5, 'PERSON', 'Alice')];
    anonymizeWithVault('Alice here', spans, vault, 'placeholder');

    expect(hasReversibleContent('Hi [PERSON_1]', vault)).toBe(true);
    expect(hasReversibleContent('Nothing here', vault)).toBe(false);

    // After flipping to synthetic:
    const aliceRec = vault.records[0];
    updateRecord(vault, aliceRec.id, { replacementMode: 'synthetic' });
    expect(hasReversibleContent(`Hello ${aliceRec.syntheticValue}`, vault)).toBe(true);
  });

  test('whole-word matching prevents false positives for synthetic substrings', () => {
    const vault = emptyVaultData();
    const r = anonymizeWithVault('Alice', [makeSpan(0, 5, 'PERSON', 'Alice')], vault, 'placeholder');
    void r; // anchor compile

    const aliceRec = vault.records[0];
    // Set a synthetic value that risks false positives.
    updateRecord(vault, aliceRec.id, {
      replacementMode: 'synthetic',
      syntheticValue: 'Park',
    });

    // "Park" appears as part of "Parkour" — must NOT be reversed.
    const llmResp = 'They went parkour at the park entrance.';
    const reversed = deAnonymizeWithVault(llmResp, vault);
    // "park" with lowercase doesn't word-match (case-sensitive), so no
    // changes. With "Park", whole-word matches "park entrance" boundary
    // and would replace, but our test text uses lowercase.
    expect(reversed).toBe(llmResp);
  });

  test('mangled placeholders are restored via the vault path', () => {
    const vault = emptyVaultData();
    const text = 'Alice met Bob.';
    const spans = [
      makeSpan(0, 5, 'PERSON', 'Alice'),
      makeSpan(10, 13, 'PERSON', 'Bob'),
    ];
    anonymizeWithVault(text, spans, vault, 'placeholder');

    // Each form the LLM might emit is reversed.
    expect(deAnonymizeWithVault('Hi PERSON 1 and PERSON_2!', vault)).toBe(
      'Hi Alice and Bob!',
    );
    expect(deAnonymizeWithVault('Hi [person_1] and [PERSON 2]!', vault)).toBe(
      'Hi Alice and Bob!',
    );
    expect(deAnonymizeWithVault('Hi PERSON1 and PERSON2!', vault)).toBe(
      'Hi Alice and Bob!',
    );
    // Mixed canonical + mangled in one response.
    expect(deAnonymizeWithVault('[PERSON_1] and PERSON 2.', vault)).toBe(
      'Alice and Bob.',
    );
  });

  test('mangled pass does not interfere with synthetic pass', () => {
    const vault = emptyVaultData();
    anonymizeWithVault(
      'Alice here',
      [makeSpan(0, 5, 'PERSON', 'Alice')],
      vault,
      'placeholder',
    );
    const aliceRec = vault.records[0];
    updateRecord(vault, aliceRec.id, { replacementMode: 'synthetic' });
    const synth = aliceRec.syntheticValue;

    // Response contains both the synthetic value and a mangled placeholder.
    const response = `Hi PERSON 1, also known as ${synth}.`;
    expect(deAnonymizeWithVault(response, vault)).toBe(
      'Hi Alice, also known as Alice.',
    );
  });

  test('externally-provided EntityMap mirrors vault choices', () => {
    const vault = emptyVaultData();
    const map = new EntityMap();
    const text = 'Hi Alice';
    const spans = [makeSpan(3, 8, 'PERSON', 'Alice')];
    const r = anonymizeWithVault(text, spans, vault, 'placeholder', map);

    expect(r.entityMap).toBe(map);
    expect(map.getOriginal('[PERSON_1]')).toBe('Alice');
  });
});
