# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repository.
Current status and next steps for a fresh session are in [`HANDOFF.md`](HANDOFF.md).

## What this is

MMM-Skyss is a [MagicMirror²](https://magicmirror.builders/) module that shows
realtime public-transport departures for the Bergen / Vestland region (Norway)
using the Skyss v3 API. It is a maintained fork of MMM-Ruter.

## Architecture

A MagicMirror module has two halves that talk over socket notifications:

- `MMM-Skyss.js` — the **frontend**, runs in the browser/Electron renderer. Owns
  config, polling, building the API request body, parsing the response and
  rendering the DOM (`getDom`). It is the object `const Skyss = {…}` passed to
  `Module.register`.
- `node_helper.js` — the **backend**, runs in Node and is the only place that
  does network I/O. It POSTs the request body to
  `https://skyss.giantleap.no/v3/departures` and returns the raw response.

Request/response correlation: the frontend tags every request with a unique
per-instance id, `node_helper` echoes it back, and `socketNotificationReceived`
only consumes responses for ids it issued. The socket notification is broadcast
to every module instance, so this id keeps multiple instances from crossing
responses.

Polling: `poll()` self-schedules with exponential backoff on error (capped by
`maxReloadInterval`). On error the last good data stays on screen; a successful
empty response shows "No departures"; "Loading" is shown only before the first
successful poll.

## Commands

```bash
npm test            # unit tests (node:test, no deps)
npm run lint        # ESLint
npm run lint:css    # stylelint
npm run lint:md     # markdownlint
npm run format      # Prettier (use format:check to verify only)
npm run typecheck   # tsc --checkJs via JSDoc / @ts-check
```

CI (`.github/workflows/ci.yml`) runs all of these (tests on Node 18/20/22). Keep
it green: a green pull request is auto-merged into `main` and its branch deleted
(`.github/workflows/auto-merge.yml`) — mark a PR as a **draft** to hold it.
Fork / outside-contributor PRs are not auto-merged.

## Hard rules and conventions

- **Zero runtime dependencies.** End users `git clone` and run — there is no
  `npm install` step. All tooling (ESLint, Prettier, stylelint, markdownlint,
  TypeScript, husky) is `devDependencies` only. Do not add a runtime dependency.
- **No build step.** Source files are loaded as-is; that is why the project uses
  plain JS plus `// @ts-check` and JSDoc rather than TypeScript.
- **Type checking** is `tsc --checkJs` against JSDoc. The module object is typed
  loosely (`@type {Record<string, any>}`) because MagicMirror injects members
  (`this.translate`, `this.sendSocketNotification`, `this.updateDom`, …) at
  runtime. Ambient MM globals are declared in `types/magicmirror.d.ts`.
- **Formatting is Prettier's job** (4-space JS, 2-space JSON/CSS/YAML, print
  width 120); ESLint handles correctness (`eqeqeq` and `no-unused-vars` are
  errors).
- **Docs must be markdownlint-clean** (`.markdownlint-cli2.jsonc`); the README
  and CHANGELOG are excluded from Prettier (`.prettierignore`).

## Gotchas

- `moment` is provided globally by MagicMirror — it is not a dependency.
- The Skyss endpoint is **POST-only**; opening it in a browser (a GET) returns a
  `TEMPORARY_ERROR`. It is also **not reachable from CI / sandboxes**
  (egress-blocked), so the module can only be verified live on a real mirror.
- **Deviations** (route disruptions) come from the response's top-level `Messages`
  array and are rendered best-effort (`showDeviations`, default on); the message
  object shape is undocumented, so text is pulled from common field names — refine
  it from a real sample captured with `debug: true` (the raw array is logged then).
- `humanizeTimeTreshold` is misspelled but kept for config back-compat;
  `humanizeTimeThreshold` is accepted as an alias.

## Releasing

Bump `version` in `package.json`, add a `CHANGELOG.md` entry, and update the
"Current version is X" line in `README.md`.
