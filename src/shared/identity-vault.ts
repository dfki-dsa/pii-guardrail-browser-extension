/**
 * Privacy Guardrail — Identity Vault
 *
 * Global, cross-session, cross-provider mapping between detected PII and
 * the values used to anonymise it. The vault gives three properties that a
 * conversation-scoped EntityMap cannot:
 *
 *   1. **Consistency** — pasting "John Doe" today in ChatGPT and tomorrow in
 *      Claude resolves to the same placeholder/synthetic, so the LLM sees a
 *      stable identity across sessions and the de-anonymisation step never
 *      ambiguates.
 *   2. **User control** — every record is inspectable and editable from the
 *      options page. The user owns the table; pinned records are immune
 *      to automatic mutation.
 *   3. **Synthetic substitution** — each record carries both a typed
 *      placeholder (`[PERSON_3]`) and a realistic synthetic
 *      (`Jordan Park`). Either may be the active replacement, switchable
 *      per record, and the de-anonymiser knows how to reverse both.
 *
 * Storage uses a single `chrome.storage.local` key (`pg_identity_vault`).
 * Records are looked up by both exact original text and a normalised key
 * (lowercase + collapsed whitespace) so that "John Doe" and "john doe"
 * resolve to the same identity.
 *
 * The vault is intentionally NOT placed in `chrome.storage.sync` — vault
 * contents are plaintext PII and must not be replicated across devices
 * without an explicit user action (export/import, future feature).
 */

import type { EntityType, PiiSpan } from './message-types';
import { placeholder } from './constants';
import { generateSyntheticValue, supportsSynthetic } from './synthetic-pool';

/** Active replacement strategy for an individual vault record. */
export type ReplacementMode = 'placeholder' | 'synthetic';

/** A single identity stored in the vault. */
export interface IdentityRecord {
  /** Stable identifier (UUIDv4-ish) — used by UI to address the record. */
  id: string;
  /** Original text exactly as first observed. Whitespace preserved. */
  originalText: string;
  /** Normalised form used for lookup: lowercase, collapsed whitespace. */
  normalizedKey: string;
  /** Entity type assigned at creation; user can edit later. */
  entityType: EntityType;
  /** Typed placeholder (e.g. `[PERSON_3]`). Always present. */
  placeholder: string;
  /** Realistic synthetic replacement, pre-generated at creation. May be
   *  empty string for types where no safe synthetic is available; in that
   *  case `replacementMode` is forced back to 'placeholder'. */
  syntheticValue: string;
  /** Which value is currently emitted by the anonymiser. */
  replacementMode: ReplacementMode;
  /** When pinned, automated logic must not mutate this record. The user
   *  is the only writer. Pinned records survive "Clear unused" actions. */
  pinned: boolean;
  /** Free-text note set by the user. Optional. */
  notes?: string;
  /** Wall-clock millis. */
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
  /** How often the record has been hit by the anonymiser. */
  usageCount: number;
}

/** Persisted shape of the entire vault. */
export interface IdentityVaultData {
  records: IdentityRecord[];
  /** Monotonic per-type counters used to generate placeholders + synthetic
   *  pool indices. Lives at vault scope so numbering is consistent across
   *  conversations and providers. */
  counters: Partial<Record<EntityType, number>>;
  /** Schema version for future migrations. */
  version: number;
}

const VAULT_STORAGE_KEY = 'pg_identity_vault';
const CURRENT_SCHEMA_VERSION = 1;

/** Fresh, empty vault state. */
export function emptyVaultData(): IdentityVaultData {
  return { records: [], counters: {}, version: CURRENT_SCHEMA_VERSION };
}

/** Normalise text for lookup: trim + collapse whitespace + lowercase. */
export function normalizeKey(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Generate an id without depending on `crypto.randomUUID` (which is
 *  available in modern Chromium but not in older test runners). */
function makeId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `pg-${Date.now().toString(36)}-${rand}`;
}

/** Validate that a parsed value is a usable record. Used during load to
 *  drop malformed entries instead of crashing the extension. */
function isIdentityRecord(value: unknown): value is IdentityRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<IdentityRecord>;
  return (
    typeof r.id === 'string' &&
    typeof r.originalText === 'string' &&
    typeof r.normalizedKey === 'string' &&
    typeof r.entityType === 'string' &&
    typeof r.placeholder === 'string' &&
    typeof r.syntheticValue === 'string' &&
    (r.replacementMode === 'placeholder' || r.replacementMode === 'synthetic') &&
    typeof r.pinned === 'boolean' &&
    typeof r.createdAt === 'number' &&
    typeof r.updatedAt === 'number' &&
    typeof r.lastSeenAt === 'number' &&
    typeof r.usageCount === 'number'
  );
}

/**
 * Load the vault from chrome.storage.local. Always returns a usable
 * IdentityVaultData (synthesises an empty one if storage is empty or the
 * stored value is corrupted).
 */
export async function loadIdentityVault(): Promise<IdentityVaultData> {
  // chrome may be undefined in non-extension contexts (e.g. tests without
  // the harness). Caller is expected to mock it; we just return empty.
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return emptyVaultData();
  }
  const result = await chrome.storage.local.get(VAULT_STORAGE_KEY);
  const stored = result[VAULT_STORAGE_KEY];
  if (!stored || typeof stored !== 'object') return emptyVaultData();

  const records = Array.isArray(stored.records)
    ? stored.records.filter(isIdentityRecord)
    : [];
  const counters: Partial<Record<EntityType, number>> = {};
  if (stored.counters && typeof stored.counters === 'object') {
    for (const [k, v] of Object.entries(stored.counters)) {
      if (typeof v === 'number' && v >= 0 && Number.isFinite(v)) {
        counters[k as EntityType] = v;
      }
    }
  }
  return {
    records,
    counters,
    version: typeof stored.version === 'number' ? stored.version : CURRENT_SCHEMA_VERSION,
  };
}

/** Persist the vault. */
export async function saveIdentityVault(data: IdentityVaultData): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  await chrome.storage.local.set({ [VAULT_STORAGE_KEY]: data });
}

/** Clear all vault contents. Used by debug/reset paths. */
export async function clearIdentityVault(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  await chrome.storage.local.remove(VAULT_STORAGE_KEY);
}

/** Look up a record by normalised key + entity type. Returns undefined if
 *  there is no match. Lookup is intentionally type-scoped so the same text
 *  detected as different types (e.g. ambiguous "Berlin" — LOCATION vs
 *  ORGANIZATION) yields independent records. */
export function findRecord(
  data: IdentityVaultData,
  text: string,
  entityType: EntityType,
): IdentityRecord | undefined {
  const key = normalizeKey(text);
  return data.records.find(
    (r) => r.entityType === entityType && r.normalizedKey === key,
  );
}

/** All records, sorted most-recently-seen first. Cheap to compute and
 *  convenient for UI rendering. */
export function recordsByRecency(data: IdentityVaultData): IdentityRecord[] {
  return [...data.records].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

/**
 * Decide which value the anonymiser should emit for a given record under
 * a given default mode. Synthetic falls back to placeholder when the
 * record's syntheticValue is empty (i.e. type opted out of synthetic).
 */
export function activeReplacement(
  record: IdentityRecord,
  defaultMode: ReplacementMode,
): string {
  const mode = record.replacementMode ?? defaultMode;
  if (mode === 'synthetic' && record.syntheticValue) {
    return record.syntheticValue;
  }
  return record.placeholder;
}

/** Internal helper — pick the placeholder index and pre-generate the
 *  synthetic value based on the per-type counter. Bumps the counter. */
function provisionPlaceholderAndSynthetic(
  data: IdentityVaultData,
  entityType: EntityType,
): { placeholderText: string; syntheticValue: string } {
  const current = data.counters[entityType] ?? 0;
  const idx = current + 1;
  data.counters[entityType] = idx;

  const placeholderText = placeholder(entityType, idx);
  const synthetic = supportsSynthetic(entityType)
    ? generateSyntheticValue(entityType, current /* zero-based pool index */)
    : null;
  return { placeholderText, syntheticValue: synthetic ?? '' };
}

/**
 * Result of upsertEntity: tells the caller whether a new record was
 * created so the UI can show feedback ("Added 'John Doe' to the vault").
 */
export interface UpsertResult {
  record: IdentityRecord;
  created: boolean;
}

/**
 * Look up or create a record for a detected span. The vault counter is
 * advanced only on creation, so re-pasting the same name many times never
 * inflates the placeholder index.
 *
 * Caller is responsible for persisting the updated `data` afterwards via
 * `saveIdentityVault`. Batching multiple upserts before a single save is
 * recommended to minimise storage round-trips.
 *
 * @param data — vault state, mutated in place.
 * @param span — detected PII span (text + entity type are the primary
 *   inputs; score and offsets are recorded only for telemetry).
 * @param now — current timestamp; injected for deterministic tests.
 */
export function upsertEntity(
  data: IdentityVaultData,
  span: PiiSpan,
  now: number = Date.now(),
  defaultMode: ReplacementMode = 'placeholder',
): UpsertResult {
  const existing = findRecord(data, span.text, span.entity_type);
  if (existing) {
    existing.lastSeenAt = now;
    existing.usageCount += 1;
    // Update updatedAt only when a non-trivial mutation happens; bumping
    // it on every paste would make "recently edited" sorting useless.
    return { record: existing, created: false };
  }

  const { placeholderText, syntheticValue } = provisionPlaceholderAndSynthetic(
    data,
    span.entity_type,
  );

  // Honor the global default unless this type has no synthetic to offer,
  // in which case fall back to placeholder so the record isn't stranded
  // in a mode it can never satisfy.
  const initialMode: ReplacementMode =
    defaultMode === 'synthetic' && syntheticValue ? 'synthetic' : 'placeholder';

  const record: IdentityRecord = {
    id: makeId(),
    originalText: span.text,
    normalizedKey: normalizeKey(span.text),
    entityType: span.entity_type,
    placeholder: placeholderText,
    syntheticValue,
    replacementMode: initialMode,
    pinned: false,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    usageCount: 1,
  };
  data.records.push(record);
  return { record, created: true };
}

/** Update fields on a record by id. Returns the updated record, or
 *  undefined if no matching id exists. */
export function updateRecord(
  data: IdentityVaultData,
  id: string,
  patch: Partial<
    Pick<
      IdentityRecord,
      'replacementMode' | 'syntheticValue' | 'pinned' | 'notes' | 'entityType'
    >
  >,
  now: number = Date.now(),
): IdentityRecord | undefined {
  const record = data.records.find((r) => r.id === id);
  if (!record) return undefined;

  if (patch.replacementMode !== undefined) {
    // Don't allow synthetic mode for records that have no synthetic
    // value (e.g. PASSWORD); silently coerce to placeholder.
    record.replacementMode =
      patch.replacementMode === 'synthetic' && !record.syntheticValue
        ? 'placeholder'
        : patch.replacementMode;
  }
  if (patch.syntheticValue !== undefined) {
    record.syntheticValue = patch.syntheticValue;
  }
  if (patch.pinned !== undefined) {
    record.pinned = patch.pinned;
  }
  if (patch.notes !== undefined) {
    record.notes = patch.notes;
  }
  if (patch.entityType !== undefined) {
    record.entityType = patch.entityType;
  }
  record.updatedAt = now;
  return record;
}

/** Delete a record by id. Returns true if removed, false if no such id. */
export function deleteRecord(data: IdentityVaultData, id: string): boolean {
  const idx = data.records.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  data.records.splice(idx, 1);
  return true;
}

/**
 * Build a quick-lookup index from active replacement value (placeholder
 * OR synthetic) back to the record. Used by the de-anonymiser to reverse
 * either form.
 *
 * Note: synthetic values can collide with strings naturally appearing in
 * model output ("Riley Bennett" might also be the name of a real person
 * the user is asking about). Caller must use word-boundary matching to
 * minimise false positives — see `de-anonymizer.ts` for the wrapping.
 */
export function buildReverseIndex(
  data: IdentityVaultData,
): Map<string, IdentityRecord> {
  const map = new Map<string, IdentityRecord>();
  for (const record of data.records) {
    map.set(record.placeholder, record);
    if (record.syntheticValue) {
      // Last-write-wins on synthetic collisions across records: rare,
      // but possible if two PERSON records were assigned the same name.
      // The vault counter is supposed to prevent this; we log it for
      // defensive tracing.
      if (map.has(record.syntheticValue)) {
        // eslint-disable-next-line no-console
        console.warn(
          '[PG:vault] synthetic value collision',
          record.syntheticValue,
        );
      }
      map.set(record.syntheticValue, record);
    }
  }
  return map;
}
