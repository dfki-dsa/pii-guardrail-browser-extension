/**
 * Privacy Guardrail — Conversation filing (content script)
 *
 * Files this tab's replacement tokens under the conversation they are
 * observed in.
 *
 * There is no decision here, which is the point. The mechanism this replaces
 * classified every URL change as "the site just named the conversation" or
 * "the user switched conversations", and got it wrong whenever a vendor
 * changed how conversations are addressed — silently, with no error and no
 * failing test. Filing instead waits for the tokens to be seen rendered at a
 * URL and moves them there. It runs continuously, so no single moment has to
 * be correct, and repeating it changes nothing.
 *
 * Filing carries tokens only. Originals live in the identity vault, so a
 * token filed against the wrong conversation misdirects what may be resolved
 * there and exposes nothing.
 */

export interface ConversationFilerDeps {
  /** Tokens this page session emitted into a composer. */
  ledger: () => Iterable<string>;
  /** Which of `tokens` are rendered in the transcript right now. */
  observe: (tokens: Iterable<string>) => string[];
  /** The conversation key the page is on at the moment of asking. */
  currentUrl: () => string;
  /** Move tokens from the conversation they were filed under to another. */
  move: (fromUrl: string, toUrl: string, tokens: string[]) => Promise<void>;
  /** Called after a successful move, for a debug line. */
  onMoved?: (fromUrl: string, toUrl: string, tokens: string[]) => void;
}

export class ConversationFiler {
  private readonly deps: ConversationFilerDeps;
  /** Where this tab last filed each of its tokens. */
  private filedAt = new Map<string, string>();
  private running = false;
  /** A run requested while one was in flight; the page moved on under it. */
  private rerun = false;

  constructor(deps: ConversationFilerDeps) {
    this.deps = deps;
  }

  /**
   * Record that `tokens` are now filed under `url` — after a paste writes
   * them, or after a move this class made.
   */
  noteFiled(url: string, tokens: Iterable<string>): void {
    for (const token of tokens) this.filedAt.set(token, url);
  }

  /**
   * Forget where this tab filed anything. Called when the ledger is cleared,
   * which is the only moment this tab stops claiming its tokens.
   */
  reset(): void {
    this.filedAt.clear();
  }

  /**
   * Move whatever is filed elsewhere but visible here.
   *
   * Cheap to call often: it returns before touching the DOM when every ledger
   * token is already filed under the current URL, which is the steady state
   * for all but the first send of a conversation.
   */
  async run(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.rerun = false;
        await this.runOnce();
      } while (this.rerun);
    } finally {
      this.running = false;
    }
  }

  private async runOnce(): Promise<void> {
    const url = this.deps.currentUrl();
    const misfiled = [...this.deps.ledger()].filter(
      (token) => this.filedAt.get(token) !== url,
    );
    if (misfiled.length === 0) return;

    const visible = this.deps.observe(misfiled);
    if (visible.length === 0) return;

    // Group by where each token currently sits, so a tab that filed across
    // two keys before landing here still empties both.
    const byOrigin = new Map<string, string[]>();
    for (const token of visible) {
      const from = this.filedAt.get(token);
      if (from === undefined || from === url) continue;
      const group = byOrigin.get(from);
      if (group) group.push(token);
      else byOrigin.set(from, [token]);
    }

    for (const [from, tokens] of byOrigin) {
      await this.deps.move(from, url, tokens);
      // Recorded against `url` whatever the page did while the write was in
      // flight: that is where the tokens now are. A URL change mid-run leaves
      // the next run to move them on, which is the same work as any other.
      this.noteFiled(url, tokens);
      this.deps.onMoved?.(from, url, tokens);
    }
  }
}
