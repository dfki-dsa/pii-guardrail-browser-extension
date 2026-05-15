import type { AllowlistEntry, BlocklistEntry } from './message-types';

type ListEntry = AllowlistEntry | BlocklistEntry;

export function normalizeListPattern(pattern: string): string {
  return pattern.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function findConflictingPattern(pattern: string, entries: ListEntry[]): string | null {
  const normalized = normalizeListPattern(pattern);
  const conflict = entries.find((entry) => normalizeListPattern(entry.pattern) === normalized);
  return conflict?.pattern ?? null;
}
