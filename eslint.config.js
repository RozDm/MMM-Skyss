"use strict";

const js = require("@eslint/js");
const globals = require("globals");
const eslintConfigPrettier = require("eslint-config-prettier");

module.exports = [
    {
        ignores: ["node_modules/**"]
    },
    js.configs.recommended,
    {
        // MagicMirror frontend module — runs in the browser/Electron renderer.
        files: ["MMM-Skyss.js"],
        languageOptions: {
            ecmaVersion: 2021,
            sourceType: "script",
            globals: {
                ...globals.browser,
                Module: "readonly",
                Log: "readonly",
                MM: "readonly",
                config: "readonly",
                moment: "readonly"
            }
        }
    },
    {
        // Node helper, tests and tooling — run in Node.
        files: ["node_helper.js", "test/**/*.js", "eslint.config.js"],
        languageOptions: {
            ecmaVersion: 2021,
            sourceType: "commonjs",
            globals: { ...globals.node }
        }
    },
    {
        // Project-wide rule tweaks. Style (var/quotes/spacing) is owned by Prettier;
        // here we keep correctness-oriented rules and treat the rest as advisory.
        rules: {
            "no-unused-vars": ["warn", { args: "none" }],
            eqeqeq: ["warn", "smart"]
        }
    },
    eslintConfigPrettier
];
