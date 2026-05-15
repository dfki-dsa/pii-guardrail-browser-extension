import { EntityMap } from './entity-map';
import { PLACEHOLDER_REGEX } from './constants';
import type { IdentityVaultData } from './identity-vault';
import {
  findVariantMatches,
  parsePlaceholder,
  type VariantMatch,
} from './placeholder-variants';

/**
 * De-anonymize text by replacing placeholders with their original values.
 *
 * Two passes: first the strict-canonical pass (cheap regex, exact match),
 * then a tolerant variant pass that catches the common LLM-mangling forms
 * (`PERSON 1`, `[person_1]`, dropped brackets, etc.) gated against the
 * entity map's known placeholders. See
 * `docs/prd-placeholder-restoration-robustness.md`.
 *
 * @param text - Text containing placeholders like [PERSON_1], [EMAIL_1]
 * @param entityMap - The entity map containing placeholder → original mappings
 * @returns The de-anonymized text with original values restored
 */
export function deAnonymize(text: string, entityMap: EntityMap): string {
  // Pass 1 — strict canonical. Self-delimiting; no boundary check needed.
  const working = text.replace(PLACEHOLDER_REGEX, (match) => {
    const original = entityMap.getOriginal(match);
    return original !== undefined ? original : match;
  });

  // Pass 2 — mangled placeholders, gated by the known canonical set so
  // arbitrary all-caps tokens are never touched.
  return applyVariantMatches(working, entityMap.entries(), (canonical) =>
    entityMap.getOriginal(canonical),
  );
}

/**
 * Find all placeholders present in a text.
 * Returns an array of placeholder strings found.
 *
 * Strict canonical-only: callers who want a fast canonical-form check
 * still have one. Use `findVariantMatches` from `placeholder-variants`
 * for tolerant matching.
 */
export function findPlaceholders(text: string): string[] {
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(PLACEHOLDER_REGEX.source, 'g');
  while ((match = regex.exec(text)) !== null) {
    matches.push(match[0]);
  }
  return matches;
}

/**
 * Check if a text contains any placeholders.
 *
 * Strict canonical-only — see `findPlaceholders`.
 */
export function hasPlaceholders(text: string): boolean {
  const regex = new RegExp(PLACEHOLDER_REGEX.source);
  return regex.test(text);
}

/** Escape regex special characters in user-supplied strings before
 *  weaving them into a regex literal. Without this, a synthetic value
 *  containing punctuation would compile into an invalid pattern. */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Determine whether a substring matched in a free-form text is bounded
 *  by non-word characters on both sides. We avoid `\b` for unicode
 *  reasons (umlauts etc. confuse JavaScript's word boundary). */
function isWholeWordMatch(haystack: string, start: number, end: number): boolean {
  const before = start === 0 ? '' : haystack[start - 1];
  const after = end >= haystack.length ? '' : haystack[end];
  const isWordChar = (c: string): boolean => /\p{L}|\p{N}|_/u.test(c);
  // The "synthetic" can itself begin/end with a non-word character (e.g. an
  // IBAN with embedded spaces). In that case we accept boundary
  // conditions on the surrounding text only when the abutting char on the
  // synthetic side is also non-word — i.e. the visible boundary is real.
  const startBoundary = !before || !isWordChar(before) || !isWordChar(haystack[start]);
  const endBoundary = !after || !isWordChar(after) || !isWordChar(haystack[end - 1]);
  return startBoundary && endBoundary;
}

/** Internal: apply a set of variant matches as substitutions in
 *  apply-safe (left-to-right, non-overlapping) order. */
function applyVariantMatches(
  text: string,
  knownEntries: Iterable<readonly [string, string] | [string, string]>,
  resolveOriginal: (canonical: string) => string | undefined,
): string {
  const knownPlaceholders: string[] = [];
  for (const entry of knownEntries) {
    const key = entry[0];
    if (parsePlaceholder(key)) knownPlaceholders.push(key);
  }
  if (knownPlaceholders.length === 0) return text;

  const matches = findVariantMatches(text, knownPlaceholders);
  if (matches.length === 0) return text;

  let result = '';
  let cursor = 0;
  for (const match of matches) {
    const original = resolveOriginal(match.canonical);
    if (original === undefined) continue;
    result += text.slice(cursor, match.start);
    result += original;
    cursor = match.end;
  }
  result += text.slice(cursor);
  return result;
}

/**
 * Vault-aware de-anonymisation. Reverses both placeholders ([PERSON_1])
 * and synthetic values ("Jordan Park") back to the original text the
 * user pasted. Synthetic substrings are matched on whole-word boundaries
 * (Unicode-aware) to minimise the chance of accidentally substituting
 * unrelated occurrences in the LLM's response.
 *
 * Records whose `replacementMode` differs from what actually appears in
 * the response are still resolved — both the placeholder and the
 * synthetic of every record are valid reverse-keys so the user can flip
 * modes mid-conversation without losing the round-trip.
 *
 * Pass order:
 *   1. Strict canonical placeholder substitution.
 *   2. Mangled-placeholder pass (variant matcher gated by the known set).
 *   3. Synthetic-value substitution (whole-word, Unicode-aware).
 */
export function deAnonymizeWithVault(
  text: string,
  vaultData: IdentityVaultData,
): string {
  // Pass 1 — strict canonical placeholder substitution.
  let working = text.replace(PLACEHOLDER_REGEX, (match) => {
    const record = vaultData.records.find((r) => r.placeholder === match);
    return record ? record.originalText : match;
  });

  // Pass 2 — mangled-placeholder substitution. Only canonical placeholder
  // keys are sourced; synthetic values are handled in pass 3.
  working = applyVariantMatches(
    working,
    vaultData.records.map((r) => [r.placeholder, r.originalText] as const),
    (canonical) =>
      vaultData.records.find((r) => r.placeholder === canonical)?.originalText,
  );

  // Pass 3 — synthetic substitution. Walk records sorted by descending
  // length so that "Jordan Park" is matched before "Jordan" (avoiding
  // partial substitutions when both happen to be in the vault).
  const syntheticRecords = vaultData.records
    .filter((r) => r.syntheticValue.length > 0)
    .sort((a, b) => b.syntheticValue.length - a.syntheticValue.length);

  for (const record of syntheticRecords) {
    const needle = record.syntheticValue;
    const escaped = escapeRegExp(needle);
    const re = new RegExp(escaped, 'g');
    let result = '';
    let cursor = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(working)) !== null) {
      const start = m.index;
      const end = start + needle.length;
      if (!isWholeWordMatch(working, start, end)) {
        // Skip — it's a substring of a longer word.
        continue;
      }
      result += working.slice(cursor, start);
      result += record.originalText;
      cursor = end;
      // Important: continue scanning past the inserted original (which
      // may itself contain characters of `needle`). We re-anchor.
      re.lastIndex = end;
    }
    result += working.slice(cursor);
    working = result;
  }

  return working;
}

/** Returns true when the text contains any reversible placeholder OR any
 *  known synthetic value from the vault. Used by the response observer
 *  to decide whether to attach the de-anon banner. Tolerant of mangled
 *  placeholder forms — see `placeholder-variants`. */
export function hasReversibleContent(
  text: string,
  vaultData: IdentityVaultData,
): boolean {
  const knownPlaceholders = vaultData.records.map((r) => r.placeholder);
  if (findVariantMatches(text, knownPlaceholders).length > 0) return true;
  for (const record of vaultData.records) {
    if (record.syntheticValue && text.includes(record.syntheticValue)) {
      // We accept a coarse check here; full whole-word evaluation
      // happens during actual reversal.
      return true;
    }
  }
  return false;
}

/** Re-export for callers that want direct access to the variant matcher
 *  (used by the de-anon banner). */
export { findVariantMatches };
export type { VariantMatch };
