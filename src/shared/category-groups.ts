import type { EntityType, GroupName } from './message-types';

export const GROUP_NAMES: readonly GroupName[] = [
  'Identity',
  'Contact',
  'Financial',
  'Network',
  'Location',
  'Password',
  'Organization',
  'Low-signal',
];

export const GROUP_MEMBERS: Readonly<Record<GroupName, readonly EntityType[]>> = {
  Identity: ['PERSON', 'USERNAME'],
  Contact: ['EMAIL', 'PHONE', 'ADDRESS'],
  Financial: ['CREDIT_CARD', 'IBAN', 'BANK_ACCOUNT', 'SSN'],
  Network: ['IP_ADDRESS'],
  Location: ['LOCATION'],
  Password: ['PASSWORD'],
  Organization: ['ORGANIZATION'],
  'Low-signal': ['URL', 'DATE', 'MISC'],
};

export const GROUP_DEFAULT_ON: Readonly<Record<GroupName, boolean>> = {
  Identity: true,
  Contact: true,
  Financial: true,
  Network: true,
  Location: true,
  Password: true,
  Organization: true,
  'Low-signal': false,
};

const ENTITY_TO_GROUP: Partial<Record<EntityType, GroupName>> = {};
for (const [group, types] of Object.entries(GROUP_MEMBERS) as [GroupName, EntityType[]][]) {
  for (const type of types) {
    ENTITY_TO_GROUP[type] = group;
  }
}

export function groupForEntity(entityType: EntityType): GroupName | null {
  return ENTITY_TO_GROUP[entityType] ?? null;
}

export function entitiesForGroup(group: GroupName): readonly EntityType[] {
  return GROUP_MEMBERS[group];
}

export function defaultGroupsEnabled(): Record<GroupName, boolean> {
  return { ...GROUP_DEFAULT_ON };
}

/** Filter spans to only those whose group is enabled. */
export function filterByGroup(
  spans: import('./message-types').PiiSpan[],
  groupsEnabled: Record<GroupName, boolean>,
): import('./message-types').PiiSpan[] {
  return spans.filter((span) => {
    const group = groupForEntity(span.entity_type);
    return group !== null && groupsEnabled[group] !== false;
  });
}
