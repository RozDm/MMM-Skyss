"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Guard against translation drift: every language file must expose exactly the
 * same set of keys, otherwise a missing key silently falls back to another
 * language at runtime.
 */

const dir = path.join(__dirname, "..", "translations");
const langs = ["en", "nb", "nn"];

function keysOf(lang) {
    const json = JSON.parse(fs.readFileSync(path.join(dir, lang + ".json"), "utf8"));
    return Object.keys(json).sort();
}

test("translations: every language exposes the same keys as en", () => {
    const reference = keysOf("en");
    for (const lang of langs) {
        assert.deepStrictEqual(keysOf(lang), reference, `translation "${lang}" keys differ from "en"`);
    }
});
