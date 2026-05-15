/**
 * Privacy Guardrail — Placeholder Variant Matcher
 *
 * Pure module for tolerantly matching the placeholders we emit
 * (`[PERSON_1]`, `[EMAIL_2]`, …) when an LLM mangles them on the way
 * back. Observed manglings include dropped brackets, lower-cased type,
 * underscore replaced with a space, missing separator, and one-sided
 * brackets. See `docs/prd-placeholder-restoration-robustness.md`.
 *
 * The module is deliberately deep and pure: inputs are strings and an
 * iterable of canonical placeholder strings; outputs are matches or a
 * regex. No I/O, no DOM, no `EntityMap` dependency.
 *
 * Restoration must always be gated against a known canonical set so
 * arbitrary all-caps tokens (`HTTP_2`, `ASCII_1`) are never touched.
 */

/** Strict canonical shape used to validate / parse a placeholder. */
const CANONICAL_PLACEHOLDER_REGEX = /^\[([A-Z][A-Z_]*)_(\d+)\]$/;

export interface ParsedPlaceholder {
  /** Bracket-stripped type, e.g. `PERSON` or `BANK_ACCOUNT`. */
  type: string;
  /** Numeric suffix. */
  index: number;
}

/**
 * Parse `[TYPE_N]` into its parts. Returns null when the string is not
 * a strict canonical placeholder — synthetic-value EntityMap keys and
 * arbitrary text are filtered out this way.
 */
export function parsePlaceholder(canonical: string): ParsedPlaceholder | null {
  const m = canonical.match(CANONICAL_PLACEHOLDER_REGEX);
  if (!m) return null;
  return { type: m[1], index: parseInt(m[2], 10) };
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Unicode-aware word-character predicate. Mirrors the helper used by the
 *  synthetic-substitution pass: letters of any script, digits, and `_`. */
const WORD_CHAR_RE = /[\p{L}\p{N}_]/u;

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR_RE.test(ch);
}

/**
 * Build a regex that matches all accepted variant forms of a single
 * canonical placeholder. The regex captures whether each bracket is
 * present so the caller can apply a Unicode-aware whole-word boundary
 * check on the bracket-less side(s).
 *
 * Capture groups:
 *   1 — opening `[` if present
 *   2 — closing `]` if present
 *
 * Falls back to a literal regex when given a non-canonical string. This
 * keeps the function total at the cost of doing nothing useful for
 * synthetic keys; callers should filter those out with `parsePlaceholder`
 * first.
 */
export function buildVariantRegex(canonical: string): RegExp {
  const parsed = parsePlaceholder(canonical);
  if (!parsed) {
    return new RegExp(escapeRegExp(canonical), 'g');
  }
  const typeEscaped = escapeRegExp(parsed.type);
  // Each bracket independently optional. Separator may be `_`, a single
  // space, or absent. Negative-digit lookahead prevents `PERSON_1` from
  // matching inside `PERSON_10`. Boundary on bracket-less sides is
  // enforced post-match (regex word-boundary `\b` is ASCII-only).
  const pattern = `(\\[)?${typeEscaped}[_ ]?${parsed.index}(?!\\d)(\\])?`;
  return new RegExp(pattern, 'gi');
}

export interface VariantMatch {
  /** Inclusive start offset in the source text. */
  start: number;
  /** Exclusive end offset in the source text. */
  end: number;
  /** Exact substring as it appears in the source text (mangled or not). */
  matchText: string;
  /** Canonical placeholder this variant resolves to (e.g. `[PERSON_1]`). */
  canonical: string;
}

/**
 * Find every accepted variant occurrence of any known placeholder in
 * `text`. Iteration is longest-index-first so that `PERSON_12` is
 * consumed before `PERSON_1`, and overlapping matches from later (shorter)
 * placeholders are dropped. The returned list is sorted by `start` and is
 * safe to apply left-to-right as substitutions.
 */
export function findVariantMatches(
  text: string,
  knownPlaceholders: Iterable<string>,
): VariantMatch[] {
  const parsedList: { canonical: string; parsed: ParsedPlaceholder }[] = [];
  for (const canonical of knownPlaceholders) {
    const parsed = parsePlaceholder(canonical);
    if (parsed) parsedList.push({ canonical, parsed });
  }
  // Longest index first; tiebreak by canonical length so `BANK_ACCOUNT_1`
  // wins over `EMAIL_1` when both indices are equal (defensive — neither
  // currently overlaps the other).
  parsedList.sort((a, b) => {
    if (b.parsed.index !== a.parsed.index) return b.parsed.index - a.parsed.index;
    return b.canonical.length - a.canonical.length;
  });

  const matches: VariantMatch[] = [];

  for (const { canonical } of parsedList) {
    const regex = buildVariantRegex(canonical);
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      const hasOpen = m[1] === '[';
      const hasClose = m[2] === ']';

      // Bracket-less sides need a Unicode-aware word boundary so that
      // `GMAILEMAIL_1` is rejected for `[EMAIL_1]` and `PERSON_1A` is
      // rejected for `[PERSON_1]`. Digit collisions on the right are
      // already excluded by the regex's `(?!\d)` lookahead.
      if (!hasOpen) {
        const before = start === 0 ? undefined : text[start - 1];
        if (isWordChar(before)) continue;
      }
      if (!hasClose) {
        const after = end >= text.length ? undefined : text[end];
        if (isWordChar(after)) continue;
      }

      // Drop matches that overlap a previously-recorded (longer-index)
      // match — guarantees `PERSON_12` wins when both `[PERSON_1]` and
      // `[PERSON_12]` are known and the text contains a `PERSON 12`.
      if (matches.some((p) => start < p.end && end > p.start)) continue;

      matches.push({ start, end, matchText: m[0], canonical });
    }
  }

  matches.sort((a, b) => a.start - b.start);
  return matches;
}

/**
 * Permissive shape predicate: returns true when the text contains a
 * substring that could plausibly be a placeholder variant. Cheap pre-gate
 * for the response observer, which doesn't have direct access to the
 * conversation's entity map. False positives are harmless because the
 * banner-attach path re-checks against the known set.
 */
export function hasPotentialPlaceholderShape(text: string): boolean {
  // Require at least two leading uppercase letters so single-letter
  // tokens (`A1`, `B_2`) don't trigger the gate. Type-internal
  // underscores are still permitted (`BANK_ACCOUNT_1`).
  return /\[?[A-Z]{2,}[A-Z_]*[_ ]?\d+(?!\d)\]?/.test(text);
}
