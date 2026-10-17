# Glossary search context — Ryczywół

Owner: task 6. Issue: https://github.com/OleksandrKiris/citronex-ryczywol-szkolenie/issues/14
Base: `1ec6c4368fdea340e0b5e7b9b6516b4d0cf360b5`. PR12/PR13 already merged.
Status: see PR15 for the latest exact-head CI/browser result; no independent deployment.

## 17 October browser follow-up

The user-authorized GitHub Actions Chromium acceptance is now in
`.github/browser/glossary.mjs`, run by the existing PR workflow with pinned
Playwright 1.56.1. The first run 39004464291 passed the full original CI/164 tests
and desktop scenario, but reproduced a real narrow-screen search defect: queued
details toggle events collapsed the matching group after typing `reader`.
The search now leaves all matching groups expanded; normal exclusive accordion
behaviour is retained when the query is empty. A regression test covers both.
No instructional text, contact, media or question/answer data changed.

Acceptance runs exact head assets at an ephemeral localhost HTTP origin inside CI,
compares SHA256 to git head, exercises 1280x900 and 320x900, keyboard, nine languages,
ka fallback, reload/Back, no-match/clear, corrupt/denied storage/history, real base
to head service-worker update and legacy quiz progress. Offline tests disable the
browser network AND stop the HTTP server. Only text/UI resources are served;
photos/audio/PDF acceptance is outside this change. No external requests/actions
are allowed. JSON hashes/results, screenshots and traces are retained for 7 days
in the workflow artifact. Final result and exact head are recorded in PR15.
No file:// claim; first successful HTTP load and ready cache are required.
There is no package.json/npm test; use the existing workflow's Node test commands.
No runtime dependencies, extra precache entries or new browser data formats.

The original 16 October investigation below is historical, not the latest status.

## Confirmed problem and change

16 October 2026, permitted cloud Chrome, own tab: open public
`slownik.html?lang=ua`, enter `reader`, observe matching content, select English.
The field becomes empty and all 54 terms return. Source renderGlossary also had
no query restoration on reload. This is a reproduced context-loss defect.

Search now retains at most 160 characters in `q` in the current URL. Existing
filtering runs on restored input. Language changes carry the current field even
if History API or localStorage is denied. Clearing removes only `q`. replaceState
preserves history.state, other parameters and fragment, without a history entry
per keystroke. Field value is assigned through the DOM, never interpreted as HTML.
The empty-results notice has role=status; filtering never replaces the input.
All nine languages and the existing ka -> English fallback are preserved.

No new storage keys, migrations, libraries, media, polling or runtime requests.
Existing saved quiz progress is untouched. No training content, contacts, source
materials or sending actions change. Search text is part of the page URL and is
included if the user shares that URL; this is a glossary, not a personal-data form.

## Offline / update

The filter itself is local. First use requires online loading and a ready existing
service-worker cache. Network-free reload depends on that cache; this has not been
verified in an actual offline browser for this head. External links still require
network. No file:// service-worker support is claimed.

Changed runtime JS: 202075 -> 202981 bytes (+906; gzip +194). UI script / worker
cache version `20261017-glossary-context2`; all 14 HTML entries updated. No new
cache entries. location-custom and all media keep their exact prior URLs/versions.

## Verification

- All 75 retained local tracked files match fresh main blob hashes before editing.
  Remote base tree is preserved, including media absent from the local text snapshot.
- 164 Node tests passed. The 13 new glossary regression tests all fail against the
  original JS and pass against the changed JS. Network/actions are forbidden in
  the harness; this is not proof of a real browser offline run.
- Covers 9 languages, reload / return URL, language change, focus, clear, empty
  results, blocked history/storage, long/hostile URL input, legacy empty URLs, ka.
- JS syntax, diff whitespace, link/button audit and map audit passed. package.json
  is absent. audit-project attempted locally: absent binary media in this partial
  checkout prevent full local success; complete-repository CI must pass.
- Full diff inspected; no changes to location-custom, data, assets, procedures or
  established contact links.

## Browser acceptance still required

Only the existing public-page defect was reproduced in a real browser. The changed
version is NOT visually/offline verified. In the same environment the supported
managed preview attempt on 16 October failed before serving:
`bwrap: Can't mount proc on /newroot/proc: Operation not permitted`; status stopped.
No custom server, sandbox workaround, permission change or deployment was used.
Avoid repeating this unchanged failure without evidence of recovery.

When approved preview infrastructure is working, serve the complete exact PR head
via local HTTP and open `/slownik.html?lang=ua`:
1. Enter reader, switch EN/UA, reload, go to a local section and Back: query retained.
2. Clear, no-match query, keyboard input/focus, ka fallback, 320px viewport.
3. After the initial cache is ready, actually disable network, repeat and reload;
   verify safe update from the old cache, no unwanted requests/data loss.
4. Record exact head, URL, browser/viewport and observations. Emulation is not a
   physical-phone test. Keep draft until this and exact-head CI pass.

Rollback: release owner uses a separate tested revert PR and a new cache version.
No reset/force-push; URL q remains harmless to old code; no stored data to migrate.
