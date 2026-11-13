# Auto-mode is an opt-in paste mode with an after-the-fact Undo and Review

## Context

Until now every paste with detected items stopped at the review pop-up. That pop-up is where
every human decision about a paste happens — untick a false positive, mark something the
detector missed, change a type, allowlist a value — and those corrections are the only input the
adaptive thresholds get.

Issue #62 asked for the opposite for users who paste often: no pop-up, just replace. The
maintainer added that two ways back should stay reachable: cancel the replacement, and get the
pop-up on a click.

Three facts shaped the answer:

- **Paste is the only interception point.** Nothing gates typing or sending, so "automatic" can
  only mean "automatic at paste time".
- **The pop-up owned logic that was not about the pop-up.** Which spans start ticked was decided
  inside its model, and the bookkeeping that the reveal banner, copy restore and conversation
  filing depend on lived in its confirm handler. A second path could reach neither.
- **Once text is in a site's editor it is no longer ours.** ChatGPT and Claude run ProseMirror,
  Gemini runs Quill. Changing text after insertion means addressing content those editors have
  split into blocks and may redraw from their own state. ADR 0001 set the rule for depending on
  vendor behaviour: when an assumption rots, it may cost precision, never protection.

The written product stance — README, privacy policy, user guide, store listing — was that the
user reviews before anything is inserted.

## Decision

1. A setting `pasteReviewMode: 'review' | 'auto'`, default `'review'`. Any stored value other
   than `'auto'` behaves as `'review'`, including a settings object that arrives unnormalised
   through a storage event. The setting is offered where a user discovers they want it — a
   "Auto-mode" switch in the review pop-up, applied the moment it is flipped — and where
   they would look for it later, as an "Auto-mode" toggle on the popup's first tab. It is one
   setting with two controls, not two settings, and both explain themselves through the same
   info tag. The review pop-up looks the same whether it holds a paste or looks back at one
   already replaced; only what its buttons do differs.
2. In `'auto'`, the extension replaces **exactly what the pop-up would have pre-ticked**: not in
   a skipped code block, and at or above the span's threshold. The rule lives in
   `shared/review-defaults.ts` and the pop-up's model reads it from there too. Anonymising and
   recording a replacement are named functions called by both paths.
3. After replacing, a short-lived notice offers **Undo** (put the original back) and **Review**
   (open the pop-up for that paste; what the user confirms replaces the inserted text). Ignoring
   the notice keeps the replacement. Closing a pop-up opened this way keeps it as well.
4. Undo and Review share one primitive. It finds the inserted text in the message box by a
   match that ignores whitespace, replaces it through the same insertion path a paste uses, and
   then reads the message box back to confirm the result. When the same text is in the box more
   than once — pasted twice — it uses the copy recorded at insertion, and only while the number
   of copies is unchanged; otherwise it cannot tell which is meant and touches nothing. The
   read-back counts copies before and after rather than asking whether the old text is gone, so
   a swap of one copy is neither missed nor mistaken. If the read-back disagrees, the swap is
   reported as failed. Either way the user is told.
6. Auto-mode leaves alone what the pop-up would have listed unticked — an item below its
   threshold, text in a skipped code block — but not out of sight: the notice says how many
   detected items were not replaced, and when none qualified it says "Nothing replaced" and
   offers Review instead of a tick of approval.
5. Undo does not roll back identity-vault or ledger entries. They stay, exactly as when a user
   deletes pasted text by hand; a token is only filed against a conversation once it is seen in
   the transcript.

The scanning indicator and its Cancel, the cancel-behaviour setting, what happens on a detection
error, and paste-only coverage are unchanged.

## Considered options

**Replace directly with a plain notice and no way back.** Cannot break when an editor changes,
and is the smallest change. Rejected as the whole answer: a wrong replacement could then only be
fixed by editing by hand or switching the mode off. It survives as the fallback of the chosen
design — it is what the user has whenever a swap cannot be done safely.

**Ask on each paste** with a small chip (Cancel / Pop-up / Replace) and insert nothing until a
click or a countdown. Never rewrites inserted text, so it has no dependency on the editors.
Rejected: every paste waits, which is the friction the issue is about.

**A three-way setting** (don't replace / pop-up / replace directly) with no notice. Rejected: the
choice is global, so correcting one paste means changing a setting and pasting again, and "don't
replace" duplicates the master toggle.

**Undo through the editor's own history** (a synthetic Ctrl+Z or `historyUndo`). Rejected: it is
per-vendor behaviour, it cannot implement Review, and after the user has typed it undoes the
wrong thing.

**Revert token by token** instead of swapping the whole inserted text. Tokens never span
paragraphs, so they are easy to find. Rejected: the same token from an earlier paste in the same
draft would be reverted too, exposing text the user had already protected. It also cannot add
items the user marks during Review.

**Build the pop-up's model without showing it and call its confirm.** Guarantees the same
selection with no refactor. Rejected: it makes UI state load-bearing for a path that has no UI.

**Replace automatically only above a high-confidence bar, pop-up otherwise.** Deferred, not
rejected. It fits as a third value of the same setting if silent false positives turn out to be
the complaint.

## Consequences

- The common case is zero clicks, and each paste remains individually reversible for a few
  seconds.
- The failure mode of Undo and Review is "the replaced text stays". The one direction that could
  expose something — an editor showing a newly replaced item while its own state still holds the
  original — is what the read-back exists to catch.
- Swapping text inside third-party editors is a new dependency on behaviour we do not control,
  and it cannot be unit-tested: jsdom has no `execCommand` and no ProseMirror. The browser
  harness proves it in real Chromium on a plain editable region and a textarea; the sites' own
  editors need the manual check in the smoke-test checklist at each release. A site where the
  swap stops working degrades to a notice whose buttons report failure.
- Users who never open Review give no corrections, so adaptive thresholds stop learning for
  them. Review from the notice keeps the loop available.
- A detection error still inserts the original with a brief warning, as before. Someone relying
  on automatic replacement is less likely to be watching for it.
- The privacy policy, user guide, README and store listing no longer say review always precedes
  insertion.
- `ClipboardToast` and the new notice share plumbing but stay separate classes for now. Worth
  folding together once both have settled.
