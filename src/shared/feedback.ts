import type { AllowlistEntry, BlocklistEntry, FeedbackEntry, PiiSpan } from './message-types';
import { getFeedbackLog } from './storage';
import { matchPattern } from './pattern-matcher';
import { stringIndexToByteOffset } from './text-offsets';

/**
 * Compute adaptive confidence thresholds per entity type based on user feedback.
 *
 * When users frequently dismiss a particular entity type (false positives),
 * the threshold for that type increases. When users frequently add missed
 * entities, the threshold decreases.
 */
export async function computeAdaptiveThresholds(
  baseThreshold: number
): Promise<Record<string, number>> {
  const log = await getFeedbackLog();
  const thresholds: Record<string, number> = {};

  // Count corrections per entity type
  const dismissals: Record<string, number> = {};
  const additions: Record<string, number> = {};
  const total: Record<string, number> = {};

  for (const entry of log) {
    if (entry.detectedType && entry.correctedType === 'NOT_PII') {
      // False positive dismissed by user
      dismissals[entry.detectedType] = (dismissals[entry.detectedType] || 0) + 1;
      total[entry.detectedType] = (total[entry.detectedType] || 0) + 1;
    } else if (!entry.detectedType && entry.correctedType !== 'NOT_PII') {
      // Missed entity added by user
      additions[entry.correctedType] = (additions[entry.correctedType] || 0) + 1;
      total[entry.correctedType] = (total[entry.correctedType] || 0) + 1;
    }
  }

  // Adjust thresholds: more dismissals → higher threshold (stricter)
  for (const type of Object.keys(total)) {
    const dismissRate = (dismissals[type] || 0) / total[type];
    // Shift threshold up to 0.2 in either direction based on feedback
    const adjustment = (dismissRate - 0.5) * 0.4;
    thresholds[type] = Math.max(0.1, Math.min(0.99, baseThreshold + adjustment));
  }

  return thresholds;
}

/**
 * Filter spans whose full text is matched by any allowlist entry.
 * Matching is whole-word, case-insensitive, with * wildcard support.
 */
export function applyAllowlist(spans: PiiSpan[], allowlist: AllowlistEntry[]): PiiSpan[] {
  if (allowlist.length === 0) return spans;
  return spans.filter((span) => {
    return !allowlist.some((entry) => {
      const matches = matchPattern(span.text, entry.pattern);
      return matches.some((m) => m.start === 0 && m.end === span.text.length);
    });
  });
}

/**
 * Filter spans covered by any allowlist entry matched against the original text.
 * This catches detector output that splits an allowlisted phrase into smaller
 * spans, e.g. "John" and "Doe" when "John Doe" is allowlisted.
 */
export function applyAllowlistToText(
  text: string,
  spans: PiiSpan[],
  allowlist: AllowlistEntry[],
): PiiSpan[] {
  if (allowlist.length === 0 || spans.length === 0) return spans;

  const allowlistedRanges = allowlist.flatMap((entry) =>
    matchPattern(text, entry.pattern).map((match) => ({
      start: stringIndexToByteOffset(text, match.start),
      end: stringIndexToByteOffset(text, match.end),
    })),
  );

  if (allowlistedRanges.length === 0) return applyAllowlist(spans, allowlist);

  return applyAllowlist(spans, allowlist).filter((span) => {
    return !allowlistedRanges.some((range) => range.start <= span.start && range.end >= span.end);
  });
}

/**
 * Inject synthetic spans for each blocklist match that no detector already produced.
 * Injected spans get score 1.0 and source 'manual'. Blocklist wins on conflict with
 * the allowlist because this function is called after applyAllowlist — allowlist-suppressed
 * spans are not in `spans`, so blocklist re-injects them.
 */
export function applyBlocklist(text: string, spans: PiiSpan[], blocklist: BlocklistEntry[]): PiiSpan[] {
  if (blocklist.length === 0) return spans;
  const result = [...spans];
  for (const entry of blocklist) {
    const matches = matchPattern(text, entry.pattern);
    for (const match of matches) {
      const alreadyCovered = result.some((s) => s.start === match.start && s.end === match.end);
      if (alreadyCovered) continue;
      result.push({
        start: match.start,
        end: match.end,
        entity_type: entry.scope === 'any' ? 'MISC' : entry.scope,
        score: 1.0,
        text: match.text,
        source: 'manual',
      });
    }
  }
  return result;
}

/**
 * Apply adaptive thresholds to filter spans per entity type.
 */
export function applyAdaptiveThresholds(
  spans: PiiSpan[],
  thresholds: Record<string, number>,
  defaultThreshold: number
): PiiSpan[] {
  return spans.filter((span) => {
    const threshold = thresholds[span.entity_type] ?? defaultThreshold;
    return span.score >= threshold;
  });
}
