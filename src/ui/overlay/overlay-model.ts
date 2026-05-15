/**
 * Privacy Guardrail — Review Overlay state model
 *
 * Holds the reactive state for the Svelte review overlay using Svelte
 * stores (the established pattern in this codebase — see
 * src/popup/popup-model.svelte.ts). Wraps the OverlayCallbacks so
 * components only need to call model methods; the model emits feedback
 * entries identical to the previous vanilla-TS implementation.
 */

import { derived, get, writable, type Readable, type Writable } from 'svelte/store';
import type { EntityType, FeedbackEntry, PiiSpan } from '../../shared/message-types';
import {
  byteOffsetToStringIndex,
  stringIndexToByteOffset,
} from '../../shared/text-offsets';

export interface OverlayCallbacks {
  onConfirm: (approvedSpans: PiiSpan[]) => void;
  onPasteOriginal: () => void;
  onCancel: () => void;
  onFeedback: (entry: FeedbackEntry) => void;
  onAddToAllowlist: (text: string) => void;
  onEditDetails: (text: string) => void;
}

export interface SpanState {
  span: PiiSpan;
  enabled: boolean;
  entityType: EntityType;
  manualOverride: boolean;
  whitelisted: boolean;
}

export interface DismissMenuState {
  index: number;
  spanText: string;
  anchorRect: { top: number; right: number; bottom: number; left: number };
}

export type ThresholdResolver = (span: PiiSpan) => number;

/**
 * Returns the replacement string the real anonymiser would emit for a
 * given span. Resolvers may hold per-pass state (e.g. dedup new identities
 * by normalised text), so a fresh resolver is built for every preview
 * rebuild via `PreviewResolverFactory`.
 */
export type PreviewResolver = (span: PiiSpan) => string;
export type PreviewResolverFactory = () => PreviewResolver;

export class OverlayModel {
  readonly originalText: string;
  readonly timings?: { totalMs: number };
  private readonly thresholdFn: ThresholdResolver | null;
  private readonly callbacks: OverlayCallbacks;
  private destroyed = false;

  spanStates: Writable<SpanState[]>;
  manualSpans: Writable<PiiSpan[]>;
  confidenceThreshold: Writable<number>;
  selectedSnippet: Writable<string | null>;
  dismissMenu: Writable<DismissMenuState | null>;

  totalCount: Readable<number>;
  enabledCount: Readable<number>;
  highlightedHtml: Readable<string>;
  previewText: Readable<string>;
  mainIndices: Readable<number[]>;
  codeBlockIndices: Readable<number[]>;

  private readonly previewResolverFactory: PreviewResolverFactory | null;

  constructor(
    originalText: string,
    spans: PiiSpan[],
    callbacks: OverlayCallbacks,
    confidenceThreshold: number | ThresholdResolver,
    timings?: { totalMs: number },
    previewResolverFactory?: PreviewResolverFactory,
  ) {
    this.previewResolverFactory = previewResolverFactory ?? null;
    this.originalText = originalText;
    this.callbacks = callbacks;
    this.thresholdFn =
      typeof confidenceThreshold === 'function' ? confidenceThreshold : null;
    const initialThreshold = this.thresholdFn
      ? spans.length
        ? Math.min(...spans.map((s) => this.thresholdFn!(s)))
        : 0.5
      : (confidenceThreshold as number);

    this.spanStates = writable(
      spans.map((s) => ({
        span: s,
        enabled:
          !s.inCodeBlock &&
          s.score >= (this.thresholdFn ? this.thresholdFn(s) : initialThreshold),
        entityType: s.entity_type,
        manualOverride: false,
        whitelisted: false,
      })),
    );
    this.manualSpans = writable<PiiSpan[]>([]);
    this.confidenceThreshold = writable(initialThreshold);
    this.selectedSnippet = writable<string | null>(null);
    this.dismissMenu = writable<DismissMenuState | null>(null);
    this.timings = timings;

    this.totalCount = derived(
      [this.spanStates, this.manualSpans],
      ([states, manuals]) => states.length + manuals.length,
    );
    this.enabledCount = derived(
      [this.spanStates, this.manualSpans],
      ([states, manuals]) => states.filter((s) => s.enabled).length + manuals.length,
    );
    this.highlightedHtml = derived(
      [this.spanStates, this.manualSpans],
      ([states, manuals]) => buildHighlightedHtml(this.originalText, states, manuals),
    );
    this.previewText = derived(
      [this.spanStates, this.manualSpans],
      ([states, manuals]) => {
        const resolver = this.previewResolverFactory
          ? this.previewResolverFactory()
          : null;
        return buildPreview(this.originalText, states, manuals, resolver);
      },
    );
    this.mainIndices = derived(this.spanStates, (states) => {
      const out: number[] = [];
      for (let i = 0; i < states.length; i++) if (!states[i].span.inCodeBlock) out.push(i);
      return out;
    });
    this.codeBlockIndices = derived(this.spanStates, (states) => {
      const out: number[] = [];
      for (let i = 0; i < states.length; i++) if (states[i].span.inCodeBlock) out.push(i);
      return out;
    });
  }

  /**
   * Effective threshold for a span. The slider acts as a "min confidence"
   * floor — when the adaptive resolver is configured we take the higher of
   * the adaptive value and the slider, so dragging the slider up always
   * tightens the gate (but never loosens it below the adaptive baseline).
   */
  thresholdFor(span: PiiSpan): number {
    const slider = get(this.confidenceThreshold);
    if (!this.thresholdFn) return slider;
    return Math.max(this.thresholdFn(span), slider);
  }

  isBelowThreshold(state: SpanState): boolean {
    return state.span.score < this.thresholdFor(state.span);
  }

  toggle(index: number, enabled: boolean): void {
    this.spanStates.update((states) => {
      if (!states[index]) return states;
      const next = states.slice();
      next[index] = { ...next[index], enabled, manualOverride: true };
      return next;
    });
  }

  retype(index: number, newType: EntityType): void {
    this.spanStates.update((states) => {
      const state = states[index];
      if (!state || state.entityType === newType) return states;
      const next = states.slice();
      next[index] = { ...state, entityType: newType };
      this.callbacks.onFeedback({
        text: state.span.text,
        detectedType: state.entityType,
        correctedType: newType,
        context: this.extractContext(state.span.start, state.span.end),
        timestamp: Date.now(),
      });
      return next;
    });
  }

  openDismissMenu(index: number, anchorRect: DismissMenuState['anchorRect']): void {
    const state = get(this.spanStates)[index];
    if (!state) return;
    this.dismissMenu.set({ index, spanText: state.span.text, anchorRect });
  }

  closeDismissMenu(): void {
    this.dismissMenu.set(null);
  }

  /**
   * Persistence choice from the dismiss menu:
   *  - 'none'     → just this time, no allowlist write
   *  - 'value'    → also add the exact value to the allowlist
   *  - 'pattern'  → also open options page so the user can craft a pattern
   */
  confirmDismiss(persist: 'none' | 'value' | 'pattern'): void {
    const menu = get(this.dismissMenu);
    if (!menu) return;
    const index = menu.index;
    const willWhitelist = persist !== 'none';
    let snapshot: SpanState | undefined;
    this.spanStates.update((states) => {
      snapshot = states[index];
      if (!snapshot) return states;
      const next = states.slice();
      next[index] = {
        ...snapshot,
        enabled: false,
        manualOverride: true,
        whitelisted: willWhitelist,
      };
      return next;
    });
    this.dismissMenu.set(null);
    if (!snapshot) return;
    const cap = snapshot;
    this.callbacks.onFeedback({
      text: cap.span.text,
      detectedType: cap.span.entity_type,
      correctedType: 'NOT_PII',
      context: this.extractContext(cap.span.start, cap.span.end),
      timestamp: Date.now(),
    });
    if (persist === 'value') this.callbacks.onAddToAllowlist(cap.span.text);
    if (persist === 'pattern') this.callbacks.onEditDetails(cap.span.text);
  }

  removeManual(index: number): void {
    this.manualSpans.update((spans) => spans.filter((_, i) => i !== index));
  }

  addManual(text: string, entityType: EntityType): boolean {
    const startIdx = this.originalText.indexOf(text);
    if (startIdx === -1) return false;
    const start = stringIndexToByteOffset(this.originalText, startIdx);
    const span: PiiSpan = {
      start,
      end: start + stringIndexToByteOffset(text, text.length),
      entity_type: entityType,
      score: 1.0,
      text,
      source: 'manual',
    };
    this.manualSpans.update((spans) => [...spans, span]);
    this.callbacks.onFeedback({
      text,
      detectedType: null,
      correctedType: entityType,
      context: this.extractContext(span.start, span.end),
      timestamp: Date.now(),
    });
    this.selectedSnippet.set(null);
    return true;
  }

  setSelectedSnippet(text: string | null): void {
    this.selectedSnippet.set(text);
  }

  setThreshold(value: number): void {
    this.confidenceThreshold.set(value);
    this.spanStates.update((states) =>
      states.map((s) =>
        s.manualOverride
          ? s
          : {
              ...s,
              enabled:
                !s.span.inCodeBlock && s.span.score >= this.thresholdFor(s.span),
            },
      ),
    );
  }

  confirm(): PiiSpan[] {
    if (this.destroyed) return [];
    this.destroyed = true;
    const states = get(this.spanStates);
    const manuals = get(this.manualSpans);
    const approved = states
      .filter((s) => s.enabled)
      .map((s) => ({ ...s.span, entity_type: s.entityType }));
    const all = [...approved, ...manuals];
    this.callbacks.onConfirm(all);
    return all;
  }

  pasteOriginal(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.callbacks.onPasteOriginal();
  }

  cancel(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.callbacks.onCancel();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  private extractContext(start: number, end: number): string {
    const startIndex = byteOffsetToStringIndex(this.originalText, start);
    const endIndex = byteOffsetToStringIndex(this.originalText, end);
    const ctxStart = Math.max(0, startIndex - 20);
    const ctxEnd = Math.min(this.originalText.length, endIndex + 20);
    return this.originalText.slice(ctxStart, ctxEnd);
  }
}

export function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 2) + '..' : text;
}

function buildHighlightedHtml(
  originalText: string,
  states: SpanState[],
  manuals: PiiSpan[],
): string {
  type Marker =
    | { kind: 'detected'; index: number; state: SpanState }
    | { kind: 'manual'; span: PiiSpan };
  const markers: Marker[] = [];
  states.forEach((state, index) => {
    if (state.span.inCodeBlock) return;
    markers.push({ kind: 'detected', index, state });
  });
  manuals.forEach((span) => markers.push({ kind: 'manual', span }));
  markers.sort((a, b) => {
    const sa = a.kind === 'detected' ? a.state.span.start : a.span.start;
    const sb = b.kind === 'detected' ? b.state.span.start : b.span.start;
    return sa - sb;
  });

  let result = '';
  let cursor = 0;
  for (const marker of markers) {
    const span = marker.kind === 'detected' ? marker.state.span : marker.span;
    const type =
      marker.kind === 'detected' ? marker.state.entityType : span.entity_type;
    const start = byteOffsetToStringIndex(originalText, span.start);
    const end = byteOffsetToStringIndex(originalText, span.end);
    if (start < cursor) continue;
    result += escapeHtml(originalText.slice(cursor, start));
    const enabled = marker.kind === 'detected' ? marker.state.enabled : true;
    const classes = ['pg-highlight', `pg-highlight-${type.toLowerCase()}`];
    if (!enabled) classes.push('pg-highlight-off');
    const dataAttr =
      marker.kind === 'detected' ? ` data-pg-span-index="${marker.index}"` : '';
    result +=
      `<span class="${classes.join(' ')}"${dataAttr} ` +
      `title="${type} (${(span.score * 100).toFixed(0)}%)">` +
      `${escapeHtml(span.text)}</span>`;
    cursor = end;
  }
  result += escapeHtml(originalText.slice(cursor));
  return result;
}

function buildPreview(
  originalText: string,
  states: SpanState[],
  manuals: PiiSpan[],
  resolver: PreviewResolver | null,
): string {
  const enabled = states
    .filter((s) => s.enabled)
    .map((s) => ({ ...s.span, entity_type: s.entityType }));
  const all = [...enabled, ...manuals].sort((a, b) => a.start - b.start);
  const counters: Record<string, number> = {};
  let result = '';
  let cursor = 0;
  for (const span of all) {
    const start = byteOffsetToStringIndex(originalText, span.start);
    const end = byteOffsetToStringIndex(originalText, span.end);
    if (start < cursor) continue;
    result += escapeHtml(originalText.slice(cursor, start));
    counters[span.entity_type] = (counters[span.entity_type] || 0) + 1;
    const token = resolver
      ? resolver(span)
      : `[${span.entity_type}_${counters[span.entity_type]}]`;
    result +=
      `<span class="pg-highlight pg-highlight-${span.entity_type.toLowerCase()}" ` +
      `title="${span.entity_type} (${(span.score * 100).toFixed(0)}%)">` +
      `${escapeHtml(token)}</span>`;
    cursor = end;
  }
  result += escapeHtml(originalText.slice(cursor));
  return result;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
