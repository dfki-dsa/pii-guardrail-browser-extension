/**
 * Privacy Guardrail — Review Overlay (Svelte 5 + Shadow DOM)
 *
 * Thin imperative wrapper around the Svelte ReviewOverlay component.
 * Owns the host element, the closed shadow root, the global keyboard
 * shortcuts (Esc / Enter), and the lifecycle of the mounted Svelte
 * component. The Svelte component reads from an OverlayModel instance
 * which holds reactive state and forwards user actions to the
 * OverlayCallbacks supplied by the content script.
 */

import { mount, unmount } from 'svelte';
import { ENTITY_TYPES, type PiiSpan } from '../../shared/message-types';
import overlayCss from './overlay-styles.css';
import ReviewOverlayComponent from './ReviewOverlay.svelte';
import {
  OverlayModel,
  type OverlayCallbacks,
  type PreviewResolver,
  type PreviewResolverFactory,
} from './overlay-model';

export const OVERLAY_ENTITY_TYPES = ENTITY_TYPES;
export type { OverlayCallbacks, PreviewResolver, PreviewResolverFactory };

/**
 * Shadow DOM overlay for reviewing and correcting PII detections.
 *
 * The constructor signature is preserved from the previous vanilla-TS
 * implementation so the call site in content-script.ts requires no
 * change. The `theme` parameter is kept for backwards compatibility but
 * is currently ignored — the popup and options page render in a single
 * light style and the overlay matches that unconditionally.
 */
export class ReviewOverlay {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private model: OverlayModel;
  private callbacks: OverlayCallbacks;
  // The Svelte 5 mount() return value is opaque; we type it as unknown
  // and pass it back to unmount() during destroy().
  private app: ReturnType<typeof mount> | null = null;
  private keyboardHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(
    originalText: string,
    spans: PiiSpan[],
    callbacks: OverlayCallbacks,
    confidenceThreshold: number | ((span: PiiSpan) => number),
    timings?: { totalMs: number },
    _theme: 'dark' | 'light' = 'dark',
    previewResolverFactory?: PreviewResolverFactory,
  ) {
    void _theme; // intentionally unused — single-style overlay.

    // Wrap the supplied callbacks so navigation actions (confirm /
    // pasteOriginal / cancel) automatically tear down the overlay,
    // matching the previous behaviour where each handler called
    // destroy() itself.
    this.callbacks = {
      ...callbacks,
      onConfirm: (approved) => {
        this.destroy();
        callbacks.onConfirm(approved);
      },
      onPasteOriginal: () => {
        this.destroy();
        callbacks.onPasteOriginal();
      },
      onCancel: () => {
        this.destroy();
        callbacks.onCancel();
      },
    };

    this.model = new OverlayModel(
      originalText,
      spans,
      this.callbacks,
      confidenceThreshold,
      timings,
      previewResolverFactory,
    );

    this.host = document.createElement('div');
    this.host.id = 'pg-review-overlay-host';
    this.shadow = this.host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = overlayCss as unknown as string;
    this.shadow.appendChild(style);

    this.app = mount(ReviewOverlayComponent, {
      target: this.shadow as unknown as Element,
      props: { model: this.model, shadowRoot: this.shadow },
    });

    this.attachKeyboardShortcuts();
  }

  /** Show the overlay in the DOM. */
  show(): void {
    document.body.appendChild(this.host);
  }

  /** Remove the overlay from the DOM. Idempotent. */
  destroy(): void {
    if (this.keyboardHandler) {
      document.removeEventListener('keydown', this.keyboardHandler);
      this.keyboardHandler = null;
    }
    if (this.app) {
      try {
        unmount(this.app);
      } catch {
        // Already unmounted — ignore.
      }
      this.app = null;
    }
    if (this.host.isConnected) {
      this.host.remove();
    }
  }

  private attachKeyboardShortcuts(): void {
    this.keyboardHandler = (e: KeyboardEvent) => {
      if (this.model.isDestroyed()) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.model.confirm();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this.model.cancel();
      }
    };
    document.addEventListener('keydown', this.keyboardHandler);
  }
}
