# Handoff notes

Current state and open work for a fresh session. Facts, commands and rules are
in [`CLAUDE.md`](CLAUDE.md); history is in [`CHANGELOG.md`](CHANGELOG.md).

## State

Version 2.6.1. Parsing is verified against the live API (see CLAUDE.md), 42
tests run on a trimmed real response, and CI is green. One dev-tool advisory is
open: markdownlint 0.42 pins `re2js` 2.8.6, and no fixed markdownlint is out yet
(Dependabot will pick it up).

## Open items, by priority

- **Errors are invisible.** An unknown stop id returns HTTP 200 with
  `PERMANENT_ERROR` ("Holdeplassen finnes ikke"): the board shows "Loading…"
  forever and nothing is logged without `debug`. A quay under the wrong
  `stopGroupId` silently shows "No departures". The node helper does not log
  non-2xx responses either.
- **The board freezes during an outage.** `updateDom` runs only after a
  successful poll, so "3 minutes" stops counting down, departed rows stay and
  nothing marks the data as stale. Fix with a render timer and a "last updated"
  hint.
- **The config could need only the StopPlace.** The API returns all quays for
  `stops: []`, but `buildRequestBody` drops groups without quays.
- **`npm install --omit=dev` fails** (`husky: not found`); use
  `"prepare": "husky || true"`.
- **Traffic.** Each poll returns the rest of the service day (~0.35 KB per
  departure: ~70 KB for a 2-quay stop in the morning, ~0.5 MB for Bergen
  busstasjon). There is no gzip, and polling continues while the module is hidden
  (no `suspend` / `resume`).
- **CSS.** The `thead` divider never renders (MagicMirror sets
  `border-collapse: separate`); `.title`, `.rightalign` and `border: 1px` are
  dead; `.sanntid` is not scoped to the module.
- **Cancelled departures** are hidden; Skyss's own board shows them as
  "Innstilt", which the module could do too.
- **Small:** `Passed` and `PredictionInaccurate` are ignored; the icon map lists
  service modes the API does not send (`Express`, `Airport bus`, `Ferry`,
  `Train`); the screenshots in `images/` come from the upstream fork.
