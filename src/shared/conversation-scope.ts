/**
 * Privacy Guardrail — Conversation scope (shared)
 *
 * The set of replacement tokens that may be resolved back to originals on the
 * page in front of the user, and the resolver that applies it.
 *
 * The scope exists for precision, not privacy. Token matching is deliberately
 * tolerant so a model that returns `person 7` for `[PERSON_7]` still resolves,
 * and that tolerance would happily claim `location 1` in ordinary prose if it
 * were let loose on every token the vault has ever issued. Narrowing the
 * candidates is the whole job.
 *
 * Three sources contribute, and they do not carry the same weight:
 *
 *   1. The conversation record for the current URL.
 *   2. The tab ledger — tokens this page session emitted into a composer.
 *   3. Tokens observed unaltered on the page that the identity vault knows.
 *
 * The first two are evidence that this conversation used the token, so they
 * earn tolerant matching. The third is not: it says only that the exact
 * string is on screen, so it resolves in exactly that form and no other. That
 * third source is also what makes total failure unreachable — it needs no
 * record, no URL and no site knowledge, so the worst a vendor change can do
 * is cost the mangled forms.
 *
 * No DOM, no storage, no `chrome.*` access.
 */

import { EntityMap } from './entity-map';
import { augmentEntityMap } from './entity-map-augment';
import type { IdentityVaultData } from './identity-vault';
import { resolveText, type ResolveResult } from './placeholder-resolver';
import { hasPotentialPlaceholderShape } from './placeholder-variants';
import type { StoredEntityMap } from './storage';

export interface ScopeSources {
  /**
   * Tokens filed under the current conversation whose originals live in the
   * identity vault — records in the shape this version writes.
   */
  recordTokens: Iterable<string>;
  /**
   * `token -> original` pairs from records that carry their own originals:
   * those written by earlier versions, and the session-only records kept
   * while cross-session memory is off.
   */
  recordOriginals: StoredEntityMap;
  /**
   * The tab ledger: `token -> original` for what this page session put into
   * a composer. Present even before anything has been filed, which is what
   * keeps the first message of a conversation resolvable.
   */
  ledger: StoredEntityMap;
  /** Unaltered, strictly-formed tokens seen on the page. */
  observed: Iterable<string>;
  vault: IdentityVaultData;
  /** Honours the `identityVaultEnabled` setting. */
  vaultEnabled: boolean;
}

/** What a page may resolve, and how. */
export interface ConversationScope {
  /** Number of distinct tokens in scope. */
  readonly size: number;
  /** Resolve every token this scope admits that occurs in `text`. */
  resolve(text: string): ResolveResult;
  /** True when `token` is in scope at all. */
  has(token: string): boolean;
  /**
   * Cheap pre-gate: false means `resolve` would certainly find nothing.
   *
   * A true answer promises nothing. It exists so a walk over every text node
   * on a page does not pay for a full resolve on each one.
   */
  mightResolve(text: string): boolean;
}

/** A scope that resolves nothing. Used before the first read completes. */
export function emptyScope(): ConversationScope {
  return {
    size: 0,
    resolve: (text) => ({ matches: [], deAnonText: text }),
    has: () => false,
    mightResolve: () => false,
  };
}

/**
 * Compose the scope for one page from everything currently known about it.
 *
 * Cheap and pure, so callers rebuild it rather than mutate it: the scope
 * grows as the page is scanned and as records load, and a banner that
 * resolves against a snapshot taken when it attached would be wrong for the
 * rest of the page's life.
 */
export function buildConversationScope(sources: ScopeSources): ConversationScope {
  const { vault, vaultEnabled } = sources;

  // Records that came with their own originals, plus this session's ledger.
  // `augmentEntityMap` adds the vault's other form for any record present
  // here, so a model echoing the synthetic where the placeholder was sent
  // still resolves.
  const carried: StoredEntityMap = { ...sources.recordOriginals, ...sources.ledger };
  const scoped: StoredEntityMap = augmentEntityMap(carried, vault, vaultEnabled).toStored();

  // Tokens filed under this conversation resolve through the vault, which is
  // the sole source of originals for records in the current shape.
  for (const token of sources.recordTokens) {
    addVaultForms(scoped, token, vault, vaultEnabled);
  }

  const tolerant = new Set(Object.keys(scoped));

  // Observation admits a token on the strength of its exact form alone, so
  // that is the only form it may be matched in — including the other form of
  // the same vault record, which is admitted with it.
  const strictOnly = new Set<string>();
  for (const token of sources.observed) {
    if (tolerant.has(token)) continue;
    addVaultForms(scoped, token, vault, vaultEnabled);
  }
  for (const key of Object.keys(scoped)) {
    if (!tolerant.has(key)) strictOnly.add(key);
  }

  const entityMap = new EntityMap(scoped);
  const options = strictOnly.size > 0 ? { strictOnly } : {};
  // Synthetic stand-ins carry no placeholder shape, so the cheap gate has to
  // look for them literally. Longest first is irrelevant here — one hit is
  // the whole answer.
  const literalKeys = Object.keys(scoped).filter((key) => !key.startsWith('['));

  return {
    size: entityMap.size,
    resolve: (text) => resolveText(text, entityMap, options),
    has: (token) => entityMap.getOriginal(token) !== undefined,
    mightResolve: (text) =>
      hasPotentialPlaceholderShape(text) || literalKeys.some((key) => text.includes(key)),
  };
}

/**
 * Register both forms of the vault record `token` belongs to.
 *
 * A record's placeholder and its synthetic stand-in name the same identity,
 * and a model may echo back either regardless of which was sent, so admitting
 * one admits both. Does nothing when the vault is off or does not know the
 * token — with no original there is nothing to reveal, which is the correct
 * outcome rather than a gap.
 */
function addVaultForms(
  into: StoredEntityMap,
  token: string,
  vault: IdentityVaultData,
  vaultEnabled: boolean,
): void {
  if (!vaultEnabled || into[token] !== undefined) return;

  const record = vault.records.find(
    (candidate) => candidate.placeholder === token || candidate.syntheticValue === token,
  );
  if (!record) return;

  into[record.placeholder] = record.originalText;
  if (record.syntheticValue) into[record.syntheticValue] = record.originalText;
}
