import type { PiiSpan } from './message-types';

/**
 * The review pop-up's default selection, in one place.
 *
 * The pop-up pre-ticks a span with this rule, and automatic replacement
 * applies the same rule without showing the pop-up. Both read it from here so
 * "what auto mode replaces" can never drift from "what the pop-up would have
 * offered": a span inside a code block (tagged only when the user asked for
 * code to be skipped) or below its threshold is left alone.
 */
export function isApprovedByDefault(span: PiiSpan, threshold: number): boolean {
  return !span.inCodeBlock && span.score >= threshold;
}

/** The spans the review pop-up would have pre-ticked, in their original order. */
export function selectDefaultApproved(
  spans: readonly PiiSpan[],
  thresholdFor: (span: PiiSpan) => number,
): PiiSpan[] {
  return spans.filter((span) => isApprovedByDefault(span, thresholdFor(span)));
}
