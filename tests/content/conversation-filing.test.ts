import { ConversationFiler } from '../../src/content/conversation-filing';

/**
 * Filing carries this tab's tokens to whichever conversation they are
 * observed in. There is no classification step: nothing here asks what a URL
 * change meant, and every run is safe to repeat.
 */
const NEW_CHAT = 'https://chatgpt.com/';
const CONVERSATION = 'https://chatgpt.com/uc/abc-123';
const OTHER = 'https://chatgpt.com/uc/zzz-999';

interface Harness {
  filer: ConversationFiler;
  moves: Array<{ from: string; to: string; tokens: string[] }>;
  ledger: Set<string>;
  visible: Set<string>;
  url: { value: string };
}

function harness(options: { onMove?: () => void } = {}): Harness {
  const ledger = new Set<string>();
  const visible = new Set<string>();
  const url = { value: NEW_CHAT };
  const moves: Array<{ from: string; to: string; tokens: string[] }> = [];

  const filer = new ConversationFiler({
    ledger: () => ledger,
    observe: (tokens) => [...tokens].filter((token) => visible.has(token)),
    currentUrl: () => url.value,
    move: async (from, to, tokens) => {
      moves.push({ from, to, tokens });
      options.onMove?.();
    },
  });

  return { filer, moves, ledger, visible, url };
}

describe('ConversationFiler', () => {
  it('moves a token to the URL it is seen at', async () => {
    const h = harness();
    h.ledger.add('[PERSON_1]');
    h.filer.noteFiled(NEW_CHAT, ['[PERSON_1]']);

    // The site has just named the conversation and rewritten the URL; the
    // token composed under the old key is rendered in the transcript.
    h.url.value = CONVERSATION;
    h.visible.add('[PERSON_1]');
    await h.filer.run();

    expect(h.moves).toEqual([
      { from: NEW_CHAT, to: CONVERSATION, tokens: ['[PERSON_1]'] },
    ]);
  });

  it('leaves a token alone until it is actually seen there', async () => {
    const h = harness();
    h.ledger.add('[PERSON_1]');
    h.filer.noteFiled(NEW_CHAT, ['[PERSON_1]']);

    // An unsent draft: the URL moved on, the token never reached a transcript.
    h.url.value = CONVERSATION;
    await h.filer.run();

    expect(h.moves).toEqual([]);
  });

  it('moves only the tokens it can see', async () => {
    const h = harness();
    h.ledger.add('[PERSON_1]');
    h.ledger.add('[EMAIL_2]');
    h.filer.noteFiled(NEW_CHAT, ['[PERSON_1]', '[EMAIL_2]']);

    h.url.value = CONVERSATION;
    h.visible.add('[PERSON_1]');
    await h.filer.run();

    expect(h.moves).toEqual([
      { from: NEW_CHAT, to: CONVERSATION, tokens: ['[PERSON_1]'] },
    ]);
  });

  it('empties every key this tab filed under', async () => {
    const h = harness();
    h.ledger.add('[PERSON_1]');
    h.ledger.add('[EMAIL_2]');
    h.filer.noteFiled(NEW_CHAT, ['[PERSON_1]']);
    h.filer.noteFiled(OTHER, ['[EMAIL_2]']);

    h.url.value = CONVERSATION;
    h.visible.add('[PERSON_1]');
    h.visible.add('[EMAIL_2]');
    await h.filer.run();

    expect(h.moves).toEqual([
      { from: NEW_CHAT, to: CONVERSATION, tokens: ['[PERSON_1]'] },
      { from: OTHER, to: CONVERSATION, tokens: ['[EMAIL_2]'] },
    ]);
  });

  it('does nothing on a repeat run', async () => {
    const h = harness();
    h.ledger.add('[PERSON_1]');
    h.filer.noteFiled(NEW_CHAT, ['[PERSON_1]']);
    h.url.value = CONVERSATION;
    h.visible.add('[PERSON_1]');

    await h.filer.run();
    await h.filer.run();
    await h.filer.run();

    expect(h.moves).toHaveLength(1);
  });

  it('skips the page entirely when everything is already filed here', async () => {
    let observed = 0;
    const ledger = new Set(['[PERSON_1]']);
    const filer = new ConversationFiler({
      ledger: () => ledger,
      observe: (tokens) => {
        observed += 1;
        return [...tokens];
      },
      currentUrl: () => CONVERSATION,
      move: async () => undefined,
    });
    filer.noteFiled(CONVERSATION, ['[PERSON_1]']);

    await filer.run();

    expect(observed).toBe(0);
  });

  it('does nothing when this tab has emitted nothing', async () => {
    const h = harness();
    h.url.value = CONVERSATION;

    await h.filer.run();

    expect(h.moves).toEqual([]);
  });

  it('survives the URL changing while a move is in flight', async () => {
    const h = harness({
      onMove: () => {
        // The user switches conversations mid-write.
        h.url.value = OTHER;
      },
    });
    h.ledger.add('[PERSON_1]');
    h.filer.noteFiled(NEW_CHAT, ['[PERSON_1]']);
    h.url.value = CONVERSATION;
    h.visible.add('[PERSON_1]');

    await h.filer.run();

    // The first move landed where it was aimed, and the token is now tracked
    // there. A later run moves it on if it turns up somewhere else.
    expect(h.moves[0]).toEqual({
      from: NEW_CHAT,
      to: CONVERSATION,
      tokens: ['[PERSON_1]'],
    });
    await h.filer.run();
    expect(h.moves[1]).toEqual({
      from: CONVERSATION,
      to: OTHER,
      tokens: ['[PERSON_1]'],
    });
  });

  it('forgets where it filed once the ledger is cleared', async () => {
    const h = harness();
    h.ledger.add('[PERSON_1]');
    h.filer.noteFiled(NEW_CHAT, ['[PERSON_1]']);

    // A conversation switch: the ledger and the filer are both cleared.
    h.ledger.clear();
    h.filer.reset();
    h.url.value = CONVERSATION;
    h.visible.add('[PERSON_1]');
    await h.filer.run();

    expect(h.moves).toEqual([]);
  });
});
