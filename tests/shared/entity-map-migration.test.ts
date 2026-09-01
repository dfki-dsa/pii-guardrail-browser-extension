import { migrateEntityMap, loadEntityMap, ownedEntries } from '../../src/shared/storage';

/**
 * Chat sites create the conversation on the first send and rewrite the URL in
 * place. Mappings recorded while composing are filed under the transient
 * "new chat" URL and must move to the conversation URL, or restoration is
 * lost as soon as the page is reloaded.
 */
describe('migrateEntityMap', () => {
  const NEW_CHAT = 'https://app.langdock.com/chat';
  const CONVERSATION = 'https://app.langdock.com/chat/abc-123';

  let store: Record<string, unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    store = {};
    (chrome.storage.local.get as jest.Mock).mockImplementation(async (key: string) => ({
      [key]: store[key],
    }));
    (chrome.storage.local.set as jest.Mock).mockImplementation(async (patch: Record<string, unknown>) => {
      Object.assign(store, patch);
    });
  });

  it('moves pending mappings onto the conversation URL', async () => {
    store.pg_entity_maps = { [NEW_CHAT]: { '[PERSON_1]': 'Peter Mayer' } };

    await migrateEntityMap(NEW_CHAT, CONVERSATION, { '[PERSON_1]': 'Peter Mayer' });

    await expect(loadEntityMap(CONVERSATION)).resolves.toEqual({ '[PERSON_1]': 'Peter Mayer' });
    await expect(loadEntityMap(NEW_CHAT)).resolves.toEqual({});
  });

  it('merges into mappings the conversation already has', async () => {
    store.pg_entity_maps = {
      [NEW_CHAT]: { '[EMAIL_2]': 'peter@example-corp.test' },
      [CONVERSATION]: { '[PERSON_1]': 'Peter Mayer' },
    };

    await migrateEntityMap(NEW_CHAT, CONVERSATION, { '[EMAIL_2]': 'peter@example-corp.test' });

    await expect(loadEntityMap(CONVERSATION)).resolves.toEqual({
      '[PERSON_1]': 'Peter Mayer',
      '[EMAIL_2]': 'peter@example-corp.test',
    });
  });

  it('leaves another tab’s pending mappings under the transient URL', async () => {
    store.pg_entity_maps = {
      [NEW_CHAT]: {
        '[PERSON_1]': 'Peter Mayer',
        '[PERSON_9]': 'Hans Gruber',
      },
    };

    // Only this page session's entries move.
    await migrateEntityMap(NEW_CHAT, CONVERSATION, { '[PERSON_1]': 'Peter Mayer' });

    await expect(loadEntityMap(CONVERSATION)).resolves.toEqual({ '[PERSON_1]': 'Peter Mayer' });
    await expect(loadEntityMap(NEW_CHAT)).resolves.toEqual({ '[PERSON_9]': 'Hans Gruber' });
  });

  it('does nothing when there is nothing to move', async () => {
    store.pg_entity_maps = { [CONVERSATION]: { '[PERSON_1]': 'Peter Mayer' } };

    await migrateEntityMap(NEW_CHAT, CONVERSATION, {});

    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('does nothing when the URL did not actually change', async () => {
    await migrateEntityMap(CONVERSATION, CONVERSATION, { '[PERSON_1]': 'Peter Mayer' });

    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
  it('leaves another draft\'s mappings on the shared new-chat key', async () => {
    // Two tabs composing a first message. This session emitted [PERSON_1];
    // [EMAIL_2] belongs to the other tab's draft.
    store.pg_entity_maps = {
      [NEW_CHAT]: {
        '[PERSON_1]': 'Peter Mayer',
        '[EMAIL_2]': 'someone-else@example-corp.test',
      },
    };
    const inMemory = {
      '[PERSON_1]': 'Peter Mayer',
      '[EMAIL_2]': 'someone-else@example-corp.test',
    };

    await migrateEntityMap(
      NEW_CHAT,
      CONVERSATION,
      ownedEntries(inMemory, new Set(['[PERSON_1]'])),
    );

    await expect(loadEntityMap(CONVERSATION)).resolves.toEqual({
      '[PERSON_1]': 'Peter Mayer',
    });
    await expect(loadEntityMap(NEW_CHAT)).resolves.toEqual({
      '[EMAIL_2]': 'someone-else@example-corp.test',
    });
});

/**
 * The "new chat" URL is a single key shared by every tab composing its first
 * message, and a page session restores it on load. `ownedEntries` is what
 * keeps one session from persisting or migrating another's originals.
 */
describe('ownedEntries', () => {
  const MAP = {
    '[PERSON_1]': 'Peter Mayer',
    '[EMAIL_2]': 'peter@example-corp.test',
    '[PHONE_3]': '+43 660 1234567',
  };

  it('keeps only the entries this session emitted', () => {
    const owned = ownedEntries(MAP, new Set(['[PERSON_1]', '[PHONE_3]']));

    expect(owned).toEqual({
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
});
