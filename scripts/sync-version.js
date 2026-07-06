"use strict";

/*
 * Single source of truth for the version is package.json. This keeps the
 * "Current version is X" line in README.md in sync with it. Run automatically by
 * the npm `version` lifecycle (npm version <patch|minor|major>) and available on
 * its own as `npm run sync-version`.
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const readmePath = path.join(root, "README.md");
const readme = fs.readFileSync(readmePath, "utf8");

const pattern = /Current version is \d+\.\d+\.\d+/;
if (!pattern.test(readme)) {
    console.error('sync-version: could not find a "Current version is X.Y.Z" line in README.md');
    process.exit(1);
}

const updated = readme.replace(pattern, "Current version is " + pkg.version);
if (updated !== readme) {
    fs.writeFileSync(readmePath, updated);
    console.log("sync-version: README version line set to " + pkg.version);
} else {
    console.log("sync-version: README already at " + pkg.version);
}
