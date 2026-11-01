import {
  type IdentityVaultData,
  type ReplacementMode,
  findRecord,
  activeReplacement,
  normalizeKey,
} from '../shared/identity-vault';
import { placeholder as makePlaceholder } from '../shared/constants';
import {
  generateSyntheticValue,
  supportsSynthetic,
} from '../shared/synthetic-pool';
import type { PreviewResolverFactory } from '../ui/overlay/overlay-model';

/**
 * Build a preview-only resolver that mirrors what `anonymizeWithVault`
 * would emit, without mutating the live vault. Records already in the
 * vault use their stored replacementMode; new identities follow the
 * current global default. The factory returns a fresh resolver with per-
 * pass dedup state, so each call to `buildPreview` starts clean.
 */
export function makePreviewResolverFactory(
  vault: IdentityVaultData,
  defaultMode: ReplacementMode,
): PreviewResolverFactory {
  return () => {
    const seen = new Map<string, string>();
    const pendingByType = new Map<string, number>();
    return (span) => {
      const existing = findRecord(vault, span.text, span.entity_type);
      if (existing) return activeReplacement(existing, defaultMode);
      const key = `${span.entity_type}|${normalizeKey(span.text)}`;
      const cached = seen.get(key);
      if (cached) return cached;
      const baseCounter = vault.counters[span.entity_type] ?? 0;
      const offset = pendingByType.get(span.entity_type) ?? 0;
      pendingByType.set(span.entity_type, offset + 1);
      const idx = baseCounter + offset + 1;
      const ph = makePlaceholder(span.entity_type, idx);
      const tokenCount: 1 | 2 =
        span.text.trim().split(/\s+/).length === 1 ? 1 : 2;
      const synth = supportsSynthetic(span.entity_type)
        ? generateSyntheticValue(span.entity_type, baseCounter + offset, { tokenCount })
        : null;
      const rendered = defaultMode === 'synthetic' && synth ? synth : ph;
      seen.set(key, rendered);
      return rendered;
    };
  };
}
