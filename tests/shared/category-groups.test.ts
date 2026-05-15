import type { EntityType } from '../../src/shared/message-types';
import {
  GROUP_NAMES,
  GROUP_MEMBERS,
  GROUP_DEFAULT_ON,
  groupForEntity,
  entitiesForGroup,
  defaultGroupsEnabled,
  filterByGroup,
} from '../../src/shared/category-groups';
import type { PiiSpan } from '../../src/shared/message-types';

function makeSpan(entityType: EntityType, text = 'x'): PiiSpan {
  return { start: 0, end: text.length, entity_type: entityType, score: 0.9, text, source: 'regex' };
}

// --- EntityType → group lookup ---

const ENTITY_TO_EXPECTED_GROUP: [EntityType, string][] = [
  ['PERSON', 'Identity'],
  ['USERNAME', 'Identity'],
  ['EMAIL', 'Contact'],
  ['PHONE', 'Contact'],
  ['ADDRESS', 'Contact'],
  ['CREDIT_CARD', 'Financial'],
  ['IBAN', 'Financial'],
  ['BANK_ACCOUNT', 'Financial'],
  ['SSN', 'Financial'],
  ['IP_ADDRESS', 'Network'],
  ['LOCATION', 'Location'],
  ['PASSWORD', 'Password'],
  ['ORGANIZATION', 'Organization'],
  ['URL', 'Low-signal'],
  ['DATE', 'Low-signal'],
  ['MISC', 'Low-signal'],
];

describe('groupForEntity', () => {
  test.each(ENTITY_TO_EXPECTED_GROUP)(
    '%s → %s',
    (entityType, expectedGroup) => {
      expect(groupForEntity(entityType)).toBe(expectedGroup);
    }
  );

  test('MISC → Low-signal', () => {
    expect(groupForEntity('MISC')).toBe('Low-signal');
  });
});

// --- Group → entity types + default state ---

describe('entitiesForGroup', () => {
  test('Identity contains PERSON and USERNAME', () => {
    expect(entitiesForGroup('Identity')).toEqual(expect.arrayContaining(['PERSON', 'USERNAME']));
    expect(entitiesForGroup('Identity')).toHaveLength(2);
  });

  test('Contact contains EMAIL, PHONE, ADDRESS', () => {
    const members = entitiesForGroup('Contact');
    expect(members).toEqual(expect.arrayContaining(['EMAIL', 'PHONE', 'ADDRESS']));
    expect(members).toHaveLength(3);
  });

  test('Financial contains CREDIT_CARD, IBAN, BANK_ACCOUNT, SSN', () => {
    const members = entitiesForGroup('Financial');
    expect(members).toEqual(expect.arrayContaining(['CREDIT_CARD', 'IBAN', 'BANK_ACCOUNT', 'SSN']));
    expect(members).toHaveLength(4);
  });

  test('Network contains IP_ADDRESS only', () => {
    expect(entitiesForGroup('Network')).toEqual(['IP_ADDRESS']);
  });

  test('Location contains LOCATION only', () => {
    expect(entitiesForGroup('Location')).toEqual(['LOCATION']);
  });

  test('Password contains PASSWORD only', () => {
    expect(entitiesForGroup('Password')).toEqual(['PASSWORD']);
  });

  test('Organization contains ORGANIZATION only', () => {
    expect(entitiesForGroup('Organization')).toEqual(['ORGANIZATION']);
  });

  test('Low-signal contains URL, DATE, and MISC', () => {
    const members = entitiesForGroup('Low-signal');
    expect(members).toEqual(expect.arrayContaining(['URL', 'DATE', 'MISC']));
    expect(members).toHaveLength(3);
  });
});

// --- Default on/off state ---

describe('GROUP_DEFAULT_ON', () => {
  test('all groups except Low-signal are on by default', () => {
    for (const group of GROUP_NAMES) {
      if (group === 'Low-signal') {
        expect(GROUP_DEFAULT_ON[group]).toBe(false);
      } else {
        expect(GROUP_DEFAULT_ON[group]).toBe(true);
      }
    }
  });

  test('defaultGroupsEnabled() returns a copy of defaults', () => {
    const a = defaultGroupsEnabled();
    const b = defaultGroupsEnabled();
    expect(a).toEqual(b);
    a['Identity'] = false;
    expect(b['Identity']).toBe(true); // copy, not shared reference
  });
});

// --- GROUP_NAMES completeness ---

describe('GROUP_NAMES', () => {
  test('has exactly 8 groups', () => {
    expect(GROUP_NAMES).toHaveLength(8);
  });

  test('every group appears in GROUP_MEMBERS', () => {
    for (const group of GROUP_NAMES) {
      expect(GROUP_MEMBERS[group]).toBeDefined();
    }
  });
});

// --- filterByGroup ---

describe('filterByGroup', () => {
  test('passes all spans when all groups are enabled', () => {
    const spans = [makeSpan('PERSON'), makeSpan('EMAIL'), makeSpan('URL')];
    const groupsEnabled = defaultGroupsEnabled();
    groupsEnabled['Low-signal'] = true;
    expect(filterByGroup(spans, groupsEnabled)).toHaveLength(3);
  });

  test('drops spans whose group is disabled', () => {
    const spans = [makeSpan('PERSON'), makeSpan('IP_ADDRESS'), makeSpan('EMAIL')];
    const groupsEnabled = defaultGroupsEnabled();
    groupsEnabled['Network'] = false;
    const result = filterByGroup(spans, groupsEnabled);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.entity_type)).toEqual(['PERSON', 'EMAIL']);
  });

  test('Low-signal off by default drops URL and DATE', () => {
    const spans = [makeSpan('PERSON'), makeSpan('URL'), makeSpan('DATE'), makeSpan('EMAIL')];
    const groupsEnabled = defaultGroupsEnabled(); // Low-signal is false
    const result = filterByGroup(spans, groupsEnabled);
    expect(result.map((s) => s.entity_type)).toEqual(['PERSON', 'EMAIL']);
  });

  test('MISC is filtered when Low-signal is disabled', () => {
    const spans = [makeSpan('MISC')];
    const groupsEnabled = defaultGroupsEnabled(); // Low-signal is false by default
    expect(filterByGroup(spans, groupsEnabled)).toHaveLength(0);
  });

  test('empty spans input returns empty array', () => {
    expect(filterByGroup([], defaultGroupsEnabled())).toEqual([]);
  });

  test('multiple groups disabled filters all their members', () => {
    const spans = [
      makeSpan('PERSON'),
      makeSpan('EMAIL'),
      makeSpan('CREDIT_CARD'),
      makeSpan('IP_ADDRESS'),
      makeSpan('PASSWORD'),
    ];
    const groupsEnabled = defaultGroupsEnabled();
    groupsEnabled['Contact'] = false;
    groupsEnabled['Financial'] = false;
    const result = filterByGroup(spans, groupsEnabled);
    expect(result.map((s) => s.entity_type)).toEqual(['PERSON', 'IP_ADDRESS', 'PASSWORD']);
  });
});
