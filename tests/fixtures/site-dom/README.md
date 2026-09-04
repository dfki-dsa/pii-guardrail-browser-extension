# Captured site DOM

One fixture per supported chat site, holding the markup the site adapters
depend on: the composer, and one assistant turn.

They exist so selector rot is caught by a failing test rather than by a user.
Nothing else in this extension notices when a vendor changes its markup —
every fallback added by `docs/adr/0001-conversation-scope-from-evidence.md`
succeeds quietly, on purpose.

## Provenance

**These files are reconstructed from the adapter contracts and the markup
already documented in `src/content/site-adapters/`, not captured from a live
page.** They pin the contract the adapters were written against, which makes
an accidental selector change fail immediately, but they cannot notice a
vendor change on their own until they are refreshed.

## Refreshing at each release

For every host in `DEFAULT_CURATED_URLS`, on a signed-in page with at least
one assistant reply:

1. Open DevTools and select the composer. Copy its outer HTML plus the form or
   wrapper the adapter's selectors reach through.
2. Select one assistant turn. Copy its outer HTML, trimming the reply's own
   text to a short synthetic line.
3. Replace the corresponding block in the fixture, keeping the
   `<!-- composer -->` and `<!-- assistant turn -->` markers.
4. Remove anything that is not structural: reply text, ids that carry
   conversation identifiers, user names, avatars, and every URL that is not a
   relative asset path. Fixtures are public and must contain no real content.
5. Run `npm test`. A fixture that no longer matches is the signal — decide
   whether the adapter needs updating or the fixture does.

Record the capture date and the client build below when refreshing.

| Fixture | Site | Last captured | Build |
|---|---|---|---|
| `chatgpt-web-mobile.html` | chatgpt.com | not yet captured | web-mobile (`#web-mobile-root`) |
| `chatgpt-classic.html` | chatgpt.com | not yet captured | React / ProseMirror |
| `claude.html` | claude.ai | not yet captured | — |
| `gemini.html` | gemini.google.com | not yet captured | — |
