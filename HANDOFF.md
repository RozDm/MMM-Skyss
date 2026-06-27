# Handoff notes

Status and next steps for anyone — human or AI — picking up this repo **without
prior context**. For architecture, commands and conventions read
[`CLAUDE.md`](CLAUDE.md); for the full change history read
[`CHANGELOG.md`](CHANGELOG.md).

## Current state

- **Version 2.3.2.** The module works and is fully covered by tooling.
- **Green everywhere:** `npm test` (28 tests, Node 18/20/22), ESLint, stylelint,
  markdownlint, Prettier and `tsc --checkJs` all pass in CI.
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
   auto-merged (they need a manual review + merge).

## What has been done (summary — details in CHANGELOG)

- **Correctness fixes:** 12/24h time formatting, missing-`stops` crash guard,
  negative-minute display, `animationSpeed`, per-instance request-id correlation,
  exponential backoff, and a "No departures" state.
- **Robustness / review hardening (2.3.1–2.3.2):** a per-request frontend timeout
  so a lost helper response can't stall polling or leak the request map; the node
  helper treats a non-2xx HTTP status as an error; deviation text is taken only
  from non-empty string fields (no `[object Object]`); realtime "x min" no longer
  adds a spurious minute; `stopIds` is validated as an array before use.
- **Features:** `walkingTime` (hide departures too soon to catch); `showDeviations`
  (service messages from the API's top-level `Messages`); Norwegian Nynorsk (`nn`).
- **Quality / infra:** unit tests (`node:test`), CI matrix, ESLint + Prettier +
  stylelint + markdownlint + `// @ts-check`, husky + lint-staged, Dependabot,
  auto-merge with branch cleanup.
- **Security (public repo):** auto-merge only merges non-fork PRs from the
  owner/collaborators; no secrets in the repo; `main` is protected.

## Open items / next steps

- **Deviations need a real sample.** `showDeviations` reads the response's
  top-level `Messages` array, but every captured sample so far had it **empty**.
  The text is extracted best-effort from the first **non-empty string** among the
  common fields (`Text` / `Message` / `Title` / `Description` / `Body` / `Value`;
  a localised object in one of them is ignored, as of 2.3.2). When a disruption is
  actually live, capture the response with `debug: true` and use the logged
  `Messages` JSON to confirm / refine the field names in `MMM-Skyss.js`
  (`getStopInfo`) and the test in `test/frontend.test.js`.
- **Live verification.** The Skyss API is **egress-blocked from CI / sandboxes**,
  so the module can only be confirmed end to end on a real MagicMirror. Parsing has
  been checked against a real sample response and matches the fields the module
  reads.
- **Optional polish:** refresh the screenshots in `images/` (they are from the
  upstream fork); publish to the MagicMirror 3rd-party module list.

## Gotchas (full list in CLAUDE.md)

- The Skyss endpoint is **POST-only** and not reachable from CI.
- `moment` is a MagicMirror global, not a dependency.
- `humanizeTimeTreshold` is misspelled but frozen for config back-compat
  (`humanizeTimeThreshold` is accepted as an alias).
