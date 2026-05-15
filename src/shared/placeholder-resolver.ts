/**
 * Privacy Guardrail — Placeholder Resolver (shared)
 *
 * Pure module mapping `(text, entityMap)` to a unified set of resolvable
 * matches plus a fully de-anonymised string. Single source of truth for
 * placeholder + synthetic-echo matching used by:
 *
 *   - the de-anon banner (highlight + reveal overlay + copy button)
 *   - the clipboard interceptor (trigger gate + Replace round-trip)
 *
 * Both surfaces must resolve identical inputs identically; they share this
 * module to prevent drift.
 *
 * No DOM, no storage, no `chrome.*` access. Inputs are a string and an
 * `EntityMap`; outputs are plain data.
 */

import { EntityMap } from './entity-map';
import {
  findVariantMatches,
  parsePlaceholder,
} from './placeholder-variants';

/** A single resolvable hit in the input text. */
export interface ResolverMatch {
  /** Inclusive start offset in the input text. */
  start: number;
  /** Exclusive end offset in the input text. */
  end: number;
  /** Substring as it appears in the input text (mangled or canonical or
   *  synthetic). */
  matchText: string;
  /** Resolved original value the match should be replaced with. */
  originalText: string;
  /** Lowercased entity-type label suitable as a CSS class suffix. For
   *  placeholder matches this is derived from the bracketed type; for
   *  synthetic matches the entity-map layer does not currently track type
   *  so we fall back to `'misc'`. */
  styleKey: string;
  /** Discriminator on how the match was found. Useful for tests and for
   *  future surfaces that want to render the two kinds differently. */
  kind: 'placeholder' | 'synthetic';
}

export interface ResolveResult {
  matches: ResolverMatch[];
  /** `text` with every match substituted for its original value. */
  deAnonText: string;
}

/** Returns true when a string is a strict canonical placeholder
 *  (`[PERSON_3]`, `[BANK_ACCOUNT_2]` …). The vault path also stores
 *  synthetic values as EntityMap keys; we need to distinguish them so the
 *  resolver picks the right matching strategy per key. */
function isPlaceholderKey(key: string): boolean {
  return parsePlaceholder(key) !== null;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Unicode-aware whole-word boundary check. We deliberately avoid `\b`
 *  because it is ASCII-only and mishandles diacritics and CJK scripts. The
 *  needle itself may begin/end with a non-word character (e.g. an IBAN
 *  with embedded spaces); in that case we accept any surrounding char. */
function hasWordBoundary(haystack: string, start: number, end: number): boolean {
  const before = start === 0 ? '' : haystack[start - 1];
  const after = end >= haystack.length ? '' : haystack[end];
  const isWordChar = (c: string): boolean => /\p{L}|\p{N}|_/u.test(c);
  const startBoundary = !before || !isWordChar(before) || !isWordChar(haystack[start]);
  const endBoundary = !after || !isWordChar(after) || !isWordChar(haystack[end - 1]);
  return startBoundary && endBoundary;
}

/**
 * Resolve every placeholder + synthetic-echo present in `text` against
 * `entityMap`. Pass order:
 *
 *   1. Tolerant placeholder pass (canonical + mangled variants), gated by
 *      the entity map's known canonical placeholders. Highest precedence.
 *   2. Synthetic pass over EntityMap keys that are NOT canonical
 *      placeholders. Whole-word boundary, longest-needle-first so
 *      "Jordan Park" wins over "Jordan" if both were ever mapped.
 *      Synthetics that overlap a placeholder match are dropped.
 *
 * Returned matches are sorted by `start` and are non-overlapping, so a
 * caller can apply them left-to-right as substitutions without further
 * bookkeeping.
 */
export function resolveText(text: string, entityMap: EntityMap): ResolveResult {
  const matches: ResolverMatch[] = [];

  // Pass 1 — placeholders, tolerant of LLM mangling.
  const knownPlaceholders = entityMap
    .entries()
    .map(([key]) => key)
    .filter(isPlaceholderKey);
  const variantMatches = findVariantMatches(text, knownPlaceholders);
  for (const vm of variantMatches) {
    const original = entityMap.getOriginal(vm.canonical);
    if (original === undefined) continue;
    const parsed = parsePlaceholder(vm.canonical);
    matches.push({
      start: vm.start,
      end: vm.end,
      matchText: vm.matchText,
      originalText: original,
      styleKey: parsed ? parsed.type.toLowerCase() : 'misc',
      kind: 'placeholder',
    });
  }

  // Pass 2 — synthetic echoes. Sort longest-key first so that "Jordan Park"
  // is matched before "Jordan" when both happen to be mapped.
  const syntheticEntries = entityMap
    .entries()
    .filter(([key]) => !isPlaceholderKey(key))
    .sort((a, b) => b[0].length - a[0].length);

  for (const [key, original] of syntheticEntries) {
    if (!key) continue;
    const re = new RegExp(escapeRegExp(key), 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + key.length;
      if (!hasWordBoundary(text, start, end)) continue;
      // Drop if region overlaps an already-recorded placeholder match.
      if (matches.some((p) => start < p.end && end > p.start)) continue;
      matches.push({
        start,
        end,
        matchText: key,
        originalText: original,
        styleKey: 'misc',
        kind: 'synthetic',
      });
      // Re-anchor past the inserted region so we don't loop on zero-width
      // matches if the needle were ever empty (defensive).
      re.lastIndex = end;
    }
  }

  matches.sort((a, b) => a.start - b.start);

  // Build deAnonText by walking the sorted, non-overlapping matches.
  let deAnonText: string;
  if (matches.length === 0) {
    deAnonText = text;
  } else {
    let result = '';
    let cursor = 0;
    for (const match of matches) {
      result += text.slice(cursor, match.start);
      result += match.originalText;
      cursor = match.end;
    }
    result += text.slice(cursor);
    deAnonText = result;
  }

  return { matches, deAnonText };
}
