import type { PasteReviewMode, PiiSpan, Settings } from './message-types';

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

/**
 * Whether auto-mode is on.
 *
 * Compared against the one value that opts in, so that anything else —
 * settings not loaded yet, a value this version does not know — means the
 * review pop-up is shown.
 */
export function isAutoMode(settings: Pick<Settings, 'pasteReviewMode'> | null | undefined): boolean {
  return settings?.pasteReviewMode === 'auto';
}

/** The setting value for an auto-mode switch that is on or off. */
export function pasteReviewModeFor(autoMode: boolean): PasteReviewMode {
  return autoMode ? 'auto' : 'review';
}
