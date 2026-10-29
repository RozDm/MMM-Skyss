"use strict";
/* global window, document */

/*
 * Regenerate the README screenshots (images/MMM-Skyss-1.png, -2.png): the real
 * module code with live Skyss data, rendered in Chromium with MagicMirror's own
 * stylesheet, fonts (Roboto, Roboto Condensed) and Font Awesome. No MagicMirror
 * code runs: the page stubs Module.register, Log and config, and this script
 * plays the node helper.
 *
 * Needs Playwright with Chromium (require("playwright")), network access to
 * Skyss, Google Fonts and cdnjs, and MagicMirror's css/main.css from a clone:
 *   git clone --depth 1 https://github.com/MagicMirrorOrg/MagicMirror
 *   node scripts/screenshots.js MagicMirror/css/main.css
 */
const { chromium } = require("playwright");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.join(__dirname, "..");
const MM_CSS = path.resolve(process.argv[2] || "MagicMirror/css/main.css");
const OUT = path.join(REPO, "images");
const TMP = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "skyss-shots-"));

const SHOTS = [
    {
        file: "MMM-Skyss-1.png",
        lang: "en",
        header: "Bergen busstasjon",
        config: { stops: [{ stopGroupId: "62356" }], showHeader: true, showPlatform: true, maxItems: 8 }
    },
    {
        file: "MMM-Skyss-2.png",
        lang: "nb",
        header: "Bryggen",
        config: { stops: [{ stopGroupId: "30835" }], maxItems: 7 }
    }
];

function post(body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const req = https.request(
            {
                hostname: "skyss.giantleap.no",
                path: "/v3/departures",
                method: "POST",
                headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
            },
            (res) => {
                const chunks = [];
                res.setEncoding("utf8");
                res.on("data", (c) => chunks.push(c));
                res.on("end", () => resolve(chunks.join("")));
            }
        );
        req.on("error", reject);
        req.end(data);
    });
}

const page = (lang) => `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8">
<link rel="stylesheet" href="file://${MM_CSS}">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@300;400;700&family=Roboto:wght@100;300;400&display=block">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/v4-shims.min.css">
<link rel="stylesheet" href="file://${REPO}/skyss.css">
<style>#c { padding: 24px 28px 16px; display: inline-block; } #c .module { margin-bottom: 0; }</style>
</head><body>
<div class="region top bar"><div class="region top left"><div class="container" id="c"></div></div></div>
<script>
  window.Log = { log() {}, info() {}, warn() {}, error() {} };
  window.config = { timeFormat: 24 };
  window.Module = { register(name, def) { window.__def = def; } };
</script>
<script src="file://${REPO}/MMM-Skyss.js"></script>
</body></html>`;

(async () => {
    if (!fs.existsSync(MM_CSS)) throw new Error("MagicMirror main.css not found: " + MM_CSS);
    const browser = await chromium.launch();
    for (const shot of SHOTS) {
        const htmlFile = path.join(TMP, "stand-" + shot.lang + ".html");
        fs.writeFileSync(htmlFile, page(shot.lang));
        const context = await browser.newContext({
            viewport: { width: 1080, height: 1920 },
            deviceScaleFactor: 2,
            timezoneId: "Europe/Oslo",
            locale: shot.lang === "en" ? "en-GB" : "nb-NO"
        });
        const tab = await context.newPage();
        await tab.goto("file://" + htmlFile);
        const translations = JSON.parse(fs.readFileSync(path.join(REPO, "translations", shot.lang + ".json"), "utf8"));
        await tab.evaluate(
            ({ config, header, translations }) => {
                const def = window.__def;
                const ctx = Object.create(def);
                ctx.name = "MMM-Skyss";
                ctx.identifier = "module_0_MMM-Skyss";
                ctx.data = { header };
                ctx.config = Object.assign({}, def.defaults, config);
                ctx.translate = (key, vars) => {
                    let s = translations[key] !== undefined ? translations[key] : key;
                    if (vars && typeof vars === "object")
                        Object.keys(vars).forEach((k) => (s = s.split("{" + k + "}").join(vars[k])));
                    return s;
                };
                // The markup MagicMirror's main.js builds around a module.
                const dom = document.createElement("div");
                dom.id = ctx.identifier;
                dom.className = "module MMM-Skyss MMM-Skyss";
                const head = document.createElement("header");
                head.className = "module-header";
                head.textContent = header;
                const content = document.createElement("div");
                content.className = "module-content";
                dom.append(head, content);
                document.getElementById("c").appendChild(dom);
                ctx.updateDom = () => content.replaceChildren(ctx.getDom());
                window.__requests = [];
                ctx.sendSocketNotification = (n, p) => window.__requests.push(p);
                window.__ctx = ctx;
                ctx.start();
                ctx.updateDom();
            },
            { config: shot.config, header: shot.header, translations }
        );
        await tab.waitForFunction(() => window.__requests.length > 0);
        const request = await tab.evaluate(() => window.__requests[0]);
        const text = await post(request.body);
        await tab.evaluate(
            ({ id, text }) => window.__ctx.socketNotificationReceived("getstop", { id, response: text }),
            { id: request.id, text }
        );
        await tab.evaluate(() => document.fonts.ready);
        await tab.waitForTimeout(800);
        const summary = await tab.evaluate(() => ({
            rows: document.querySelectorAll("table.skyss tbody tr").length,
            realtime: document.querySelectorAll(".sanntid").length,
            cancelled: document.querySelectorAll("tr.cancelled").length,
            deviations: [...document.querySelectorAll(".skyss-deviation")].map((d) => d.textContent),
            fonts: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family + " " + f.weight).length
        }));
        await tab.locator("#c").screenshot({ path: path.join(OUT, shot.file) });
        console.log(shot.file, JSON.stringify(summary));
        await context.close();
    }
    await browser.close();
})();
