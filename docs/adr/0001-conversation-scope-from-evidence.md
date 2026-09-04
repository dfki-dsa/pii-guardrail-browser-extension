# Conversation scope is derived from evidence, not from URLs

## Context

Every supported chat site creates a conversation on the first send and rewrites the URL in
place. Replacement tokens recorded while composing are filed under the URL being left behind,
so something has to decide whether they move with the conversation.

That decision used to be made by matching each vendor's conversation route. It rotted twice in
two releases — most recently when ChatGPT's web-mobile build routed conversations at `/uc/<id>`
while the adapter tested for `/c/`. Every failure of this kind is silent: no error, no failing
test, no log. The extension simply stops resolving the user's replacements mid-conversation, and
a fix cannot reach users for the length of a Chrome Web Store review.

Two facts reframed the problem:

- **The identity vault already makes every token unambiguous.** Its counters are global and
  monotonic, so `[PERSON_7]` names one identity per profile, forever. Conversation records were
  not needed to tell identities apart.
- **The scope's real job is tolerance.** Placeholder matching is deliberately loose so a model
  that returns `person 7` instead of `[PERSON_7]` still resolves — which also means `location 1`
  in ordinary prose would resolve against an unbounded candidate set. Narrowing the candidates is
  what the scope is for, and it is the only thing it is for.

## Decision

Conversation scope is no longer decided at navigation time.

1. A replacement token is filed under a URL when it is **observed rendered in that page's
   transcript**, and is moved there from wherever this tab last filed it. Filing is continuous
   and idempotent; there is no classifier and no route knowledge anywhere in the extension.
2. An **unaltered, vault-known token resolves with no scope at all**. Only mangled tokens need
   the conversation record.
3. A conversation record holds **tokens only**. Originals live in the identity vault, so a record
   filed against the wrong conversation misdirects the scope but exposes nothing.

Site adapters are demoted throughout from gates to hints: they choose between candidates, but
never decide whether the extension acts. A rotted selector costs precision, not protection.

## Considered options

**Keep matching routes, add corroborating signals** (e.g. ChatGPT's `section[data-conversation-id]`).
Rejected: more vendor trivia, and every added signal is another thing that rots silently.

**Fail closed on ambiguity**, the behaviour being replaced: when continuity cannot be proven,
drop the mappings rather than risk resolving them in the wrong conversation. Rejected once the
vault made tokens globally unambiguous — the risk it was buying insurance against only exists for
synthetic replacements and for profiles with cross-session memory switched off, while the premium
was paid on every navigation by every user.

**Remote-updatable selectors**, fetched periodically so vendor breakage can be fixed without a
store release. Rejected: this extension's case rests on nothing leaving the machine. A periodic
fetch would report each install's existence, version and timing, and buy speed on an event the
rest of this design already makes rare and survivable.

**User-editable selectors** in advanced settings — the same-day fix without the network call.
Deferred, not rejected; worth revisiting if vendor breakage recurs.

## Consequences

- The worst outcome of a vendor change drops from *no reveal at all* to *mangled tokens do not
  resolve*. Complete breakage stops being reachable through URL handling.
- Conversation records stop carrying plaintext personal data. Where those values are retained is
  now a single question about the vault, answerable in one place in the privacy policy.
- Records written before this change keep their `token -> original` shape and keep resolving. No
  migration runs, and nothing is deleted.
- Adapter rot becomes invisible to us as well as harmless to users, since the fallbacks succeed
  quietly. A quiet degraded-mode line in the popup is the only field signal, and real-DOM
  snapshot fixtures per site are how a release is expected to catch rot before shipping.
- Filing writes more often than a single migration did, bounded by only running when the
  transcript's token set changes.
