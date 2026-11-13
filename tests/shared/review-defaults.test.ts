import { isApprovedByDefault, selectDefaultApproved } from '../../src/shared/review-defaults';
import type { PiiSpan } from '../../src/shared/message-types';

function span(overrides: Partial<PiiSpan>): PiiSpan {
  return {
    start: 0,
    end: 4,
    entity_type: 'PERSON',
    score: 0.9,
    text: 'Jane',
    source: 'ner',
    ...overrides,
  };
}

describe('default review selection', () => {
  it('approves a span at or above its threshold', () => {
    expect(isApprovedByDefault(span({ score: 0.5 }), 0.5)).toBe(true);
    expect(isApprovedByDefault(span({ score: 0.91 }), 0.5)).toBe(true);
  });

  it('leaves a span below its threshold alone', () => {
    expect(isApprovedByDefault(span({ score: 0.49 }), 0.5)).toBe(false);
  });

  it('leaves a span inside a skipped code block alone however confident it is', () => {
    expect(isApprovedByDefault(span({ score: 1, inCodeBlock: true }), 0.5)).toBe(false);
  });

  it('approves a blocklist span, which is always injected at full confidence', () => {
    expect(
      isApprovedByDefault(span({ score: 1.0, source: 'manual', entity_type: 'MISC' }), 0.95),
    ).toBe(true);
  });

  it('selects with each span judged against its own threshold, keeping order', () => {
    const person = span({ text: 'Jane', entity_type: 'PERSON', score: 0.6 });
    const email = span({ text: 'j@x.io', entity_type: 'EMAIL', score: 0.6 });
    const inCode = span({ text: 'Bob', score: 0.99, inCodeBlock: true });
    const location = span({ text: 'Kiel', entity_type: 'LOCATION', score: 0.8 });

    const thresholds: Record<string, number> = {
      PERSON: 0.5,
      EMAIL: 0.7,
      LOCATION: 0.8,
    };

    expect(
      selectDefaultApproved(
        [person, email, inCode, location],
        (s) => thresholds[s.entity_type] ?? 0.5,
      ),
    ).toEqual([person, location]);
  });

  it('selects nothing from nothing', () => {
    expect(selectDefaultApproved([], () => 0.5)).toEqual([]);
  });
});
