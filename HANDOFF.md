# Handoff notes

Current state and open work for a fresh session. Facts, commands and rules are
in [`CLAUDE.md`](CLAUDE.md); history is in [`CHANGELOG.md`](CHANGELOG.md).

## State

Version 2.7.0. Parsing is verified against the live API, the review findings
are fixed, and the README screenshots are our own live captures. 54 tests run,
including on a trimmed real response, and CI is green. One dev-tool advisory is
open: markdownlint 0.42 pins `re2js` 2.8.6, and no fixed markdownlint is out yet
(Dependabot will pick it up).

## Open items, by priority

- **Time zone.** A live row's `"HH:mm"` DisplayTime is parsed in the mirror's
  local time, which assumes the mirror runs in Europe/Oslo. Timetable rows use
  the absolute `AimedTime` and are not affected.
- **Traffic.** Each poll returns the rest of the service day (~0.35 KB per
  departure); the API has no limit parameter and no gzip. Polling already pauses
  while the module is hidden.
- **Messages come and go.** A service message appears alongside its route's
  departures. At Bryggen, the line 39 message dropped out of the response after
  the bus left. The board simply follows the response.
- **Long outages.** The board keeps the first 200 departures of the last good
  response (`MAX_KEPT_DEPARTURES`); after a few hours without updates it runs out
  and shows "Cannot reach Skyss".
- **Supply chain.** GitHub Actions are pinned by major tag, not by SHA, while
  `auto-merge.yml` runs with `contents: write`.
