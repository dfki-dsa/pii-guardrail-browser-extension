/**
 * Privacy Guardrail — Entity-Map Augmentation (shared)
 *
 * Pure helper that takes a stored conversation entity map plus the
 * identity vault and returns the augmented `EntityMap` used for
 * resolution by the de-anon banner and clipboard interceptor.
 *
 * Policy (mirrors the inline block previously living in the response
 * observer's path):
 *
 *   - Records that are not present in the conversation map at all are
 *     ignored. The conversation scope is the source of truth for "what
 *     the user pasted in this conversation"; vault entries the user has
 *     never used here must not surface.
 *   - For records that ARE present (either by placeholder or synthetic
 *     value), make sure both forms are reverse-mappable. The LLM may
 *     return either form, regardless of the record's active mode.
 *
 * No DOM, no storage, no `chrome.*` access.
 */

import { EntityMap } from './entity-map';
import type { StoredEntityMap } from './storage';
import type { IdentityVaultData } from './identity-vault';

/**
 * Build the resolution-ready EntityMap for a conversation. When the vault
 * is disabled or empty the function passes the conversation map through
 * unchanged.
 *
 * @param storedMap   Plain-object form of the conversation entity map, as
 *                    returned by `loadEntityMap` (may be undefined for a
 *                    fresh conversation).
 * @param vaultData   Current identity vault snapshot.
 * @param vaultEnabled  Honors the `identityVaultEnabled` setting; when
 *                    false, vault augmentation is skipped entirely.
 */
export function augmentEntityMap(
  storedMap: StoredEntityMap | undefined,
  vaultData: IdentityVaultData,
  vaultEnabled: boolean,
): EntityMap {
  if (!vaultEnabled || vaultData.records.length === 0) {
    return new EntityMap(storedMap);
  }

  // Build the augmented stored map by direct merge. We avoid mutating
  // an existing EntityMap via `addExternal` because that helper destroys
  // the previous reverse mapping for the same original — which would
  // erase the placeholder→original entry as soon as we tried to also
  // register synthetic→original for the same record. Resolution only
  // reads the forward (placeholder/synthetic → original) direction, so
  // multiple keys mapping to one original is fine here.
  const augmented: StoredEntityMap = { ...(storedMap ?? {}) };

  for (const record of vaultData.records) {
    const placeholderPresent = augmented[record.placeholder] !== undefined;
    const syntheticPresent =
      record.syntheticValue.length > 0 &&
      augmented[record.syntheticValue] !== undefined;

    // Skip records the user has never touched in this conversation.
    if (!placeholderPresent && !syntheticPresent) continue;

    if (record.syntheticValue && !syntheticPresent) {
      augmented[record.syntheticValue] = record.originalText;
    }
    if (!placeholderPresent) {
      augmented[record.placeholder] = record.originalText;
    }
  }

  return new EntityMap(augmented);
}
