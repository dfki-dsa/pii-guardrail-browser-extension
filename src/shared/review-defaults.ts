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

/**
 * Identity of a value within one review. Spans with the same text and the
 * same detected type are one decision for the user: the pop-up lists them
 * once, and a choice made there applies to every occurrence. Spans inside a
 * code block are kept apart, because they are listed and defaulted separately.
 */
export function reviewGroupKey(span: PiiSpan): string {
  return `${span.inCodeBlock ? 'code' : 'text'}\u0000${span.entity_type}\u0000${span.text}`;
}

/**
 * Default selection for each span, in order.
 *
 * A span is selected when it passes `isApprovedByDefault` itself, or when an
 * identical value elsewhere in the text does. The same string must not be
 * replaced in one place and left in clear in another only because the model
 * was less sure about one occurrence.
 */
export function defaultApprovals(
  spans: readonly PiiSpan[],
  thresholdFor: (span: PiiSpan) => number,
): boolean[] {
  const own = spans.map((span) => isApprovedByDefault(span, thresholdFor(span)));
  const approvedKeys = new Set<string>();
  spans.forEach((span, i) => {
    if (own[i]) approvedKeys.add(reviewGroupKey(span));
  });
  return spans.map((span, i) => own[i] || approvedKeys.has(reviewGroupKey(span)));
}

/** The spans the review pop-up would have pre-ticked, in their original order. */
export function selectDefaultApproved(
  spans: readonly PiiSpan[],
  thresholdFor: (span: PiiSpan) => number,
): PiiSpan[] {
  const approvals = defaultApprovals(spans, thresholdFor);
  return spans.filter((_, i) => approvals[i]);
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
