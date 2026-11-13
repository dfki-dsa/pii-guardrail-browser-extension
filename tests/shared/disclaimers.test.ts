import { LIMITS_DISCLAIMER, REVIEW_POPUP_DISCLAIMER } from '../../src/shared/project-links';

describe('limits-of-detection disclaimers', () => {
  it('keeps the full disclaimer, with its instruction to review, for the extension popup', () => {
    expect(LIMITS_DISCLAIMER).toBe(
      'Privacy Guardrail is assistive only and can miss or mis-flag sensitive content. Always review text before you send it.',
    );
  });

  it('shows the review pop-up the same statement without that instruction', () => {
    // The pop-up is the review, so it does not tell the user to review. It
    // must still be the same statement, word for word, not a second wording.
    expect(REVIEW_POPUP_DISCLAIMER).toBe(
      'Privacy Guardrail is assistive only and can miss or mis-flag sensitive content.',
    );
    expect(LIMITS_DISCLAIMER.startsWith(REVIEW_POPUP_DISCLAIMER)).toBe(true);
  });
});
