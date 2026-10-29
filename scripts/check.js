"use strict";

/*
 * Run every check CI runs (lint, lint:css, lint:md, format:check, typecheck,
 * test) and print one line per check. Only a failing check's own output is
 * shown (its last 60 lines), so a green run stays a few lines long. Exits 1 if
 * any check failed. Usage: npm run check
 */

const { spawnSync } = require("node:child_process");

const CHECKS = ["lint", "lint:css", "lint:md", "format:check", "typecheck", "test"];
const MAX_LINES = 60;

let failed = 0;
for (const name of CHECKS) {
    // shell: true so "npm" resolves to npm.cmd on Windows too.
    const run = spawnSync("npm run -s " + name, { shell: true, encoding: "utf8" });
    if (run.status === 0) {
        console.log("ok   " + name);
        continue;
    }
    failed++;
    const lines = ((run.stdout || "") + (run.stderr || "")).trimEnd().split("\n");
    console.log("FAIL " + name);
    if (lines.length > MAX_LINES) console.log("  ... " + (lines.length - MAX_LINES) + " earlier lines omitted");
    console.log(
        lines
            .slice(-MAX_LINES)
            .map((l) => "  " + l)
            .join("\n")
    );
}

console.log(failed ? failed + " of " + CHECKS.length + " checks failed" : "all " + CHECKS.length + " checks passed");
process.exit(failed ? 1 : 0);
