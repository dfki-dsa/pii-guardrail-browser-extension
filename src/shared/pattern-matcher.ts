export interface PatternMatch {
  start: number;
  end: number;
  text: string;
}

function buildRegex(pattern: string): RegExp {
  // Escape all regex special chars except *
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  // * expands to \w+ (word chars only — no cross-word matching)
  const source = escaped.replace(/\*/g, '\\w+');
  return new RegExp(`(^|[^A-Za-z0-9_])(${source})(?=$|[^A-Za-z0-9_])`, 'gi');
}

/**
 * Find all whole-word, case-insensitive occurrences of `pattern` in `text`.
 * `*` in the pattern expands to one or more word characters (no spaces).
 */
export function matchPattern(text: string, pattern: string): PatternMatch[] {
  const regex = buildRegex(pattern);
  const results: PatternMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const prefix = m[1] ?? '';
    const matchedText = m[2] ?? '';
    const start = m.index + prefix.length;
    results.push({ start, end: start + matchedText.length, text: matchedText });
  }
  return results;
}
