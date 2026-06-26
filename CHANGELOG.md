# MMM-Skyss Change Log

## [2.3.0] - 2026-06-26

- Added a `showDeviations` option (default `true`): Skyss service messages / deviations from the API's top-level `Messages` field are shown above the departures. The message object shape is undocumented, so the text is extracted defensively from common field names and the raw `Messages` array is logged under `debug` to help refine it from a real disruption sample.

## [2.2.0] - 2026-06-26

- New `walkingTime` option: departures leaving sooner than the configured number of minutes (the time needed to reach the stop) are hidden. Default `0` keeps the current behaviour. Implements the "filter departures too close to make" enhancement.
- Added a Norwegian Nynorsk (`nn`) translation.
- Tooling: added stylelint (CSS) and markdownlint (docs) with configs, npm scripts and CI steps; a husky + lint-staged pre-commit hook; Dependabot for npm and GitHub Actions updates; and promoted the ESLint `eqeqeq` and `no-unused-vars` rules from warning to error. All dev-only — no runtime dependencies added.

## [2.1.1] - 2026-06-26

- Tooling/standardization: added ESLint (flat config) + Prettier + EditorConfig and an npm `lint`/`format`/`typecheck` script set. CI now also runs lint, format-check and a JSDoc `// @ts-check` type-check (via TypeScript) alongside the tests. All of this is `devDependencies` only — the module still has zero runtime dependencies and needs no install to run.
- Enabled `// @ts-check` with JSDoc annotations on both source files (with ambient declarations for the MagicMirror-provided globals) and fixed the few things it surfaced: removed a useless regex escape, used strict equality and `Date.getTime()` for time arithmetic. No behavioural change.
- Fixed a stale `showStopName` code comment (the per-stop `name` override was removed back in 2.0.1).

## [2.1.0] - 2026-06-26

- Multiple module instances are now isolated: each request is tagged with a unique id and tracked in a per-instance map, so the broadcast socket response only resolves the instance that issued it (the previous shared FIFO queue could cross responses between instances).
- Errors no longer wipe the board. The last good departures stay on screen and the next poll backs off exponentially, capped by the new `maxReloadInterval` option (default 5 minutes). A successful but empty response now shows a "No departures" message; "Loading…" is only shown before the first successful poll.
- Added a test suite (`npm test`, built on Node's built-in `node:test` — still zero dependencies) and a GitHub Actions CI workflow running syntax checks, the tests on Node 18/20/22, and `npm audit`.
- Renamed the leftover `ruter` CSS classes to `skyss`, accept the correctly spelled `humanizeTimeThreshold` as an alias for `humanizeTimeTreshold`, and documented the realtime "+1 minute" adjustment.

## [2.0.2] - 2026-06-26

- Fix: `formatTime` now honours the configured 12/24-hour `timeFormat` (via `moment`). Previously it always rendered 24-hour time and the format detection in `start()` was dead code.
- Fix: added a `stops` default and an array guard so an omitted/invalid `stops` config no longer crashes the module with a `TypeError`. When no valid stops are configured the pointless API call is skipped.
- Fix: header styling now actually applies (`thead.className` instead of the no-op `thead.addClass`); header cells are wrapped in a `<tr>` and body rows in a `<tbody>` for valid table markup.
- Fix: past departures no longer display as negative minutes (e.g. "-2 minutes"); they collapse to "Now".
- Fix: `animationSpeed` is now passed to `updateDom()` so the option takes effect.
- Fix: each module instance now uses its own request queue (`this.requests`), so running multiple MMM-Skyss instances no longer crosses responses.
- Hardening: the node helper caps the response body at 2 MB and aborts oversized responses to avoid memory exhaustion.
- Cleanup: declared the previously implicit global `inMinutes`, removed the unused `previousJourneys`, and refreshed the stale file header.

## [2.0.1] - 2026-06-25

- Security/supply-chain: removed all runtime dependencies from `package.json`. The placeholder/name-squatting packages (`crypto`, `http`, `https`) and the unused `async` package are gone; the module relies only on Node's built-in modules and the MagicMirror core. No `npm install` is required anymore.
- `node_helper.js` now uses the built-in `node:https`, gates all logging behind the `debug` flag (previously it logged request/response unconditionally) and adds a request timeout (15s).
- Robustness: `JSON.parse` of the API response is wrapped in try/catch with shape validation, so a malformed/error response no longer crashes the module — it simply skips the update and keeps the last good data.
- Replaced the `throw` inside the frontend socket handler with graceful error handling and fixed the request-queue de-sync that could happen after a failed request.
- Docs: corrected install instructions (no dependencies) and removed documentation for options that were never implemented (`maxNameLength`, per-stop `stopName` override).
- Fixed `package.json` metadata (`name`, `license`) to match the project and the bundled MIT `LICENSE`.

## [2.0.0] - 2025-10-08

- Migrate to Skyss API v3 using POST `https://skyss.giantleap.no/v3/departures` with JSON body
- New request body builder with grouped `stopGroups` and automatic `NSR:` ID prefixing
- Support alternative grouped configuration: `{ stopGroupId, stopIds: [] }`
- Node helper now performs HTTPS POST and logs status/preview for debugging
- Add `debug` configuration option for verbose logging across frontend and helper
- Realtime time parsing from `DisplayTime` with fallback to scheduled `AimedTime`
- Use `journey.ServiceMode` and `stop.Description`; safe platform handling
- Breaking change: each stop now requires a `stopGroupId` (StopPlace) in addition to `stopId` (Quay) unless using grouped form

## [1.3.0s1.1.1] - 2018-01-18

- Temporary fix on an update issue which needed to be addressed quickly.

## [1.3.0s1.1.0] - 2018-01-18

- Changed API endpoint to giantleap.no which has a different format and changed a bunch of behavior.

## [1.3.0s1.0.0] - 2017-11-01

- Ruter app has now been forked from the ruter app. version naming is now [(original version)s(Fork version)]

## [1.3.0] - 2017-08-19

- The name of the stop will now automatically be fetched if you set `showStopName`. But you can still override it with the stop config value: `stopName`. See [documentation](README.md "MMM-Ruter Documentation") for more information.

## [1.2.0] - 2017-08-13

- Added the option to display a custom stop name in the list. New module config value: `showStopName` and new stop config value: `stopName`. See [documentation](README.md "MMM-Ruter Documentation") for more information.
- Fixed time format

## [1.1.0] - 2017-04-17

- Now it's possible to add multiple instances of the module
- Added some padding between line number and stop name
- Set default animationSpeed to 0 to prevent "blinking" when module updates often
- Moved all service calls and logic from node_helper.js ("backend") to MMM-Ruter.js ("frontent") to simplify a rather complex logic. My initial goal by putting everything in the backend, was to reduce number of calls to the service. That was not a good design decision...

## [1.0.2] - 2016-11-01

- Added timeToThere config value to stops
- Fixed duplication of journeys if manually refreshed

## [1.0.1] - 2016-10-24

- Fixed stupid this/self-bug in the refresh-code that I managed to introduce just before initial commit

## [1.0.0] - 2016-10-23

- Initial version
