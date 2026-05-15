import { filterByGroup } from '../shared/category-groups';
import { findCodeRegions } from '../shared/code-region-finder';
import {
  applyAllowlistToText,
  applyBlocklist,
} from '../shared/feedback';
import { resolveThreshold } from '../shared/sensitivity-resolver';
import { byteOffsetToStringIndex } from '../shared/text-offsets';
import type { PiiSpan, Settings } from '../shared/message-types';

function tagCodeBlockSpans(spans: PiiSpan[], text: string): PiiSpan[] {
  const regions = findCodeRegions(text);
  if (regions.length === 0) return spans;
  return spans.map((span) => {
    const charIdx = byteOffsetToStringIndex(text, span.start);
    const inCode = regions.some((r) => charIdx >= r.start && charIdx < r.end);
    return inCode ? { ...span, inCodeBlock: true } : span;
  });
}

export function prepareReviewSpans(
  originalText: string,
  rawSpans: PiiSpan[],
  settings: Settings,
  adaptiveThresholds: Record<string, number>,
): PiiSpan[] {
  const groupFiltered = filterByGroup(rawSpans, settings.groupsEnabled);
  let spans = applyAllowlistToText(originalText, groupFiltered, settings.allowlist);
  spans = spans.filter((span) => {
    const base = resolveThreshold(settings, span.entity_type);
    const threshold = adaptiveThresholds[span.entity_type] ?? base;
    return span.score >= threshold;
  });
  spans = applyBlocklist(originalText, spans, settings.blocklist);

  return settings.skipCodeBlocks ? tagCodeBlockSpans(spans, originalText) : spans;
}
