# Handoff notes

Status and next steps for anyone — human or AI — picking up this repo **without
prior context**. For architecture, commands and conventions read
[`CLAUDE.md`](CLAUDE.md); for the full change history read
[`CHANGELOG.md`](CHANGELOG.md).

## Current state

- **Version 2.6.0.** Parsing is checked against live Skyss API responses: the
  realtime accent, platform letters, minute counts and service messages match
  what Skyss itself shows. The tests use a trimmed real response
  (`test/fixtures/`).
- **CI:** `npm test` (41 tests, Node 20/22/24), ESLint, stylelint, markdownlint,
  Prettier and `tsc --checkJs` (TypeScript 7). `npm audit` blocks only on runtime
  dependencies; advisories in dev tooling are a warning. As of 2.6.0 one is open:
  markdownlint 0.42 pins `re2js` 2.8.6 (ReDoS advisory), and no markdownlint
  release with the fix exists yet. Dependabot will pick it up.
- **Zero runtime dependencies** (hard rule). All tooling is `devDependencies`;
  end users just `git clone` and run — there is no build step and no `npm install`.

## How to make a change (the workflow)

`main` is protected (no direct push, no force-push, no deletion). Land changes
through a pull request:

1. Branch from `main`.
2. Make the change. Keep CI green — run locally before pushing:
   `npm test`, `npm run lint`, `npm run lint:css`, `npm run lint:md`,
   `npm run format:check`, `npm run typecheck`.
3. Open a **non-draft** PR against `main`. CI runs and, on green, the PR is
   **auto-merged and its branch auto-deleted** (`.github/workflows/auto-merge.yml`).
   Mark a PR as a **draft** to hold it. Fork / outside-contributor PRs are not
   auto-merged (they need a manual review + merge). Dependabot's patch/minor
   updates (grouped into one weekly PR) are auto-merged; its major updates are not.

## What has been done (summary — details in CHANGELOG)

- **Correctness fixes:** 12/24h time formatting, missing-`stops` crash guard,
  negative-minute display, `animationSpeed`, per-instance request-id correlation,
  exponential backoff, and a "No departures" state.
- **Robustness / review hardening (2.3.1–2.3.2):** a per-request frontend timeout
  so a lost helper response can't stall polling or leak the request map; the node
  helper treats a non-2xx HTTP status as an error; `stopIds` is validated as an
  array before use.
- **Checked against the real API (2.6.0):** service messages are read from their
  real shape (validity period honoured, each text once), the platform comes from
  the quay, only live departures get the realtime accent, and minutes are rounded
  the way Skyss rounds them.
- **Features:** `walkingTime` (hide departures too soon to catch); `showDeviations`
  (service messages from the API's top-level `Messages`); Norwegian Nynorsk (`nn`).
- **Quality / infra:** unit tests (`node:test`), CI matrix, ESLint + Prettier +
  stylelint + markdownlint + `// @ts-check`, husky + lint-staged, Dependabot,
  auto-merge with branch cleanup.
- **Security (public repo):** auto-merge only merges non-fork PRs from the
  owner/collaborators and Dependabot patch/minor updates; no secrets in the repo;
  `main` is protected.

## Open items / next steps

Found in the 2.6.0 review and not fixed yet, roughly in priority order:

- **Errors are invisible.** A wrong stop id returns HTTP 200 with
  `PERMANENT_ERROR` / "Holdeplassen finnes ikke": the module shows "Loading…"
  forever and logs nothing without `debug`. A quay paired with the wrong
  `stopGroupId` returns an empty result and silently shows "No departures". The
  node helper does not log non-2xx responses either.
- **The board freezes during an outage.** `updateDom` only runs after a successful
  poll, so relative times ("3 minutes") stop updating, departed buses stay listed
  and nothing marks the data as stale. A render timer that prunes departed rows,
  plus a "last updated" hint, would fix it.
- **`npm install --omit=dev` fails** (`husky: not found`, exit 127) because of
  `"prepare": "husky"`; `"prepare": "husky || true"` avoids it.
- **Traffic.** Each poll returns the rest of the day's timetable (about 35 KB per
  quay, about 0.5 MB for Bergen busstasjon), without gzip, and polling continues
  while the module is hidden (no `suspend` / `resume`).
- **CSS.** The header divider (`table.skyss thead` border) never renders, because
  MagicMirror sets `border-collapse: separate`; `.title`, `.rightalign` and
  `border: 1px` are dead rules; `.sanntid` is not scoped to the module.
- **Small:** the `Passed` and `PredictionInaccurate` fields are ignored; marking a
  draft PR as ready does not re-run CI, so it is not auto-merged until the next
  push (`ci.yml` has no `ready_for_review` trigger).
- **Optional polish:** refresh the screenshots in `images/` (they are from the
  upstream fork); publish to the MagicMirror 3rd-party module list.

## Gotchas (full list in CLAUDE.md)

- The Skyss endpoint is **POST-only**. Whether a sandbox can reach it depends on
  its network policy; when it can, verify parsing against a live response.
- Only departures whose `Status` is not `"Schedule"` carry live data.
- Time formatting uses the native `Date` (no `moment` global anymore).
- `humanizeTimeTreshold` is misspelled but frozen for config back-compat
  (`humanizeTimeThreshold` is accepted as an alias).
