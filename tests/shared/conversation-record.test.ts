import {
  clearEntityMaps,
  conversationRecordExists,
  loadConversationRecord,
  moveConversationTokens,
  ownedEntries,
  saveConversationTokens,
  saveSessionConversationPairs,
} from '../../src/shared/storage';

/**
 * Chat sites create the conversation on the first send and rewrite the URL in
 * place. Tokens emitted while composing are filed under the transient "new
 * chat" URL and have to move to the conversation's own key, or restoration is
 * lost as soon as the page is reloaded.
 *
 * Records written by this version hold tokens only — the identity vault holds
 * the originals — so a record filed against the wrong conversation misdirects
 * what may be resolved there and exposes nothing.
 */
const NEW_CHAT = 'https://app.langdock.com/chat';
const CONVERSATION = 'https://app.langdock.com/chat/abc-123';

let local: Record<string, unknown>;
let session: Record<string, unknown>;

function mockArea(area: 'local' | 'session', store: Record<string, unknown>): void {
  const target = (chrome.storage as unknown as Record<string, Record<string, jest.Mock>>)[area];
  target.get.mockImplementation(async (key: string) => ({ [key]: store[key] }));
  target.set.mockImplementation(async (patch: Record<string, unknown>) => {
    Object.assign(store, patch);
  });
  target.remove.mockImplementation(async (key: string) => {
    delete store[key];
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  local = {};
  session = {};
  mockArea('local', local);
  mockArea('session', session);
});

describe('record shapes', () => {
  it('resolves a list record through the vault rather than from itself', async () => {
    await saveConversationTokens(CONVERSATION, ['[PERSON_1]']);

    const record = await loadConversationRecord(CONVERSATION);
    expect(record.tokens).toEqual(['[PERSON_1]']);
    // No original value is written anywhere durable.
    expect(record.originals).toEqual({});
    expect(JSON.stringify(local)).not.toContain('Peter Mayer');
  });

  it('reads a record written by an earlier version, originals and all', async () => {
    local.pg_entity_maps = { [CONVERSATION]: { '[PERSON_1]': 'Peter Mayer' } };

    const record = await loadConversationRecord(CONVERSATION);
    expect(record.tokens).toEqual(['[PERSON_1]']);
    expect(record.originals).toEqual({ '[PERSON_1]': 'Peter Mayer' });
  });

  it('leaves a record written by an earlier version exactly as it found it', async () => {
    local.pg_entity_maps = { [CONVERSATION]: { '[PERSON_1]': 'Peter Mayer' } };

    await saveConversationTokens(CONVERSATION, ['[EMAIL_2]']);

    expect(local.pg_entity_maps).toEqual({
      [CONVERSATION]: { '[PERSON_1]': 'Peter Mayer' },
    });
    const record = await loadConversationRecord(CONVERSATION);
    expect(record.tokens.sort()).toEqual(['[EMAIL_2]', '[PERSON_1]']);
  });

  it('writes a list even when the same conversation already has a legacy record', async () => {
    local.pg_entity_maps = { [CONVERSATION]: { '[PERSON_1]': 'Peter Mayer' } };

    await saveConversationTokens(CONVERSATION, ['[EMAIL_2]']);

    expect((local.pg_conversation_records as Record<string, unknown>)[CONVERSATION])
      .toEqual(['[EMAIL_2]']);
  });

  it('keeps a vault-off write out of durable storage', async () => {
    await saveSessionConversationPairs(CONVERSATION, { '[PERSON_1]': 'Peter Mayer' });

    expect(local).toEqual({});
    expect(session.pg_conversation_records).toEqual({
      [CONVERSATION]: { '[PERSON_1]': 'Peter Mayer' },
    });
    await expect(loadConversationRecord(CONVERSATION)).resolves.toEqual({
      tokens: ['[PERSON_1]'],
      originals: { '[PERSON_1]': 'Peter Mayer' },
    });
  });

  it('degrades to forgetting the conversation when session storage is unavailable', async () => {
    const storage = chrome.storage as unknown as Record<string, unknown>;
    const saved = storage.session;
    delete storage.session;
    try {
      await saveSessionConversationPairs(CONVERSATION, { '[PERSON_1]': 'Peter Mayer' });
      await expect(loadConversationRecord(CONVERSATION)).resolves.toEqual({
        tokens: [],
        originals: {},
      });
    } finally {
      storage.session = saved;
    }
  });
});

describe('conversationRecordExists', () => {
  it('is true for a conversation some session has already filed under', async () => {
    await saveConversationTokens(CONVERSATION, ['[PERSON_1]']);

    await expect(conversationRecordExists(CONVERSATION)).resolves.toBe(true);
    await expect(conversationRecordExists(NEW_CHAT)).resolves.toBe(false);
  });

  it('counts a record written by an earlier version', async () => {
    local.pg_entity_maps = { [CONVERSATION]: { '[PERSON_1]': 'Peter Mayer' } };

    await expect(conversationRecordExists(CONVERSATION)).resolves.toBe(true);
  });
});

describe('moveConversationTokens', () => {
  it('moves pending tokens onto the conversation URL', async () => {
    await saveConversationTokens(NEW_CHAT, ['[PERSON_1]']);

    await moveConversationTokens(NEW_CHAT, CONVERSATION, ['[PERSON_1]']);

    await expect(loadConversationRecord(CONVERSATION)).resolves.toEqual({
      tokens: ['[PERSON_1]'],
      originals: {},
    });
    await expect(loadConversationRecord(NEW_CHAT)).resolves.toEqual({
      tokens: [],
      originals: {},
    });
  });

  it('merges into tokens the conversation already has', async () => {
    await saveConversationTokens(NEW_CHAT, ['[EMAIL_2]']);
    await saveConversationTokens(CONVERSATION, ['[PERSON_1]']);

    await moveConversationTokens(NEW_CHAT, CONVERSATION, ['[EMAIL_2]']);

    const record = await loadConversationRecord(CONVERSATION);
    expect(record.tokens.sort()).toEqual(['[EMAIL_2]', '[PERSON_1]']);
  });

  it('leaves another tab’s pending tokens under the shared new-chat key', async () => {
    await saveConversationTokens(NEW_CHAT, ['[PERSON_1]', '[PERSON_9]']);

    await moveConversationTokens(NEW_CHAT, CONVERSATION, ['[PERSON_1]']);

    await expect(loadConversationRecord(CONVERSATION)).resolves.toEqual({
      tokens: ['[PERSON_1]'],
      originals: {},
    });
    await expect(loadConversationRecord(NEW_CHAT)).resolves.toEqual({
      tokens: ['[PERSON_9]'],
      originals: {},
    });
  });

  it('carries the originals along when the record is the only copy of them', async () => {
    await saveSessionConversationPairs(NEW_CHAT, {
      '[PERSON_1]': 'Peter Mayer',
      '[EMAIL_2]': 'someone-else@example-corp.test',
    });

    await moveConversationTokens(NEW_CHAT, CONVERSATION, ['[PERSON_1]']);

    await expect(loadConversationRecord(CONVERSATION)).resolves.toEqual({
      tokens: ['[PERSON_1]'],
      originals: { '[PERSON_1]': 'Peter Mayer' },
    });
    await expect(loadConversationRecord(NEW_CHAT)).resolves.toEqual({
      tokens: ['[EMAIL_2]'],
      originals: { '[EMAIL_2]': 'someone-else@example-corp.test' },
    });
  });

  it('does nothing when there is nothing to move', async () => {
    await saveConversationTokens(CONVERSATION, ['[PERSON_1]']);
    (chrome.storage.local.set as jest.Mock).mockClear();

    await moveConversationTokens(NEW_CHAT, CONVERSATION, []);

    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('does nothing when the URL did not actually change', async () => {
    await moveConversationTokens(CONVERSATION, CONVERSATION, ['[PERSON_1]']);

    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('changes nothing when repeated after the tokens have already moved', async () => {
    await saveConversationTokens(NEW_CHAT, ['[PERSON_1]']);
    await moveConversationTokens(NEW_CHAT, CONVERSATION, ['[PERSON_1]']);
    const afterFirst = JSON.stringify(local);

    await moveConversationTokens(NEW_CHAT, CONVERSATION, ['[PERSON_1]']);

    expect(JSON.stringify(local)).toBe(afterFirst);
  });
});

describe('clearEntityMaps', () => {
  it('clears one conversation across every shape and area', async () => {
    local.pg_entity_maps = { [CONVERSATION]: { '[PERSON_1]': 'Peter Mayer' } };
    await saveConversationTokens(CONVERSATION, ['[EMAIL_2]']);
    await saveSessionConversationPairs(CONVERSATION, { '[PHONE_3]': '+43 660 1234567' });
    await saveConversationTokens(NEW_CHAT, ['[PERSON_9]']);

    await clearEntityMaps(CONVERSATION);

    await expect(loadConversationRecord(CONVERSATION)).resolves.toEqual({
      tokens: [],
      originals: {},
    });
    await expect(loadConversationRecord(NEW_CHAT)).resolves.toEqual({
      tokens: ['[PERSON_9]'],
      originals: {},
    });
  });

  it('clears every conversation when given no URL', async () => {
    local.pg_entity_maps = { [CONVERSATION]: { '[PERSON_1]': 'Peter Mayer' } };
    await saveConversationTokens(NEW_CHAT, ['[PERSON_9]']);
    await saveSessionConversationPairs(NEW_CHAT, { '[PHONE_3]': '+43 660 1234567' });

    await clearEntityMaps();

    expect(local.pg_entity_maps).toBeUndefined();
    expect(local.pg_conversation_records).toBeUndefined();
    expect(session.pg_conversation_records).toBeUndefined();
  });
});

/**
 * The "new chat" URL is a single key shared by every tab composing its first
 * message, and a page session restores it on load. `ownedEntries` is what
 * keeps one session from filing or persisting another's tokens.
 */
describe('ownedEntries', () => {
  const MAP = {
    '[PERSON_1]': 'Peter Mayer',
    '[EMAIL_2]': 'peter@example-corp.test',
    '[PHONE_3]': '+43 660 1234567',
  };

  it('keeps only the entries this session emitted', () => {
    expect(ownedEntries(MAP, new Set(['[PERSON_1]', '[PHONE_3]']))).toEqual({
      '[PERSON_1]': 'Peter Mayer',
      '[PHONE_3]': '+43 660 1234567',
    });
  });

  it('returns nothing when the session emitted nothing', () => {
    expect(ownedEntries(MAP, new Set())).toEqual({});
  });

  it('ignores tokens the session emitted that are no longer mapped', () => {
    expect(ownedEntries(MAP, new Set(['[PERSON_1]', '[GONE_9]']))).toEqual({
      '[PERSON_1]': 'Peter Mayer',
    });
  });
});
