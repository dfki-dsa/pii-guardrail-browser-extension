/**
 * Privacy Guardrail — keeping reveal banners on the replies that should have one
 *
 * The response observer is the fast path for attaching a banner and usually
 * gets there first. It is not the only path because it can miss, and each way
 * it misses is silent: it watches the page's main region as it was when the
 * script started, so a site that rebuilds that region leaves it watching
 * nothing; and a site that re-renders around a finished reply can remove a
 * banner that was already attached. Nothing else would put either right — the
 * scope does not change when a reply repeats tokens the user's own message
 * already showed.
 *
 * So the page scan asks this keeper to look again each time the page settles.
 * Looking means reading a reply's text, and a long conversation has many
 * replies, so the keeper only looks where something can have changed:
 *
 *  - a reply it has not seen before;
 *  - the last reply, which may still be streaming;
 *  - a reply that had a banner and has lost it.
 *
 * Every other reply was already found to hold nothing resolvable and has not
 * been replaced since — a site that rewrites a reply swaps in a new element,
 * which is then one the keeper has not seen. When the scope itself grows, the
 * content script re-offers banners to every reply on its own, and `reset()`
 * makes the keeper forget what it ruled out under the smaller scope.
 */

export interface TurnBannerDeps {
  /** Whether `element` has a banner that is still on the page. */
  hasLiveBanner: (element: HTMLElement) => boolean;
  /**
   * A reply's text as a banner would read it. Not `textContent` alone: an
   * artifact-style reply keeps its content in the `.value` of form controls,
   * and a reply whose tokens are only there still needs its banner.
   */
  readText: (element: HTMLElement) => string;
  /** Cheap check: could `text` contain anything that resolves? */
  mightResolve: (text: string) => boolean;
  /** Try to attach a banner; true when one was attached. */
  attach: (element: HTMLElement) => boolean;
}

export class TurnBannerKeeper {
  private seen = new WeakSet<HTMLElement>();
  private hadBanner = new WeakSet<HTMLElement>();

  constructor(private readonly deps: TurnBannerDeps) {}

  /** Offer a banner wherever one is missing. `turns` in document order. */
  reconcile(turns: readonly HTMLElement[]): void {
    const last = turns[turns.length - 1];
    for (const element of turns) {
      if (this.deps.hasLiveBanner(element)) {
        this.seen.add(element);
        this.hadBanner.add(element);
        continue;
      }

      const worthLooking =
        !this.seen.has(element) || element === last || this.hadBanner.has(element);
      if (!worthLooking) continue;

      this.seen.add(element);
      if (!this.deps.mightResolve(this.deps.readText(element))) continue;
      if (this.deps.attach(element)) this.hadBanner.add(element);
    }
  }

  /** A banner was attached to `element` by some other path. */
  noteAttached(element: HTMLElement): void {
    this.seen.add(element);
    this.hadBanner.add(element);
  }

  /** What may resolve has changed; replies ruled out before deserve another look. */
  reset(): void {
    this.seen = new WeakSet();
  }
}
