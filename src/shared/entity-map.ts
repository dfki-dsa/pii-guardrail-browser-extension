import type { EntityType, PiiSpan } from './message-types';
import { placeholder } from './constants';
import type { StoredEntityMap } from './storage';

/**
 * Bidirectional mapping between original PII values and their placeholders.
 * Manages placeholder numbering per entity type and supports serialization
 * for persistence in chrome.storage.local.
 */
export class EntityMap {
  /** placeholder → original value */
  private toOriginal: Map<string, string> = new Map();
  /** original value → placeholder */
  private toPlaceholder: Map<string, string> = new Map();
  /** Next index per entity type for placeholder numbering */
  private counters: Map<string, number> = new Map();

  /** Create an EntityMap, optionally restoring from a stored map. */
  constructor(stored?: StoredEntityMap) {
    if (stored) {
      for (const [ph, original] of Object.entries(stored)) {
        this.toOriginal.set(ph, original);
        this.toPlaceholder.set(original, ph);
        // Reconstruct counters from existing placeholders
        const match = ph.match(/\[([A-Z_]+)_(\d+)\]/);
        if (match) {
          const type = match[1];
          const idx = parseInt(match[2], 10);
          const current = this.counters.get(type) || 0;
          if (idx >= current) {
            this.counters.set(type, idx + 1);
          }
        }
      }
    }
  }

  /**
   * Add a PII span to the map. Returns the assigned placeholder.
   * If the same original text was already mapped, returns the existing placeholder.
   */
  add(span: PiiSpan): string {
    const existing = this.toPlaceholder.get(span.text);
    if (existing) {
      return existing;
    }

    const type = span.entity_type;
    const idx = this.counters.get(type) || 1;
    this.counters.set(type, idx + 1);

    const ph = placeholder(type, idx);
    this.toOriginal.set(ph, span.text);
    this.toPlaceholder.set(span.text, ph);
    return ph;
  }

  /** Get the original value for a placeholder. */
  getOriginal(ph: string): string | undefined {
    return this.toOriginal.get(ph);
  }

  /** Get the placeholder for an original value. */
  getPlaceholder(original: string): string | undefined {
    return this.toPlaceholder.get(original);
  }

  /**
   * Add an externally-chosen replacement string for an original value
   * without consulting the per-type counter. This is the path used when
   * the vault has already decided the replacement (placeholder OR
   * synthetic), so the per-conversation EntityMap should mirror the vault
   * choice instead of generating its own placeholder.
   *
   * If `original` already has a mapping, it is replaced with the new one.
   * The previous reverse entry is removed to keep both directions
   * consistent.
   */
  addExternal(replacement: string, original: string): void {
    const previous = this.toPlaceholder.get(original);
    if (previous && previous !== replacement) {
      this.toOriginal.delete(previous);
    }
    this.toOriginal.set(replacement, original);
    this.toPlaceholder.set(original, replacement);
  }

  /** Get all placeholder → original mappings. */
  entries(): Array<[string, string]> {
    return Array.from(this.toOriginal.entries());
  }

  /** Number of mapped entities. */
  get size(): number {
    return this.toOriginal.size;
  }

  /** Serialize to a plain object for storage. */
  toStored(): StoredEntityMap {
    const obj: StoredEntityMap = {};
    for (const [ph, original] of this.toOriginal) {
      obj[ph] = original;
    }
    return obj;
  }
}
