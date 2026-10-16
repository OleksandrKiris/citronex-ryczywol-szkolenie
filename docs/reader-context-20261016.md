# Reader section and keyboard context — 2026-10-16

Base: `2586f0af192506251e098b88369eb1fe6793896a`. Main/Pages successful;
no open PRs. Public desktop Chrome confirmed that selecting Ukrainian «Візки»
left the URL without `topic` and lost focus to BODY.

The selected real topic now replaces the current URL history entry; language,
other query/hash and history state are retained. Focus returns to the selected
button without scrolling. Existing language-change topic handling and unknown-ID
fallback remain. Denied history access leaves the displayed material usable;
reload persistence is not guaranteed in that restricted mode.

All original instructions, translations, contacts, media, step order and links
are unchanged. UI/HTML/worker version is `20261016-reader-context1`; other asset
URLs remain unchanged. This follows Siechnice PR15, adapted to the current
Ryczywół source and location-custom data, not a cross-location source overwrite.

Validation: 150 Node tests, including 12 new real renderer/handler scenarios;
11 reproduced failures before the fix. All six topics and nine languages,
reload, language change, query/hash, focus and restricted browser APIs covered.
Syntax, button/map audits and full diff checked. No npm test is present. Full
resource audits run in CI against the complete repository; media are not
downloaded again into the local code snapshot. Release and live checks in PR.

This is desktop browser/code QA; phone and screen-reader testing are not claimed.
No messages/calls/submissions performed. Rollback: revert PR and advance cache.
