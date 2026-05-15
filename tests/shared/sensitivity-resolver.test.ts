import type { EntityType, GroupName, Settings } from '../../src/shared/message-types';
import {
  resolveThreshold,
  minResolvedThreshold,
  CATEGORY_THRESHOLDS,
} from '../../src/shared/sensitivity-resolver';

type ResolverSettings = Pick<Settings, 'minConfidence' | 'sensitivityMode' | 'groupThresholds'>;

function settings(
  minConfidence: number,
  sensitivityMode: 'global' | 'individual' = 'global',
  groupThresholds: Partial<Record<GroupName, number>> = {},
): ResolverSettings {
  return { minConfidence, sensitivityMode, groupThresholds };
}

function expectedThreshold(entityType: EntityType, sliderPos: number): number {
  const { baseline, delta } = CATEGORY_THRESHOLDS[entityType];
  const floor = Math.max(0, baseline - delta);
  const ceiling = Math.min(1, baseline + delta);
  return ceiling - sliderPos * (ceiling - floor);
}

const ALL_ENTITY_TYPES = Object.keys(CATEGORY_THRESHOLDS) as EntityType[];

// --- Baseline: slider at 0.5 equals each category's baseline threshold ---

describe('resolveThreshold — slider at 0.5 equals baseline', () => {
  test.each([
    ['PERSON',       0.50],
    ['EMAIL',        0.40],
    ['PHONE',        0.40],
    ['PASSWORD',     0.70],
    ['CREDIT_CARD',  0.50],
    ['SSN',          0.50],
    ['IBAN',         0.50],
    ['BANK_ACCOUNT', 0.50],
    ['IP_ADDRESS',   0.50],
    ['LOCATION',     0.50],
    ['ORGANIZATION', 0.50],
    ['ADDRESS',      0.50],
    ['USERNAME',     0.50],
    ['URL',          0.50],
    ['DATE',         0.40],
    ['MISC',         0.50],
  ] as [EntityType, number][])(
    '%s at slider=0.5 → baseline %f',
    (entityType, baseline) => {
      expect(resolveThreshold(settings(0.5), entityType)).toBeCloseTo(baseline, 10);
    },
  );
});

// --- Slider at 0: threshold = ceiling (fewest detections) ---

describe('resolveThreshold — slider at 0 → ceiling (strictest)', () => {
  test.each([
    ['PERSON',   Math.min(1, 0.50 + 0.20)] as [EntityType, number],
    ['PASSWORD', Math.min(1, 0.70 + 0.05)] as [EntityType, number],
    ['DATE',     Math.min(1, 0.40 + 0.30)] as [EntityType, number],
    ['EMAIL',    Math.min(1, 0.40 + 0.20)] as [EntityType, number],
  ])(
    '%s at slider=0 → ceiling %f',
    (entityType, ceiling) => {
      expect(resolveThreshold(settings(0), entityType)).toBeCloseTo(ceiling, 10);
    },
  );
});

// --- Slider at 1: threshold = floor (most detections) ---

describe('resolveThreshold — slider at 1 → floor (loosest)', () => {
  test.each([
    ['PERSON',   Math.max(0, 0.50 - 0.20)] as [EntityType, number],
    ['PASSWORD', Math.max(0, 0.70 - 0.05)] as [EntityType, number],
    ['DATE',     Math.max(0, 0.40 - 0.30)] as [EntityType, number],
    ['EMAIL',    Math.max(0, 0.40 - 0.20)] as [EntityType, number],
  ])(
    '%s at slider=1 → floor %f',
    (entityType, floor) => {
      expect(resolveThreshold(settings(1), entityType)).toBeCloseTo(floor, 10);
    },
  );
});

// --- Headroom span: PASSWORD barely shifts, DATE shifts a lot ---

describe('resolveThreshold — headroom span', () => {
  test('PASSWORD span (2 × 0.05 delta) is narrow', () => {
    const atMin = resolveThreshold(settings(0), 'PASSWORD');
    const atMax = resolveThreshold(settings(1), 'PASSWORD');
    expect(Math.abs(atMax - atMin)).toBeCloseTo(0.10, 10);
  });

  test('DATE span (2 × 0.30 delta) is wide', () => {
    const atMin = resolveThreshold(settings(0), 'DATE');
    const atMax = resolveThreshold(settings(1), 'DATE');
    expect(Math.abs(atMax - atMin)).toBeCloseTo(0.60, 10);
  });

  test('PASSWORD span is narrower than PERSON span', () => {
    const passwordSpan = Math.abs(
      resolveThreshold(settings(0), 'PASSWORD') - resolveThreshold(settings(1), 'PASSWORD'),
    );
    const personSpan = Math.abs(
      resolveThreshold(settings(0), 'PERSON') - resolveThreshold(settings(1), 'PERSON'),
    );
    expect(passwordSpan).toBeLessThan(personSpan);
  });
});

// --- Clamping: floor ≥ 0, ceiling ≤ 1 for every category ---

describe('resolveThreshold — clamping', () => {
  test('all categories: slider=0 threshold is ≤ 1', () => {
    for (const et of ALL_ENTITY_TYPES) {
      expect(resolveThreshold(settings(0), et)).toBeLessThanOrEqual(1);
    }
  });

  test('all categories: slider=1 threshold is ≥ 0', () => {
    for (const et of ALL_ENTITY_TYPES) {
      expect(resolveThreshold(settings(1), et)).toBeGreaterThanOrEqual(0);
    }
  });

  test('all categories: slider=0 threshold is ≥ 0', () => {
    for (const et of ALL_ENTITY_TYPES) {
      expect(resolveThreshold(settings(0), et)).toBeGreaterThanOrEqual(0);
    }
  });
});

// --- Linear interpolation ---

describe('resolveThreshold — linear interpolation', () => {
  const CASES: EntityType[] = ['PERSON', 'PASSWORD', 'DATE', 'EMAIL'];

  test.each(CASES)('%s at 0.5 is midpoint of slider=0 and slider=1', (entityType) => {
    const atZero = resolveThreshold(settings(0), entityType);
    const atOne  = resolveThreshold(settings(1), entityType);
    const atHalf = resolveThreshold(settings(0.5), entityType);
    expect(atHalf).toBeCloseTo((atZero + atOne) / 2, 10);
  });

  test.each(CASES)('%s decreases monotonically as slider increases', (entityType) => {
    const positions = [0, 0.25, 0.5, 0.75, 1.0];
    const thresholds = positions.map((p) => resolveThreshold(settings(p), entityType));
    for (let i = 1; i < thresholds.length; i++) {
      expect(thresholds[i]).toBeLessThanOrEqual(thresholds[i - 1]);
    }
  });
});

// --- Individual mode ---

describe('resolveThreshold — individual mode with group overrides', () => {
  function indiv(
    minConfidence: number,
    groupThresholds: Partial<Record<GroupName, number>>,
  ): ResolverSettings {
    return settings(minConfidence, 'individual', groupThresholds);
  }

  test('group override replaces minConfidence in headroom math for that entity', () => {
    const overridePos = 0.8;
    const { baseline, delta } = CATEGORY_THRESHOLDS['PERSON'];
    const floor = Math.max(0, baseline - delta);
    const ceiling = Math.min(1, baseline + delta);
    const expected = ceiling - overridePos * (ceiling - floor);
    expect(resolveThreshold(indiv(0.5, { Identity: 0.8 }), 'PERSON')).toBeCloseTo(expected, 10);
  });

  test('group override applies to every entity in the group', () => {
    const overridePos = 0.3;
    const s = indiv(0.5, { Contact: overridePos });
    for (const et of ['EMAIL', 'PHONE', 'ADDRESS'] as EntityType[]) {
      const { baseline, delta } = CATEGORY_THRESHOLDS[et];
      const floor = Math.max(0, baseline - delta);
      const ceiling = Math.min(1, baseline + delta);
      expect(resolveThreshold(s, et)).toBeCloseTo(ceiling - overridePos * (ceiling - floor), 10);
    }
  });

  test('entity in un-overridden group falls back to minConfidence headroom math', () => {
    // Identity has override but Contact does not
    const s = indiv(0.7, { Identity: 0.9 });
    expect(resolveThreshold(s, 'EMAIL'))
      .toBeCloseTo(resolveThreshold(settings(0.7, 'global'), 'EMAIL'), 10);
  });

  test('MISC uses Low-signal group override when set', () => {
    const s = indiv(0.6, { 'Low-signal': 0.9 });
    expect(resolveThreshold(s, 'MISC'))
      .toBeCloseTo(resolveThreshold(settings(0.9, 'global'), 'MISC'), 10);
  });

  test('override at 0.5 matches global math at 0.5 for the same group', () => {
    expect(resolveThreshold(indiv(0.3, { Identity: 0.5 }), 'PERSON'))
      .toBeCloseTo(resolveThreshold(settings(0.5, 'global'), 'PERSON'), 10);
  });

  test('empty groupThresholds falls back to global math for all entity types', () => {
    const indivNoOverrides = indiv(0.5, {});
    const globalSame = settings(0.5, 'global');
    for (const et of ALL_ENTITY_TYPES) {
      expect(resolveThreshold(indivNoOverrides, et)).toBeCloseTo(resolveThreshold(globalSame, et), 10);
    }
  });

  test('override at 0 gives strictest (ceiling) threshold for that group', () => {
    const { baseline, delta } = CATEGORY_THRESHOLDS['PASSWORD'];
    const ceiling = Math.min(1, baseline + delta);
    expect(resolveThreshold(indiv(0.5, { Password: 0 }), 'PASSWORD')).toBeCloseTo(ceiling, 10);
  });

  test('override at 1 gives loosest (floor) threshold for that group', () => {
    const { baseline, delta } = CATEGORY_THRESHOLDS['PASSWORD'];
    const floor = Math.max(0, baseline - delta);
    expect(resolveThreshold(indiv(0.5, { Password: 1 }), 'PASSWORD')).toBeCloseTo(floor, 10);
  });

  test('multiple group overrides are independent', () => {
    const s = indiv(0.5, { Identity: 0.1, Financial: 0.9 });

    // Identity group at override 0.1 → strict
    const personStrict = resolveThreshold(s, 'PERSON');
    const personLoose = resolveThreshold(indiv(0.5, { Identity: 0.9 }), 'PERSON');
    expect(personStrict).toBeGreaterThan(personLoose); // stricter → higher threshold

    // Financial group at override 0.9 → loose
    const ccLoose = resolveThreshold(s, 'CREDIT_CARD');
    const ccStrict = resolveThreshold(indiv(0.5, { Financial: 0.1 }), 'CREDIT_CARD');
    expect(ccLoose).toBeLessThan(ccStrict); // looser → lower threshold
  });
});

// --- minResolvedThreshold ---

describe('minResolvedThreshold', () => {
  test('equals the minimum resolveThreshold across all entity types', () => {
    const positions = [0, 0.25, 0.5, 0.75, 1.0];
    for (const pos of positions) {
      const s = settings(pos);
      const manual = Math.min(...ALL_ENTITY_TYPES.map((t) => resolveThreshold(s, t)));
      expect(minResolvedThreshold(s)).toBeCloseTo(manual, 10);
    }
  });

  test('is lower at slider=1 than at slider=0 (more spans allowed at high sensitivity)', () => {
    expect(minResolvedThreshold(settings(1))).toBeLessThan(minResolvedThreshold(settings(0)));
  });
});
