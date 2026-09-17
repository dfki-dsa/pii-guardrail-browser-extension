import type { OnboardingPlacement } from './onboarding-content';

export type Rect = { left: number; top: number; width: number; height: number };
export type OnboardingPosition = {
  left: number;
  top: number;
  placement: OnboardingPlacement | 'floating';
  arrowLeft: number | null;
  /** Target centre in shell-relative coordinates for the visual spotlight. */
  targetCenterX: number | null;
  targetCenterY: number | null;
};

const MARGIN = 12;
const GAP = 10;
const CORNER_CLEARANCE = 18;

/** Calculates shell-relative coordinates, keeping the card and pointer usable. */
export function positionCoachmark(
  shell: Rect,
  target: Rect | null,
  card: Pick<Rect, 'width' | 'height'>,
  preferred: OnboardingPlacement,
): OnboardingPosition {
  const maxLeft = Math.max(MARGIN, shell.width - card.width - MARGIN);
  if (!target || target.width <= 0 || target.height <= 0 || card.width > shell.width - MARGIN * 2 || card.height > shell.height - MARGIN * 2) {
    return { left: Math.max(MARGIN, (shell.width - card.width) / 2), top: MARGIN, placement: 'floating', arrowLeft: null, targetCenterX: null, targetCenterY: null };
  }

  const targetCenter = target.left - shell.left + target.width / 2;
  const targetCenterY = target.top - shell.top + target.height / 2;
  const above = target.top - shell.top - card.height - GAP;
  const below = target.top - shell.top + target.height + GAP;
  const canAbove = above >= MARGIN;
  const canBelow = below + card.height <= shell.height - MARGIN;
  const placement = preferred === 'above'
    ? (canAbove ? 'above' : canBelow ? 'below' : 'floating')
    : (canBelow ? 'below' : canAbove ? 'above' : 'floating');

  if (placement === 'floating') {
    return { left: Math.max(MARGIN, (shell.width - card.width) / 2), top: MARGIN, placement, arrowLeft: null, targetCenterX: null, targetCenterY: null };
  }

  const left = Math.min(maxLeft, Math.max(MARGIN, targetCenter - card.width / 2));
  const arrowLeft = Math.min(card.width - CORNER_CLEARANCE, Math.max(CORNER_CLEARANCE, targetCenter - left));
  return { left, top: placement === 'above' ? above : below, placement, arrowLeft, targetCenterX: targetCenter, targetCenterY };
}
