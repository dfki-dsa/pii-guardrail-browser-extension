import type { EntityType, Settings } from './message-types';
import { groupForEntity } from './category-groups';

interface CategoryThreshold {
  baseline: number;
  delta: number;
}

// Per-category baselines and headroom deltas.
// Slider at 0 → threshold = clamp(baseline + delta, 0, 1) — strictest (fewest detections)
// Slider at 1 → threshold = clamp(baseline - delta, 0, 1) — loosest (most detections)
// Slider at 0.5 → threshold = baseline
export const CATEGORY_THRESHOLDS: Record<EntityType, CategoryThreshold> = {
  PASSWORD:     { baseline: 0.70, delta: 0.05 }, // barely shifts — tight by design
  CREDIT_CARD:  { baseline: 0.50, delta: 0.15 },
  SSN:          { baseline: 0.50, delta: 0.15 },
  IBAN:         { baseline: 0.50, delta: 0.15 },
  BANK_ACCOUNT: { baseline: 0.50, delta: 0.15 },
  EMAIL:        { baseline: 0.40, delta: 0.20 },
  PHONE:        { baseline: 0.40, delta: 0.20 },
  ADDRESS:      { baseline: 0.50, delta: 0.20 },
  PERSON:       { baseline: 0.50, delta: 0.20 },
  USERNAME:     { baseline: 0.50, delta: 0.20 },
  IP_ADDRESS:   { baseline: 0.50, delta: 0.20 },
  LOCATION:     { baseline: 0.50, delta: 0.20 },
  ORGANIZATION: { baseline: 0.50, delta: 0.20 },
  URL:          { baseline: 0.50, delta: 0.30 }, // loose — shifts a lot
  DATE:         { baseline: 0.40, delta: 0.30 }, // loose — shifts a lot
  MISC:         { baseline: 0.50, delta: 0.20 },
};

type ResolverSettings = Pick<Settings, 'minConfidence' | 'sensitivityMode' | 'groupThresholds'>;

/**
 * Resolve the effective confidence threshold for a given entity type.
 *
 * Global mode: maps minConfidence [0,1] linearly between ceiling and floor.
 *   ceiling = clamp(baseline + delta, 0, 1) — threshold when slider is at 0
 *   floor   = clamp(baseline - delta, 0, 1) — threshold when slider is at 1
 *
 * Individual mode: if the entity's group has a per-group slider override in
 * groupThresholds, that override position (0–1) replaces minConfidence in the
 * headroom math. Falls back to minConfidence when no override is set.
 */
export function resolveThreshold(settings: ResolverSettings, entityType: EntityType): number {
  let sliderPos = settings.minConfidence;

  if (settings.sensitivityMode === 'individual') {
    const group = groupForEntity(entityType);
    if (group !== null) {
      const override = settings.groupThresholds[group];
      if (override !== undefined) {
        sliderPos = override;
      }
    }
  }

  const { baseline, delta } = CATEGORY_THRESHOLDS[entityType];
  const floor = Math.max(0, baseline - delta);
  const ceiling = Math.min(1, baseline + delta);
  return ceiling - sliderPos * (ceiling - floor);
}

/**
 * Lowest threshold the resolver will produce for any entity type at the current slider position.
 * Use this as the WASM pipeline's min_confidence so it never pre-filters a span the resolver wants.
 */
export function minResolvedThreshold(settings: ResolverSettings): number {
  const types = Object.keys(CATEGORY_THRESHOLDS) as EntityType[];
  return Math.min(...types.map((t) => resolveThreshold(settings, t)));
}
