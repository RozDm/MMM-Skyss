# CLAUDE.md

MagicMirror² module showing realtime Skyss (Bergen / Vestland) departures from
the Skyss v3 API; a maintained fork of MMM-Ruter. State and open items:
[`HANDOFF.md`](HANDOFF.md).

## Saving tokens

- `npm run check` runs every CI check and prints one line each (full output only
  for a failure). `npm test` alone prints one dot per test.
- Inspect the live API with `npm run -s api -- [stopPlace[/quay,…]]`: a short
  summary. Never print a raw response (35 KB to over 1 MB).
- Skip `package-lock.json` (~35k tokens), `node_modules/`, `images/` and
  `test/fixtures/` (the API facts below describe them). In `CHANGELOG.md` read
  only the top entry. `MMM-Skyss.js` is ~700 lines: grep for the method you need.

## Architecture

- `MMM-Skyss.js`, the frontend (browser): `const Skyss = {…}` passed to
  `Module.register`. `start` → `poll` (self-scheduling, exponential backoff up to
  `maxReloadInterval`) → `getStopInfo` (`buildRequestBody` once, `sendRequest`,
  parse, `extractDeviations`, `checkKnownStops`) → `getDom` (`visibleJourneys`,
  `getTableRow`, `formatTime` / `formatClock`, `statusMessage`).
  `processSkyssDisplaytime` parses DisplayTime.
- Rendering is time-based: a 15 s refresh timer redraws, and `visibleJourneys`
  drops departed rows and applies `walkingTime` / `maxItems` at render time, so
  the board keeps moving between polls and during an outage. `suspend` / `resume`
  stop and restart polling while MagicMirror hides the module.
- Errors set `this.error = { type: "nostops" | "stop" | "fetch", detail }`. With
  nothing to show, the board names the problem instead of "Loading"; with stale
  rows it adds "Updated HH:mm". `nostops` stops polling.
- `node_helper.js`, the backend (Node), does all network I/O: it POSTs the body
  to `https://skyss.giantleap.no/v3/departures` and returns the raw text (5 MB
  cap, 15 s socket timeout). It logs network errors, non-2xx and Skyss error
  bodies to the MagicMirror log.
- Each request carries a per-instance id that the helper echoes back; the socket
  notification reaches every module instance, and each one consumes only its own
  ids.

## Skyss v3 API (verified live on 2026-10-29: bus, light rail and boat stops)

- POST only (a GET returns `TEMPORARY_ERROR`). Body:
  `{ stopGroups: [{ id: "NSR:StopPlace:N", stops: [{ id: "NSR:Quay:N" }] }] }`.
  The StopPlace id is required; `stops: []` returns all of its quays (config
  `{ stopGroupId }` alone). An unknown stop still returns HTTP 200, with
  `{ resultCode: "PERMANENT_ERROR", errorMessage: "Holdeplassen finnes ikke" }`.
  A quay under the wrong StopPlace, or one Skyss does not serve there, is just
  missing from `Stops` (`checkKnownStops` warns).
- Response: `PassingTimes`, `Stops` (keyed by quay id), `StopGroups`, `Messages`
  and `ServerTime`, covering the rest of the service day (~0.35 KB per
  departure).
- Departure fields: `RoutePublicIdentifier`, `TripDestination`, `DirectionName`,
  `StopIdentifier`, `ServiceMode` (`Bus`, `Light rail`, `Boat`, `Ferry`, `Train`;
  Flybussen is `Bus`), `AimedTime` (ISO),
  `DisplayTime`, `Status`, `Passed`, `PredictionInaccurate`, plus the unused
  `RouteDirectionIdentifier` and `TripDestinationDescription` (empty). There is no
  platform and no expected-time field.
- `Status` is `Schedule` (timetable only; most rows), a live `OnTime`, `Early` or
  `Late`, or `Cancelled` (which keeps a timetable DisplayTime). `DisplayTime` is a
  local `"HH:mm"`, or `"N min"` for a live row departing soon. The module takes the
  DisplayTime only for live rows (`SKYSS_LIVE_STATUSES`; an unknown status counts
  as timetable), shows `Cancelled` rows struck through (`showCancelled`), drops
  `Passed` rows and prefixes "ca." when `PredictionInaccurate` (both never seen
  true in samples).
- Skyss rounds "N min" to the nearest minute, and so does `formatTime`. Rounding
  down showed "5 min" as 4.
- `Stops[quay]` has `Description` (the stop name; at stations it ends with the
  platform letter), `Platform` (only on quays that have one), `ServiceModes` and
  `StopGroupIdentifier`.
- `Messages` has one entry per affected route at a quay:
  `{ StopIdentifier, RoutePublicIdentifier, RouteDirectionIdentifier,
  Messages: [text], messagesWithValidityPeriod: [{ message, start, end }] }`. The
  same text repeats for every route and arrives before it applies;
  `extractDeviations` keeps only currently valid texts, each once.
- Whether a sandbox can reach the API depends on its network policy. When it
  can, check facts with `npm run api` rather than guessing.

## Commands and CI

`npm run check` = `lint` (ESLint), `lint:css`, `lint:md`, `format:check`,
`typecheck` (`tsc --checkJs`, TypeScript 7) and `test` (`node:test`; CI runs
Node 20/22/24). A green non-draft PR is auto-merged and its branch deleted
(`auto-merge.yml`). A draft is held; marking it ready runs CI, and a green run
then auto-merges it (no manual merge needed). Dependabot's grouped weekly
patch/minor PR is auto-merged too; majors and fork PRs are not. `npm audit`
blocks only on runtime dependencies; advisories in dev tooling are a warning.
README screenshots: `node scripts/screenshots.js <MagicMirror/css/main.css>`
(Playwright, live data; no MagicMirror install needed).

## Rules

- Zero runtime dependencies and no build step: end users `git clone` and run.
  All tooling is `devDependencies`; `scripts/prepare.js` skips the husky hook
  when it is not installed, so `npm install --omit=dev` works.
- Types come from JSDoc and `// @ts-check`. The module object is typed
  `Record<string, any>` because MagicMirror injects members at runtime; MM
  globals are declared in `types/magicmirror.d.ts`.
- Prettier formats (4-space JS, 2-space JSON/CSS/YAML, width 120); ESLint
  enforces `eqeqeq` and `no-unused-vars`. Docs must pass markdownlint; README and
  CHANGELOG are not Prettier-formatted.
- Tests run on a trimmed real response
  (`test/fixtures/departures-bergen-busstasjon.json`). Pin the clock with
  `t.mock.timers` (`Date`) in anything time-relative.
- `humanizeTimeTreshold` is misspelled on purpose (config back-compat);
  `humanizeTimeThreshold` is an alias.
- Release: `npm version <patch|minor>` (it syncs the README version line), plus
  a CHANGELOG entry.
