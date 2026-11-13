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
import type { PiiSpan } from '../../shared/message-types';
import overlayCss from './overlay-styles.css';
import ReviewOverlayComponent from './ReviewOverlay.svelte';
import {
  OverlayModel,
  type OverlayCallbacks,
  type OverlayOptions,
  type PreviewResolver,
  type PreviewResolverFactory,
} from './overlay-model';

import { anchorShiftX } from '../shared/anchored-position';

export type { OverlayCallbacks, PreviewResolver, PreviewResolverFactory };

/** Controls that give Enter a meaning of their own when focused. */
const INTERACTIVE_CONTROLS =
  'button, a[href], input, select, textarea, [role="switch"], [role="button"], [contenteditable]';

/** Gap the dialog keeps to the window's edge when it moves toward the chat. */
const DIALOG_EDGE_GAP_PX = 24;

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
  private resizeHandler: (() => void) | null = null;
  private anchor: HTMLElement | null = null;

  constructor(
    originalText: string,
    spans: PiiSpan[],
    callbacks: OverlayCallbacks,
    confidenceThreshold: number | ((span: PiiSpan) => number),
    timings?: { totalMs: number },
    _theme: 'dark' | 'light' = 'dark',
    previewResolverFactory?: PreviewResolverFactory,
    options: OverlayOptions = {},
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
      options,
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

  /**
   * Show the overlay in the DOM.
   *
   * `anchor` is the message box the paste was aimed at. The backdrop still
   * covers the whole window, but the dialog moves toward the anchor so it
   * sits over the conversation rather than half over the site's sidebar.
   */
  show(anchor: HTMLElement | null = null): void {
    this.anchor = anchor;
    document.body.appendChild(this.host);
    this.alignWithAnchor();
    this.resizeHandler = () => this.alignWithAnchor();
    window.addEventListener('resize', this.resizeHandler);
  }

  /**
   * Shift the dialog sideways, toward the anchor.
   *
   * The amount is handed to the stylesheet as a custom property, which
   * applies it with `translate`. That composes with the entrance
   * animation's `transform` instead of fighting it, leaves the dialog's
   * layout — and so its measured width — untouched, and keeps how the
   * dialog is laid out a matter for the stylesheet alone.
   */
  private alignWithAnchor(): void {
    const dialog = this.shadow.querySelector<HTMLElement>('.pg-overlay');
    if (!dialog) return;
    const shift = anchorShiftX(dialog.offsetWidth, this.anchor, DIALOG_EDGE_GAP_PX);
    this.host.style.setProperty('--pg-anchor-shift', `${shift}px`);
  }

  /** Remove the overlay from the DOM. Idempotent. */
  destroy(): void {
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
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

  /**
   * Whether keyboard focus is on an interactive control inside the pop-up.
   *
   * Asked of the shadow root because the listener sits on the document, where
   * an event from inside a closed shadow tree is retargeted to the host and
   * says nothing about which control it came from.
   */
  private focusIsOnControl(): boolean {
    const focused = this.shadow.activeElement;
    return (
      !!focused &&
      typeof focused.matches === 'function' &&
      focused.matches(INTERACTIVE_CONTROLS)
    );
  }

  private attachKeyboardShortcuts(): void {
    this.keyboardHandler = (e: KeyboardEvent) => {
      if (this.model.isDestroyed()) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        // Enter confirms the pop-up — unless the user has moved focus onto one
        // of its controls. Then Enter belongs to that control: taking it here
        // would make Enter on "Restore original" do the opposite, and Enter
        // on the auto-mode switch paste instead of switching.
        if (this.focusIsOnControl()) return;
        e.preventDefault();
        this.model.primary();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this.model.cancel();
      }
    };
    document.addEventListener('keydown', this.keyboardHandler);
  }
}
