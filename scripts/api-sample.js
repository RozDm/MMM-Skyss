"use strict";

/*
 * Query the live Skyss v3 /departures API and print a compact summary instead
 * of the raw JSON (about 70 KB for one roadside stop, over 1 MB for many).
 * Use it to check stop ids or to see what the API returns right now.
 *
 * Usage: node scripts/api-sample.js [stopPlace[/quay,quay...] ...] [--raw N]
 *   Ids may be numeric ("32379") or full NSR ids ("NSR:StopPlace:32379").
 *   A stopPlace without quays returns all of its quays, with their platform
 *   letters and lines, which is handy for finding the quay ids to configure.
 *   With no stop argument it uses the README example (32379/55861,55863).
 *   --raw N also prints the first N departures as JSON.
 */

const https = require("node:https");

const args = process.argv.slice(2);
let raw = 0;
const specs = [];
for (let i = 0; i < args.length; i++) {
    if (args[i] === "--raw") raw = parseInt(args[++i], 10) || 1;
    else specs.push(args[i]);
}
if (specs.length === 0) specs.push("32379/55861,55863");

const nsr = (id, type) => (id.startsWith("NSR:") ? id : "NSR:" + type + ":" + id);
const body = JSON.stringify({
    stopGroups: specs.map((spec) => {
        const [group, quays] = spec.split("/");
        return {
            id: nsr(group, "StopPlace"),
            stops: (quays ? quays.split(",") : []).filter(Boolean).map((q) => ({ id: nsr(q, "Quay") }))
        };
    })
});

const count = (list) => {
    const c = {};
    list.forEach((v) => (c[v] = (c[v] || 0) + 1));
    return Object.entries(c)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => k + " " + n)
        .join(", ");
};
const keysOf = (list) => [...new Set(list.flatMap((o) => Object.keys(o || {})))].join(", ");
const byNumber = (a, b) => a.localeCompare(b, undefined, { numeric: true });
const minute = (iso) => (iso || "?").replace(/:\d\d\.\d+Z$|:\d\dZ$/, "Z");
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function summarize(status, text) {
    let r;
    try {
        r = JSON.parse(text);
    } catch {
        console.log("HTTP " + status + ", not JSON: " + cut(text, 200));
        return 1;
    }
    if (!Array.isArray(r.PassingTimes)) {
        console.log("HTTP " + status + ", API error: " + [r.resultCode, r.errorCode, r.errorMessage].join(" "));
        return 1;
    }
    const pts = r.PassingTimes;
    const times = pts.map((p) => Date.parse(p.AimedTime)).filter((t) => !isNaN(t));
    const span = times.length ? (Math.max(...times) - Math.min(...times)) / 3.6e6 : 0;
    console.log(`HTTP ${status}, ${Math.round(text.length / 1024)} KB, ServerTime ${r.ServerTime}`);
    console.log(`departures: ${pts.length} over ${span.toFixed(1)} h`);
    console.log("  Status: " + count(pts.map((p) => p.Status)));
    console.log("  ServiceMode: " + count(pts.map((p) => p.ServiceMode)));
    console.log(
        "  DisplayTime: " +
            count(
                pts.map((p) =>
                    /^\d+ min$/.test(p.DisplayTime)
                        ? "N min"
                        : /^\d\d:\d\d$/.test(p.DisplayTime)
                          ? "HH:mm"
                          : JSON.stringify(p.DisplayTime)
                )
            )
    );

    const quays = Object.values(r.Stops || {});
    console.log(`quays: ${quays.length}`);
    quays.slice(0, 30).forEach((s) => {
        const own = pts.filter((p) => p.StopIdentifier === s.Identifier);
        const lines = [...new Set(own.map((p) => p.RoutePublicIdentifier))].sort(byNumber);
        const dirs = [...new Set(own.map((p) => p.DirectionName).filter(Boolean))].slice(0, 2);
        console.log(
            `  ${s.Identifier}  ${s.Description}  platform ${s.Platform || "-"}  lines ${cut(lines.join(" "), 60) || "-"}` +
                (dirs.length ? `  (${cut(dirs.join("; "), 60)})` : "")
        );
    });
    if (quays.length > 30) console.log(`  ... ${quays.length - 30} more`);

    const entries = r.Messages || [];
    const texts = {};
    const now = Date.parse(r.ServerTime) || Date.now();
    entries.forEach((m) =>
        (m.messagesWithValidityPeriod || []).forEach((v) => {
            const key = (v.message || "").trim() + "|" + v.start + "|" + v.end;
            texts[key] = texts[key] || { text: (v.message || "").trim(), start: v.start, end: v.end, lines: new Set() };
            texts[key].lines.add(m.RoutePublicIdentifier);
        })
    );
    const list = Object.values(texts);
    console.log(`messages: ${entries.length} entries, ${list.length} distinct`);
    list.slice(0, 10).forEach((t) => {
        const state = now < Date.parse(t.start) ? "upcoming" : now > Date.parse(t.end) ? "expired " : "active  ";
        const lines = [...t.lines].filter(Boolean).sort(byNumber).join(" ");
        console.log(`  ${state} ${cut(t.text, 90)}  [lines ${cut(lines, 40)}] ${minute(t.start)}..${minute(t.end)}`);
    });

    console.log("fields: PassingTimes {" + keysOf(pts) + "}");
    console.log("        Stops {" + keysOf(quays) + "}; Messages {" + keysOf(entries) + "}");
    if (raw > 0) console.log(JSON.stringify(pts.slice(0, raw), null, 1));
    return 0;
}

const req = https.request(
    {
        hostname: "skyss.giantleap.no",
        path: "/v3/departures",
        method: "POST",
        timeout: 20000,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    },
    (res) => {
        const chunks = [];
        res.setEncoding("utf8");
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
            process.exitCode = summarize(res.statusCode, chunks.join(""));
        });
    }
);
req.on("timeout", () => req.destroy(new Error("request timed out")));
req.on("error", (e) => {
    console.log("request failed: " + e.message);
    process.exitCode = 1;
});
req.end(body);
