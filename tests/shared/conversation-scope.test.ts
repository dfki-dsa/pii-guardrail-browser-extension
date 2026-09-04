import {
  buildConversationScope,
  emptyScope,
  type ScopeSources,
} from '../../src/shared/conversation-scope';
import {
  emptyVaultData,
  type IdentityRecord,
  type IdentityVaultData,
} from '../../src/shared/identity-vault';
import type { EntityType } from '../../src/shared/message-types';

/**
 * The scope is what may be resolved on a page. Its job is precision: token
 * matching is loose enough to survive a model returning `person 7`, and that
 * tolerance has to be aimed at a candidate set small enough not to claim
 * ordinary words.
 */
function vaultRecord(
  placeholder: string,
  originalText: string,
  options: { synthetic?: string; entityType?: EntityType } = {},
): IdentityRecord {
  return {
    id: `id-${placeholder}`,
    originalText,
    normalizedKey: originalText.toLowerCase(),
    entityType: options.entityType ?? 'PERSON',
    placeholder,
    syntheticValue: options.synthetic ?? '',
    replacementMode: 'placeholder',
    pinned: false,
    createdAt: 0,
    updatedAt: 0,
    lastSeenAt: 0,
    usageCount: 1,
  };
}

function vaultWith(...records: IdentityRecord[]): IdentityVaultData {
  return { ...emptyVaultData(), records };
}

function sources(overrides: Partial<ScopeSources> = {}): ScopeSources {
  return {
    recordTokens: [],
    recordOriginals: {},
    ledger: {},
    observed: [],
    vault: emptyVaultData(),
    vaultEnabled: true,
    ...overrides,
  };
}

describe('the union of the three sources', () => {
  it('resolves a token filed under this conversation, through the vault', () => {
    const scope = buildConversationScope(sources({
      recordTokens: ['[PERSON_7]'],
      vault: vaultWith(vaultRecord('[PERSON_7]', 'Peter Mayer')),
    }));

    expect(scope.resolve('Ask [PERSON_7] about it.').deAnonText)
      .toBe('Ask Peter Mayer about it.');
  });

  it('resolves a token this tab emitted before anything was filed', () => {
    // The first message of a conversation: nothing is on record yet.
    const scope = buildConversationScope(sources({
      ledger: { '[PERSON_7]': 'Peter Mayer' },
    }));

    expect(scope.resolve('Ask [PERSON_7].').deAnonText).toBe('Ask Peter Mayer.');
  });

  it('resolves a token seen unaltered on the page with no record at all', () => {
    // The failure floor: no record, no ledger, no site knowledge.
    const scope = buildConversationScope(sources({
      observed: ['[PERSON_7]'],
      vault: vaultWith(vaultRecord('[PERSON_7]', 'Peter Mayer')),
    }));

    expect(scope.resolve('Ask [PERSON_7].').deAnonText).toBe('Ask Peter Mayer.');
  });

  it('resolves a record written by an earlier version from the record itself', () => {
    const scope = buildConversationScope(sources({
      recordOriginals: { '[PERSON_7]': 'Peter Mayer' },
      vaultEnabled: false,
    }));

    expect(scope.resolve('Ask [PERSON_7].').deAnonText).toBe('Ask Peter Mayer.');
  });

  it('resolves nothing for a filed token the vault cannot supply an original for', () => {
    const scope = buildConversationScope(sources({
      recordTokens: ['[PERSON_7]'],
      vault: emptyVaultData(),
    }));

    expect(scope.size).toBe(0);
    expect(scope.resolve('Ask [PERSON_7].').deAnonText).toBe('Ask [PERSON_7].');
  });

  it('leaves a token the vault has never issued alone', () => {
    const scope = buildConversationScope(sources({
      recordTokens: ['[PERSON_7]'],
      observed: ['[PERSON_8]'],
      vault: vaultWith(vaultRecord('[PERSON_7]', 'Peter Mayer')),
    }));

    expect(scope.has('[PERSON_8]')).toBe(false);
    expect(scope.resolve('[PERSON_8] stays put.').deAnonText).toBe('[PERSON_8] stays put.');
  });

  it('admits both forms of a record so either may be echoed back', () => {
    const scope = buildConversationScope(sources({
      recordTokens: ['[PERSON_7]'],
      vault: vaultWith(vaultRecord('[PERSON_7]', 'Peter Mayer', { synthetic: 'Jordan Park' })),
    }));

    expect(scope.resolve('Jordan Park replied.').deAnonText).toBe('Peter Mayer replied.');
  });
});

describe('tolerance is bought with evidence', () => {
  it('resolves a mangled token when the conversation is on record', () => {
    const scope = buildConversationScope(sources({
      recordTokens: ['[PERSON_7]'],
      vault: vaultWith(vaultRecord('[PERSON_7]', 'Peter Mayer')),
    }));

    expect(scope.resolve('Ask person 7 about it.').deAnonText)
      .toBe('Ask Peter Mayer about it.');
  });

  it('resolves a mangled token this tab emitted', () => {
    const scope = buildConversationScope(sources({
      ledger: { '[PERSON_7]': 'Peter Mayer' },
    }));

    expect(scope.resolve('Ask PERSON 7.').deAnonText).toBe('Ask Peter Mayer.');
  });

  it('refuses a mangled form of a token admitted only by observation', () => {
    // Seeing `[PERSON_7]` on the page says nothing about `person 7` further
    // down being the same thing rather than ordinary prose.
    const scope = buildConversationScope(sources({
      observed: ['[PERSON_7]'],
      vault: vaultWith(vaultRecord('[PERSON_7]', 'Peter Mayer')),
    }));

    expect(scope.resolve('Ask person 7 about it.').deAnonText)
      .toBe('Ask person 7 about it.');
    expect(scope.resolve('Ask [PERSON_7] about it.').deAnonText)
      .toBe('Ask Peter Mayer about it.');
  });

  it('keeps tolerance for a token that is both on record and observed', () => {
    const scope = buildConversationScope(sources({
      recordTokens: ['[PERSON_7]'],
      observed: ['[PERSON_7]'],
      vault: vaultWith(vaultRecord('[PERSON_7]', 'Peter Mayer')),
    }));

    expect(scope.resolve('Ask person 7.').deAnonText).toBe('Ask Peter Mayer.');
  });
});

describe('cheap pre-gate', () => {
  it('rules out text that cannot contain anything resolvable', () => {
    const scope = buildConversationScope(sources({
      ledger: { '[PERSON_7]': 'Peter Mayer' },
    }));

    expect(scope.mightResolve('Nothing of interest here.')).toBe(false);
    expect(scope.mightResolve('Ask [PERSON_7].')).toBe(true);
  });

  it('notices a synthetic stand-in, which carries no token shape', () => {
    const scope = buildConversationScope(sources({
      recordTokens: ['[PERSON_7]'],
      vault: vaultWith(vaultRecord('[PERSON_7]', 'Peter Mayer', { synthetic: 'Jordan Park' })),
    }));

    expect(scope.mightResolve('Jordan Park replied.')).toBe(true);
  });
});

describe('emptyScope', () => {
  it('resolves nothing and says so', () => {
    const scope = emptyScope();

    expect(scope.size).toBe(0);
    expect(scope.has('[PERSON_1]')).toBe(false);
    expect(scope.mightResolve('[PERSON_1]')).toBe(false);
    expect(scope.resolve('[PERSON_1]')).toEqual({ matches: [], deAnonText: '[PERSON_1]' });
  });
});
