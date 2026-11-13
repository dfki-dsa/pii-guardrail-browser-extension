/**
 * Privacy Guardrail — auto-mode
 *
 * What happens to a paste with detected items once the user has switched
 * auto-mode on: it is replaced straight away with what the review pop-up
 * would have pre-selected, and a short-lived notice offers the two ways back
 * to a decision the user never got to make — Undo and Review.
 *
 * This lives outside the content script, behind the handful of things it
 * needs from it, because the content script runs on import and cannot be
 * loaded in a test. Everything here can.
 */

import {
  AutoModeToast,
  FAILURE_VISIBLE_MS,
  replacedItemsLabel,
  type AutoModeOutcome,
} from '../ui/auto-mode-toast/auto-mode-toast';
import type { OverlayCallbacks, OverlayContext } from '../ui/overlay/overlay-model';
import {
  RESTORED_DETAIL,
  RESTORED_TITLE,
  RESTORE_FAILED_TITLE,
  SWAP_FAILED_DETAIL,
  UPDATE_FAILED_TITLE,
  oneLine,
} from '../shared/auto-mode-copy';
import { CHIP_FADE_MS, NO_PII_INDICATOR_MS } from '../shared/constants';
import type { PiiSpan, ThemeSetting } from '../shared/message-types';
import { selectDefaultApproved } from '../shared/review-defaults';

/** What the review pop-up decides about the paste itself. */
export type ReviewOutcomeCallbacks = Pick<
  OverlayCallbacks,
  'onConfirm' | 'onPasteOriginal' | 'onCancel'
>;

export type Timings = { totalMs: number } | undefined;

/** The page's message box, as far as auto-mode needs it. */
export interface AutoModeComposer {
  /** Put `text` in the message box; false when there was none to put it in. */
  insert(text: string): boolean;
  replaceInserted(oldText: string, newText: string): Promise<boolean>;
  composerContainsAny(texts: readonly string[]): boolean;
  composerElement(): HTMLElement | null;
}

export interface AutoModeDeps {
  composer: AutoModeComposer;
  theme: () => ThemeSetting;
  /** The threshold the review pop-up would hold `span` to. */
  thresholdFor: (span: PiiSpan) => number;
  /** Anonymise the approved spans; returns the text for the message box. */
  anonymize: (originalText: string, approved: PiiSpan[]) => string;
  /** The replacement tokens of this session that appear in `text`. */
  tokensIn: (text: string) => string[];
  /** Note that `anonymizedText` went into the page (ledger, scope, filing). */
  record: (anonymizedText: string) => void;
  openReview: (
    originalText: string,
    spans: PiiSpan[],
    timings: Timings,
    outcome: ReviewOutcomeCallbacks,
    context: OverlayContext,
  ) => void;
  /** Show a short, non-interactive status message. */
  indicate: (text: string, durationMs: number) => void;
  debug?: (message: string) => void;
}

/** A paste that went in without review, kept so it can be undone or reviewed. */
interface UnreviewedPaste {
  originalText: string;
  /** Every span the pop-up would have listed, not only the ones replaced. */
  spans: PiiSpan[];
  /** The text that went into the message box. */
  inserted: string;
  /** Replacement tokens in `inserted`; empty when nothing was replaced. */
  tokens: string[];
  timings: Timings;
}

/** How often the notice checks that its paste is still in the message box. */
export const PRESENCE_POLL_MS = 250;
/**
 * Consecutive checks that must miss before the notice leaves. One miss can be
 * an editor caught mid-redraw; two in a row is the paste being gone.
 */
export const PRESENCE_MISSES = 2;

export class AutoModeController {
  private notice: AutoModeToast | null = null;

  constructor(private readonly deps: AutoModeDeps) {}

  /**
   * Replace what the review pop-up would have pre-selected, without showing
   * it, then offer Undo and Review.
   *
   * `spans` is the list the pop-up would have shown. Some of it may not be
   * pre-selected — below its threshold, or inside a code block the user asked
   * to skip — and auto-mode leaves those alone exactly as the pop-up's
   * defaults would. What it must not do is leave them alone silently: in the
   * pop-up the user would have seen them listed, so the notice says how many
   * there were and Review is one click away. When nothing qualifies the
   * original goes in, with something detected in it — which is not the same
   * as "nothing found", and is not announced as if it were.
   */
  replace(originalText: string, spans: PiiSpan[], timings?: Timings): void {
    const approved = selectDefaultApproved(spans, this.deps.thresholdFor);
    const replaced = approved.length;
    const inserted = replaced > 0 ? this.deps.anonymize(originalText, approved) : originalText;

    const landed = this.deps.composer.insert(inserted);
    if (replaced > 0) {
      this.deps.record(inserted);
      if (timings) {
        this.deps.debug?.(`Detection: ${timings.totalMs}ms, auto-anonymized ${replaced} spans`);
      }
    }

    // No message box to land in: already reported through the composer lookup,
    // and there is nothing on the page to undo or review.
    if (!landed) return;

    this.showNotice(
      {
        originalText,
        spans,
        inserted,
        tokens: replaced > 0 ? this.deps.tokensIn(inserted) : [],
        timings,
      },
      { replaced, skipped: spans.length - replaced },
    );
  }

  /** Take the notice down — a new paste, a mode change, or leaving the page. */
  dismissNotice(): void {
    this.notice?.dispose();
    this.notice = null;
  }

  private showNotice(paste: UnreviewedPaste, outcome: AutoModeOutcome): void {
    this.dismissNotice();

    const stopWatching = this.watchPresence(paste, () => toast.dispose());

    const toast = new AutoModeToast(
      this.deps.theme(),
      outcome,
      {
        onUndo: () => {
          // Undo removes the replaced text itself; the notice stays to say how
          // that went rather than vanishing as if the message had been sent.
          stopWatching();
          return this.deps.composer.replaceInserted(paste.inserted, paste.originalText);
        },
        onReview: () => this.review(paste),
        onDispose: () => {
          stopWatching();
          if (this.notice === toast) this.notice = null;
        },
      },
      this.deps.composer.composerElement(),
    );
    this.notice = toast;
    toast.show();
  }

  /**
   * Take the notice down once the paste has left the message box.
   *
   * The notice offers to change text in the message box, so it only makes
   * sense while that text is there. No site announces "sent", but every one
   * of them empties the message box when it happens, so that is what is
   * watched for — by polling, since a textarea's value changes without any
   * mutation an observer would see.
   *
   * What is looked for are the replacement tokens, not the pasted text as a
   * whole. An editor may reshape what it is given — turn a "- " line into a
   * list, a URL into a link — and the whole text then never matches even
   * though the paste is plainly there; the tokens survive that. A paste that
   * left nothing to look for at the outset is not watched at all: the notice
   * then just runs out its time, which beats taking it down at once on a
   * signal that was never there.
   */
  private watchPresence(paste: UnreviewedPaste, onGone: () => void): () => void {
    const markers = paste.tokens.length > 0 ? paste.tokens : [paste.inserted];
    if (!this.deps.composer.composerContainsAny(markers)) return () => undefined;

    let misses = 0;
    let timer: number | null = window.setInterval(() => {
      if (this.deps.composer.composerContainsAny(markers)) {
        misses = 0;
        return;
      }
      misses += 1;
      if (misses >= PRESENCE_MISSES) onGone();
    }, PRESENCE_POLL_MS);

    return () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };
  }

  /**
   * Open the review pop-up for a paste that already went in.
   *
   * The text stays in the message box while the pop-up is open and is swapped
   * only for what the user confirms. If it cannot be swapped — edited or sent
   * in the meantime — nothing changes and the user is told; closing the
   * pop-up leaves the paste as it is.
   */
  private review(paste: UnreviewedPaste): void {
    const { originalText, inserted } = paste;
    const { composer, indicate } = this.deps;

    const restoreOriginal = async (): Promise<void> => {
      if (await composer.replaceInserted(inserted, originalText)) {
        indicate(oneLine(RESTORED_TITLE, RESTORED_DETAIL), NO_PII_INDICATOR_MS);
      } else {
        indicate(`⚠ ${oneLine(RESTORE_FAILED_TITLE, SWAP_FAILED_DETAIL)}`, FAILURE_VISIBLE_MS);
      }
    };

    this.deps.openReview(
      originalText,
      paste.spans,
      paste.timings,
      {
        onConfirm: (approvedSpans: PiiSpan[]) => {
          if (approvedSpans.length === 0) {
            void restoreOriginal();
            return;
          }

          const anonymizedText = this.deps.anonymize(originalText, approvedSpans);
          void composer.replaceInserted(inserted, anonymizedText).then((swapped) => {
            if (!swapped) {
              indicate(
                `⚠ ${oneLine(UPDATE_FAILED_TITLE, SWAP_FAILED_DETAIL)}`,
                FAILURE_VISIBLE_MS,
              );
              return;
            }
            this.deps.record(anonymizedText);
            indicate(`\u{1F512} ${replacedItemsLabel(approvedSpans.length)}`, CHIP_FADE_MS);
          });
        },

        onPasteOriginal: () => {
          void restoreOriginal();
        },

        onCancel: () => {
          // Nothing was held back for this pop-up, so there is nothing to
          // decide: what is in the message box stays as it is.
        },
      },
      'replaced',
    );
  }
}
