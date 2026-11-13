/** @jest-environment jsdom */

import {
  AutoModeController,
  PRESENCE_MISSES,
  PRESENCE_POLL_MS,
  type AutoModeDeps,
  type ReviewOutcomeCallbacks,
} from '../../src/content/auto-mode';
import type { PiiSpan } from '../../src/shared/message-types';

const ORIGINAL = 'Ada wrote to bob@example.com from Kiel';
const REPLACED = '[PERSON_1] wrote to [EMAIL_1] from Kiel';

const person: PiiSpan = { start: 0, end: 3, entity_type: 'PERSON', score: 0.99, text: 'Ada', source: 'ner' };
const email: PiiSpan = { start: 13, end: 28, entity_type: 'EMAIL', score: 0.95, text: 'bob@example.com', source: 'regex' };
/** Detected, but below the 0.5 threshold: listed in the pop-up, not pre-selected. */
const unsure: PiiSpan = { start: 34, end: 38, entity_type: 'LOCATION', score: 0.3, text: 'Kiel', source: 'ner' };
/** Detected inside a code block the user asked to skip. */
const inCode: PiiSpan = { ...person, inCodeBlock: true };

describe('auto-mode', () => {
  const originalAttachShadow = HTMLElement.prototype.attachShadow;

  /** The message box as auto-mode sees it, with its contents under test control. */
  let box: { text: string; exists: boolean };
  let deps: jest.Mocked<Omit<AutoModeDeps, 'composer' | 'theme'>> & {
    composer: jest.Mocked<AutoModeDeps['composer']>;
    theme: AutoModeDeps['theme'];
  };
  let controller: AutoModeController;
  /** What the pop-up was opened with, the last time it was opened. */
  let review: { outcome: ReviewOutcomeCallbacks; spans: PiiSpan[]; context: string } | null;

  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '';
    jest
      .spyOn(HTMLElement.prototype, 'attachShadow')
      .mockImplementation(function attachOpenShadow(this: HTMLElement, init: ShadowRootInit): ShadowRoot {
        return originalAttachShadow.call(this, { ...init, mode: 'open' });
      });

    box = { text: '', exists: true };
    review = null;
    deps = {
      composer: {
        insert: jest.fn((text: string) => {
          if (box.exists) box.text = text;
          return box.exists;
        }),
        replaceInserted: jest.fn(async (oldText: string, newText: string) => {
          if (!box.text.includes(oldText)) return false;
          box.text = box.text.replace(oldText, newText);
          return true;
        }),
        composerContainsAny: jest.fn((texts: readonly string[]) => texts.some((t) => box.text.includes(t))),
        composerElement: jest.fn(() => null),
      },
      theme: () => 'dark',
      thresholdFor: jest.fn((_span: PiiSpan) => 0.5),
      anonymize: jest.fn((_text: string, approved: PiiSpan[]) => {
        let out = ORIGINAL;
        for (const span of approved) out = out.replace(span.text, `[${span.entity_type}_1]`);
        return out;
      }),
      tokensIn: jest.fn((text: string) => ['[PERSON_1]', '[EMAIL_1]', '[LOCATION_1]'].filter((t) => text.includes(t))),
      record: jest.fn(),
      openReview: jest.fn((_text, spans, _timings, outcome, context) => {
        review = { outcome, spans, context };
      }),
      indicate: jest.fn(),
      debug: jest.fn(),
    };
    controller = new AutoModeController(deps);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const toastHost = (): HTMLElement | null => document.getElementById('pg-auto-mode-toast-host');
  const toastText = (): string => toastHost()?.shadowRoot?.textContent ?? '';
  const toastButton = (id: string): HTMLButtonElement =>
    toastHost()?.shadowRoot?.querySelector(`#${id}`) as HTMLButtonElement;
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };

  describe('replacing a paste', () => {
    it('replaces what the pop-up would have pre-selected and records it', () => {
      controller.replace(ORIGINAL, [person, email]);

      expect(deps.anonymize).toHaveBeenCalledWith(ORIGINAL, [person, email]);
      expect(box.text).toBe(REPLACED);
      expect(deps.record).toHaveBeenCalledWith(REPLACED);
      expect(deps.openReview).not.toHaveBeenCalled();
      expect(toastText()).toContain('2 items replaced');
      expect(toastText()).toContain('Auto-mode is on');
    });

    it('judges each item against the threshold the pop-up would use', () => {
      deps.thresholdFor.mockImplementation((span) => (span.entity_type === 'EMAIL' ? 0.99 : 0.5));

      controller.replace(ORIGINAL, [person, email]);

      expect(deps.anonymize).toHaveBeenCalledWith(ORIGINAL, [person]);
    });

    it('says how many detected items it left unreplaced', () => {
      // In the pop-up the user would have seen "Kiel" listed, unticked. Left
      // alone the same way here, but not silently.
      controller.replace(ORIGINAL, [person, email, unsure]);

      expect(deps.anonymize).toHaveBeenCalledWith(ORIGINAL, [person, email]);
      expect(toastText()).toContain('2 items replaced');
      expect(toastText()).toContain('1 detected item not replaced');
    });

    it('pastes the original, without a tick of approval, when nothing qualifies', () => {
      controller.replace(ORIGINAL, [unsure, inCode]);

      expect(box.text).toBe(ORIGINAL);
      expect(deps.anonymize).not.toHaveBeenCalled();
      expect(deps.record).not.toHaveBeenCalled();
      expect(deps.indicate).not.toHaveBeenCalled();
      expect(toastText()).toContain('Nothing replaced');
      expect(toastText()).toContain('2 detected items not replaced');
      expect(toastButton('pg-auto-undo-btn').hidden).toBe(true);
      expect(toastButton('pg-auto-review-btn').hidden).toBe(false);
    });

    it('shows no notice when there was no message box for the text to land in', () => {
      box.exists = false;

      controller.replace(ORIGINAL, [person, email]);

      expect(toastHost()).toBeNull();
      // The tokens are still recorded, as they are when the pop-up confirms.
      expect(deps.record).toHaveBeenCalledWith(REPLACED);

      controller.replace(ORIGINAL, [unsure]);
      expect(toastHost()).toBeNull();
    });

    it('replaces the notice of an earlier paste with the new one', () => {
      controller.replace(ORIGINAL, [person, email]);
      controller.replace(ORIGINAL, [person]);

      expect(document.querySelectorAll('#pg-auto-mode-toast-host')).toHaveLength(1);
      expect(toastText()).toContain('1 item replaced');
    });
  });

  describe('Undo', () => {
    it('puts the original back and says so', async () => {
      controller.replace(ORIGINAL, [person, email]);

      toastButton('pg-auto-undo-btn').click();
      await flush();

      expect(deps.composer.replaceInserted).toHaveBeenCalledWith(REPLACED, ORIGINAL);
      expect(box.text).toBe(ORIGINAL);
      expect(toastText()).toContain('Original text restored');
    });

    it('says so when the original could not be put back', async () => {
      controller.replace(ORIGINAL, [person, email]);
      box.text = 'Something the user typed instead';

      toastButton('pg-auto-undo-btn').click();
      await flush();

      expect(box.text).toBe('Something the user typed instead');
      expect(toastText()).toContain("Couldn't restore the original");
    });

    it('is not mistaken for the message having been sent', async () => {
      // Undo takes the tokens out of the box itself. The notice must stay to
      // report the result rather than leave as if the message had gone.
      controller.replace(ORIGINAL, [person, email]);

      toastButton('pg-auto-undo-btn').click();
      await flush();
      jest.advanceTimersByTime(PRESENCE_POLL_MS * (PRESENCE_MISSES + 1));

      expect(toastHost()).not.toBeNull();
      expect(toastText()).toContain('Original text restored');
    });
  });

  describe('the notice follows the paste', () => {
    const wait = (polls: number): void => {
      jest.advanceTimersByTime(PRESENCE_POLL_MS * polls);
    };

    it('leaves once the message was sent', () => {
      controller.replace(ORIGINAL, [person, email]);

      box.text = '';
      wait(PRESENCE_MISSES - 1);
      expect(toastHost()).not.toBeNull();
      wait(1);

      expect(toastHost()).toBeNull();
    });

    it('stays while the user types around the replaced text', () => {
      controller.replace(ORIGINAL, [person, email]);

      box.text = `Context first. ${REPLACED} And a question?`;
      wait(PRESENCE_MISSES + 2);

      expect(toastHost()).not.toBeNull();
    });

    it('stays when the editor reshaped the text but kept the tokens', () => {
      // An editor turning the paste into a list or a link changes the text
      // around the tokens. That is not the paste going away.
      controller.replace(ORIGINAL, [person, email]);

      box.text = '• [PERSON_1] wrote to\n• [EMAIL_1] (from Kiel)';
      wait(PRESENCE_MISSES + 2);

      expect(toastHost()).not.toBeNull();
    });

    it('is not taken down by one check that caught the editor mid-redraw', () => {
      controller.replace(ORIGINAL, [person, email]);

      box.text = '';
      wait(1);
      box.text = REPLACED;
      wait(PRESENCE_MISSES + 1);

      expect(toastHost()).not.toBeNull();
    });

    it('is not watched at all when there was never anything to look for', () => {
      // The page reshaped the text beyond recognition at once. Taking the
      // notice down on a signal that was never there would hide Undo and
      // Review half a second after offering them.
      deps.composer.composerContainsAny.mockReturnValue(false);

      controller.replace(ORIGINAL, [person, email]);
      wait(PRESENCE_MISSES + 3);

      expect(toastHost()).not.toBeNull();
    });

    it('watches for the original text when nothing was replaced', () => {
      controller.replace(ORIGINAL, [unsure]);
      expect(toastHost()).not.toBeNull();

      box.text = '';
      wait(PRESENCE_MISSES);

      expect(toastHost()).toBeNull();
    });

    it('stops checking once the notice is gone', () => {
      controller.replace(ORIGINAL, [person, email]);
      controller.dismissNotice();
      deps.composer.composerContainsAny.mockClear();

      wait(5);

      expect(deps.composer.composerContainsAny).not.toHaveBeenCalled();
      expect(toastHost()).toBeNull();
    });
  });

  describe('Review', () => {
    const openReview = (spans: PiiSpan[] = [person, email, unsure]): ReviewOutcomeCallbacks => {
      controller.replace(ORIGINAL, spans);
      toastButton('pg-auto-review-btn').click();
      return review!.outcome;
    };

    it('opens the pop-up on everything that was detected, and takes the notice down', () => {
      openReview();

      expect(review!.spans).toEqual([person, email, unsure]);
      expect(review!.context).toBe('replaced');
      expect(toastHost()).toBeNull();
      // The replaced text stays in the box while the pop-up is open.
      expect(box.text).toBe(REPLACED);
    });

    it('swaps in what the user confirms, then records it', async () => {
      const outcome = openReview();

      outcome.onConfirm([person, email, unsure]);
      await flush();

      const expected = '[PERSON_1] wrote to [EMAIL_1] from [LOCATION_1]';
      expect(deps.composer.replaceInserted).toHaveBeenCalledWith(REPLACED, expected);
      expect(box.text).toBe(expected);
      expect(deps.record).toHaveBeenLastCalledWith(expected);
      expect(deps.indicate).toHaveBeenLastCalledWith(expect.stringContaining('3 items replaced'), expect.any(Number));
    });

    it('records nothing and says so when the swap could not be made', async () => {
      const outcome = openReview();
      box.text = 'Edited while the pop-up was open';
      deps.record.mockClear();

      outcome.onConfirm([person]);
      await flush();

      expect(box.text).toBe('Edited while the pop-up was open');
      expect(deps.record).not.toHaveBeenCalled();
      expect(deps.indicate).toHaveBeenLastCalledWith(
        expect.stringContaining("Couldn't apply your changes"),
        expect.any(Number),
      );
    });

    it('restores the original when nothing is left selected', async () => {
      const outcome = openReview();

      outcome.onConfirm([]);
      await flush();

      expect(box.text).toBe(ORIGINAL);
      expect(deps.indicate).toHaveBeenLastCalledWith(expect.stringContaining('Original text restored'), expect.any(Number));
    });

    it('restores the original through "Restore original"', async () => {
      const outcome = openReview();

      outcome.onPasteOriginal();
      await flush();

      expect(deps.composer.replaceInserted).toHaveBeenLastCalledWith(REPLACED, ORIGINAL);
      expect(box.text).toBe(ORIGINAL);
    });

    it('says so when the original could not be restored', async () => {
      const outcome = openReview();
      box.text = '';

      outcome.onPasteOriginal();
      await flush();

      expect(deps.indicate).toHaveBeenLastCalledWith(
        expect.stringContaining("Couldn't restore the original"),
        expect.any(Number),
      );
    });

    it('leaves the replacement alone when the pop-up is closed', async () => {
      const outcome = openReview();
      deps.composer.replaceInserted.mockClear();

      outcome.onCancel();
      await flush();

      expect(deps.composer.replaceInserted).not.toHaveBeenCalled();
      expect(box.text).toBe(REPLACED);
    });

    it('lets the user replace items after a paste where nothing qualified', async () => {
      // The original went in; ticking the uncertain item in the pop-up swaps
      // the original for a version with it replaced.
      const outcome = openReview([unsure]);
      expect(box.text).toBe(ORIGINAL);

      outcome.onConfirm([unsure]);
      await flush();

      expect(box.text).toBe('Ada wrote to bob@example.com from [LOCATION_1]');
    });
  });
});
