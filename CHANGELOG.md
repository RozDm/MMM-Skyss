# MMM-Skyss Change Log

## [2.7.1] - 2026-10-29

No change to the module itself; supply-chain hardening for the repository.

- CI: GitHub Actions are pinned to their release commit SHAs (`actions/checkout` v7.0.1, `actions/setup-node` v7.1.0, `actions/github-script` v9.0.0), because a tag can be moved to other code. This matters most for `auto-merge.yml`, which can write to the repository. Dependabot bumps the SHA together with its version comment, grouped into one weekly PR.
- Dev tooling: `re2js` is forced to 2.8.8 through `overrides`, which clears the high `npm audit` advisory. markdownlint 0.42 pins the vulnerable 2.8.6; drop the override once markdownlint moves on.
- Docs: CLAUDE.md gives the current size of `MMM-Skyss.js` (~900 lines) and notes the action pinning and the override; HANDOFF.md is updated to match.

## [2.7.0] - 2026-10-29

- Errors are visible. When there is nothing to show, the board names the problem instead of staying on "Loading…":
  - "Stop not found – check stopId / stopGroupId": Skyss answers an unknown stop with HTTP 200 and `PERMANENT_ERROR`, or none of the configured quays belongs to its `stopGroupId`;
  - "Cannot reach Skyss";
  - "No valid stops configured" (polling then stops).

  The node helper now logs non-2xx responses and Skyss error bodies to the MagicMirror log. The frontend warns once per quay that Skyss does not know under its stop group.
- The board keeps moving during an outage:
  - a 15-second refresh keeps countdowns current between polls;
  - departed rows drop off;
  - `walkingTime` and `maxItems` apply at render time;
  - an "Updated HH:mm" line shows when the data is older than two poll intervals.
- New: a stop given only by `stopGroupId` shows every quay of that StopPlace (the API returns all of them for an empty quay list), so a single ID is enough.
- New: cancelled departures are shown struck through and marked "Cancelled" / "Innstilt" (`showCancelled`, default `true`; `false` hides them as 2.6.1 did).
- Departures with `Passed: true` are left out, and a live estimate flagged `PredictionInaccurate` is prefixed "ca." / "approx.".
- No polling while the module is hidden: `suspend` / `resume` stop polling and redrawing, and fetch fresh data as soon as the module is shown again.
- Icons match the service modes the API actually sends (`Bus`, `Light rail`, `Boat`, `Ferry`, `Train`); the icon now sits in a span, since Font Awesome classes on a table cell broke its layout.
- CSS fixes:
  - the header divider now renders (MagicMirror's `border-collapse: separate` ignores a border on `<thead>`, so it is drawn on the header cells);
  - dead rules are removed (`.title`, `.rightalign`, `border: 1px`);
  - `.sanntid` is scoped to the module, and the accents are defined once.
- The response size cap is raised from 2 MB to 5 MB for StopPlace-only configs at big stations.
- Install: `npm install --omit=dev` no longer fails with `husky: not found`. The `prepare` script skips the git hook when husky is not installed.
- CI also runs when a draft PR is marked ready for review, so a green PR then auto-merges.
- New screenshots: live captures of Bergen busstasjon (English) and Bryggen (Norwegian, with a service message), made by `scripts/screenshots.js` from the real module code, MagicMirror's stylesheet and live Skyss data.
- Tests: 42 → 54. They now cover the error states, stale data, suspend/resume, StopPlace-only stops, cancelled, passed and inaccurate rows, icons and the helper's logging. The test config now starts from the module's own defaults.

## [2.6.1] - 2026-10-29

- Fix: cancelled departures were shown as normal departures with the realtime accent. The API marks them `Status: "Cancelled"` but keeps their timetable `DisplayTime`; they are now left out. Live statuses are now an explicit list (`OnTime`, `Early`, `Late`), so an unknown status no longer counts as realtime.
- Docs: every documented API fact was checked against live responses (about 5,900 departures at bus, light rail and boat stops) and corrected where wrong: the full `Status` list (`Early` and `Cancelled` were missing), the `ServiceMode` values, that the API requires only the StopPlace (an empty quay list returns all of its quays), and what an unknown stop id returns. CLAUDE.md now holds the verified API facts and a code map; HANDOFF.md holds only the state and open items.
- Tooling, with less output for people and fewer tokens for AI agents:
  - `npm test` prints one dot per test (failures in full);
  - `npm run check` runs every CI check and prints one line each;
  - Prettier and markdownlint print only findings;
  - `npm run api` (`scripts/api-sample.js`) prints a short summary of a live API response, or lists a StopPlace's quays with platforms and lines, instead of the raw JSON.
- Tests: real `Early` and `Cancelled` rows (41 → 42 tests); the fixture keeps only the quays its departures use.

## [2.6.0] - 2026-10-29

Checked against live Skyss API responses, which showed that four features did not work with the real data:

- Fix: service deviations were never shown. Real `Messages` entries look like `{ RoutePublicIdentifier, StopIdentifier, Messages: [text], messagesWithValidityPeriod: [{ message, start, end }] }`, with none of the field names the module looked for. They are now read from that shape, shown only within their validity period (Skyss sends tonight's closures in the morning) and each text once (the same text arrives once per affected route).
- Fix: the platform column (`showPlatform`) was always empty. The platform letter is on the quay (`Stops[id].Platform`), not on the departure.
- Fix: every departure was highlighted as realtime. Every row has a `DisplayTime`, but only rows whose `Status` is not `"Schedule"` (e.g. `OnTime`, `Late`) carry live data — 26 of 1442 rows in a live sample. Scheduled rows now use the exact `AimedTime` and are not highlighted (regression since 2.4.0).
- Fix: near departures showed one minute less than Skyss ("5 min" as "4 minutes", "1 min" as "Now"). `formatTime` now rounds to the nearest minute, as Skyss does, instead of rounding down (regression since 2.3.2, which removed the old `+1` workaround).
- Tests: a trimmed real API response (`test/fixtures/departures-bergen-busstasjon.json`) replaces invented response shapes, and clock-dependent tests pin the time with mock timers (35 → 41 tests).
- CI: `npm audit` now fails the build only for runtime dependencies (the module must have none) and reports advisories in dev tooling as a warning, since upstream fixes there can lag (markdownlint currently pins a `re2js` version with a high advisory).
- Dependencies: dev tooling updated (ESLint 10.13, Prettier 3.9.10, markdownlint-cli2 0.24, TypeScript 7 — `jsconfig.json` drops the removed `moduleResolution: node10`) and `actions/setup-node` v7. This supersedes the open Dependabot PRs.
- Dependabot: patch/minor updates are grouped into one weekly PR and auto-merged once CI passes. The auto-merge workflow used to skip every Dependabot PR, so they piled up and hit the open-PR limit; major updates still need a manual merge.
- Docs: README (`showPlatform`, `useRealtime`, deviations), CLAUDE.md and HANDOFF.md updated; HANDOFF lists the review findings that are still open.

## [2.5.0] - 2026-07-06

- Dependency currency: the frontend no longer uses the MagicMirror `moment` global. Time parsing (`processSkyssDisplaytime`) and formatting (`formatClock`, 12/24h) are now done with the native `Date`, removing reliance on a deprecated, maintenance-only library. Behaviour is unchanged.
- Performance/cleanup: the `DisplayTime` matchers are compiled once as module constants instead of on every departure, and the node helper collects response chunks in an array and joins once (instead of repeated string concatenation, which is quadratic on large responses).
- Infra: raised the `engines` floor to Node >= 20 (18 is end-of-life), and bumped the CI actions to `actions/checkout@v7` and `actions/setup-node@v6`.
- Tests: added coverage for `processSkyssDisplaytime` ("x min", "HH:mm" next-day rollover, and unrecognised input); the `moment` test stub is gone (32 → 35 tests).

## [2.4.0] - 2026-07-06

- Fix: realtime highlighting is now applied based on whether a realtime estimate was actually used, not on the API `Status` field. With `useRealtime: false` (or when no realtime is available) a scheduled time is no longer shown with the realtime accent.
- UX: service deviations now render with a warning icon (`fa-exclamation-triangle`) and a distinct accent colour, so a disruption is no longer confused with the orange realtime highlighting on departure times.
- UX: the fallback icon for an unrecognised transport mode is a bus instead of a rocket.
- UX: colours are now theme-friendly — the realtime and deviation accents are CSS custom properties (with fallbacks) and the header divider derives from the theme's text colour, so the module fits non-default MagicMirror themes.
- Security: CI runs under least-privilege `permissions: contents: read`; `npm ci` installs devDependencies with `--ignore-scripts`; and `npm audit` now fails the build on high/critical advisories instead of being a no-op.
- Cleanup: the "Loading"/"No departures" message is rendered with `textContent` instead of `innerHTML`.
- Performance/cleanup: the request body is built once and cached instead of being rebuilt on every poll; `buildRequestBody`, `processSkyssDisplaytime` and the request sender are module methods (defined once) rather than being recreated per poll, replacing the old `HttpClient` shim; and the node helper reuses a keep-alive HTTPS agent across polls.
- Infra: added an `engines` floor (Node >= 18); the CI test matrix now runs Node 20/22/24 (dropping end-of-life 18) and the quality job runs on Node 22; added `SECURITY.md`; and a `version` npm script keeps the README version line in sync with `package.json`.
- Tests: added coverage for the node-helper request timeout, the frontend 30-second lost-response safety-net timeout, the realtime-vs-scheduled accent, and translation-key parity across `en`/`nb`/`nn` (28 → 32 tests).

## [2.3.2] - 2026-06-26

- Fix: deviation messages whose text field is an object (e.g. a localised `{nb, en}` map) no longer render as `[object Object]`. Message text is now taken only from the first non-empty string among the common field names; entries with no usable string are skipped.
- Fix: realtime "x min" departures are no longer shown one minute late. The spurious `+1` added to the parsed minute count has been removed, so "5 min" now means five minutes.
- Fix: a string `stopIds` in the config no longer crashes request building — `stopIds` is now validated as an array before use.
- Robustness: the lost-response safety net introduced in 2.3.1 is now a per-request timeout instead of a poll-loop watchdog. A request whose response is never delivered drops its pending map entry (closing a slow leak of the request map) and surfaces an error so polling reschedules; the timer is cleared when a response arrives and `unref()`'d so it never by itself keeps the runtime alive.
- Robustness: the node helper now treats a non-2xx HTTP response from the Skyss API as an error (so polling backs off) instead of trying to parse an error page as departures.
- Cleanup: removed a stray `requests` property left on the module's prototype and dead `className` assignments in the table header builder.
- Docs: documented that `humanizeTimeTreshold: 0` disables humanization entirely (every departure shows the clock time, including ones due now).

## [2.3.1] - 2026-06-26

- Robustness: the self-scheduling poll loop now has a watchdog. If a socket response between the node helper and the frontend is ever lost, the next poll is still scheduled instead of polling stalling permanently (which would freeze the board on stale data until a restart). The backoff calculation was extracted into `nextBackoff()`.

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
