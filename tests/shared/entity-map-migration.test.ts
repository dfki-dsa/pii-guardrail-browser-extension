import { migrateEntityMap, loadEntityMap } from '../../src/shared/storage';

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
});
