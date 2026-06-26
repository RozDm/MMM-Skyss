"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { loadFrontend, makeInstance } = require("./helpers");

const def = loadFrontend();
const pad = (n) => ("0" + n).slice(-2);
const now = Date.now();

// ---- formatTime ---------------------------------------------------------

test("formatTime: past departure collapses to NOW (no negative minutes)", () => {
    const ctx = makeInstance(def);
    assert.strictEqual(ctx.formatTime(new Date(now - 2 * 60000).toISOString()), "NOW");
});

test("formatTime: humanizes minutes under the threshold", () => {
    const ctx = makeInstance(def);
    assert.strictEqual(ctx.formatTime(new Date(now + 5 * 60000 + 1000).toISOString()), "5 MINUTES");
});

test("formatTime: 24h clock above the threshold", () => {
    const ctx = makeInstance(def, { timeFormat: "HH:mm" });
    const t = new Date(now + 40 * 60000);
    t.setSeconds(0, 0);
    assert.strictEqual(ctx.formatTime(t.toISOString()), pad(t.getHours()) + ":" + pad(t.getMinutes()));
});

test("formatTime: 12h clock respects timeFormat", () => {
    const ctx = makeInstance(def, { timeFormat: "h:mm A" });
    const t = new Date(now + 40 * 60000);
    t.setHours(14, 5, 0, 0);
    assert.match(ctx.formatTime(t.toISOString()), /\b(AM|PM)\b/);
});

// ---- getStopInfo (request building + guards) ----------------------------

test("getStopInfo: undefined stops -> empty success, no network call", () => {
    const ctx = makeInstance(def, { stops: undefined });
    let cb;
    ctx.getStopInfo(ctx.config.stops, (err, res) => {
        cb = [err, res];
    });
    assert.deepStrictEqual(cb, [null, []]);
    assert.strictEqual(ctx._sent, undefined);
});

test("getStopInfo: valid stops -> tagged request with correct body", () => {
    const ctx = makeInstance(def, {
        stops: [
            { stopId: "55861", stopGroupId: "32379" },
            { stopId: "55863", stopGroupId: "32379" }
        ]
    });
    ctx.getStopInfo(ctx.config.stops, () => {});
    assert.strictEqual(ctx._sent.length, 1);
    const msg = ctx._sent[0];
    assert.strictEqual(msg.n, "getstop");
    assert.ok(msg.p.id, "request carries an id");
    assert.deepStrictEqual(msg.p.body, {
        stopGroups: [
            {
                id: "NSR:StopPlace:32379",
                stops: [{ id: "NSR:Quay:55861" }, { id: "NSR:Quay:55863" }]
            }
        ]
    });
    assert.ok(ctx.requests[msg.p.id], "callback stored under its id");
});

test("getStopInfo: grouped config form produces the same body", () => {
    const ctx = makeInstance(def, { stops: [{ stopGroupId: "32379", stopIds: ["55861", "55863"] }] });
    ctx.getStopInfo(ctx.config.stops, () => {});
    assert.deepStrictEqual(ctx._sent[0].p.body, {
        stopGroups: [
            {
                id: "NSR:StopPlace:32379",
                stops: [{ id: "NSR:Quay:55861" }, { id: "NSR:Quay:55863" }]
            }
        ]
    });
});

// ---- request-id correlation (multi-instance safety) ---------------------

test("socketNotificationReceived: only consumes responses for its own id", () => {
    const ctx = makeInstance(def, { stops: [{ stopId: "1", stopGroupId: "2" }] });
    let resolved = null;
    ctx.getStopInfo(ctx.config.stops, (err, res) => {
        resolved = { err, res };
    });
    const id = ctx._sent[0].p.id;

    // A response for another instance's id must be ignored.
    ctx.socketNotificationReceived("getstop", { id: "other-instance:1", response: "{}" });
    assert.strictEqual(resolved, null);
    assert.ok(ctx.requests[id], "our request is still pending");

    // Our own id resolves the callback and clears the entry.
    const body = JSON.stringify({ PassingTimes: [], Stops: {} });
    ctx.socketNotificationReceived("getstop", { id, response: body });
    assert.deepStrictEqual(resolved, { err: null, res: [] });
    assert.strictEqual(ctx.requests[id], undefined, "request entry cleared");
});

test("socketNotificationReceived: error payload propagates as an error", () => {
    const ctx = makeInstance(def, { stops: [{ stopId: "1", stopGroupId: "2" }] });
    let resolved = null;
    ctx.getStopInfo(ctx.config.stops, (err, res) => {
        resolved = { err, res };
    });
    const id = ctx._sent[0].p.id;
    ctx.socketNotificationReceived("getstop", { id, err: "network down" });
    assert.strictEqual(resolved.err, "network down");
    assert.deepStrictEqual(resolved.res, []);
});

// ---- poll: empty state, stale-on-error, backoff, sorting ----------------

test("poll: successful empty result sets hasLoaded and clears journeys", () => {
    const ctx = makeInstance(def);
    ctx.journeys = [{ old: true }];
    ctx.getStopInfo = (stops, cb) => cb(null, []);
    ctx.poll();
    assert.strictEqual(ctx.hasLoaded, true);
    assert.deepStrictEqual(ctx.journeys, []);
    assert.strictEqual(ctx._scheduled, ctx.config.serviceReloadInterval);
});

test("poll: error keeps stale data and backs off exponentially", () => {
    const ctx = makeInstance(def);
    const stale = [{ time: { Timestamp: new Date().toISOString() } }];
    ctx.journeys = stale;
    ctx.getStopInfo = (stops, cb) => cb("boom", []);
    ctx.poll();
    assert.strictEqual(ctx.journeys, stale, "stale data is preserved on error");
    assert.strictEqual(ctx.consecutiveErrors, 1);
    assert.strictEqual(ctx._scheduled, ctx.config.serviceReloadInterval * 2);
});

test("poll: backoff is capped at maxReloadInterval", () => {
    const ctx = makeInstance(def, { serviceReloadInterval: 30000, maxReloadInterval: 120000 });
    ctx.getStopInfo = (stops, cb) => cb("boom", []);
    for (let i = 0; i < 10; i++) ctx.poll();
    assert.strictEqual(ctx._scheduled, 120000);
});

test("poll: success resets the error counter", () => {
    const ctx = makeInstance(def);
    ctx.getStopInfo = (stops, cb) => cb("boom", []);
    ctx.poll();
    assert.strictEqual(ctx.consecutiveErrors, 1);
    ctx.getStopInfo = (stops, cb) => cb(null, []);
    ctx.poll();
    assert.strictEqual(ctx.consecutiveErrors, 0);
});

test("poll: sorts journeys ascending and applies maxItems", () => {
    const ctx = makeInstance(def, { maxItems: 2 });
    const t = (m) => new Date(now + m * 60000).toISOString();
    ctx.getStopInfo = (stops, cb) =>
        cb(null, [
            { lineName: "C", time: { Timestamp: t(30) } },
            { lineName: "A", time: { Timestamp: t(5) } },
            { lineName: "B", time: { Timestamp: t(10) } }
        ]);
    ctx.poll();
    assert.deepStrictEqual(
        ctx.journeys.map((j) => j.lineName),
        ["A", "B"]
    );
});

// ---- getDom -------------------------------------------------------------

test("getDom: LOADING before first load, NODEPARTURES after", () => {
    const ctx = makeInstance(def);
    ctx.hasLoaded = false;
    assert.strictEqual(ctx.getDom().innerHTML, "LOADING");
    ctx.hasLoaded = true;
    assert.strictEqual(ctx.getDom().innerHTML, "NODEPARTURES");
});

test("getDom: renders a tbody with one row per journey", () => {
    const ctx = makeInstance(def);
    ctx.hasLoaded = true;
    ctx.journeys = [
        {
            service: "Bus",
            lineName: "5",
            destinationName: "Town",
            platform: "A",
            stopName: "Stop",
            time: { Status: "Realtime", Timestamp: new Date(now + 9 * 60000).toISOString() }
        }
    ];
    const table = ctx.getDom();
    assert.strictEqual(table.tagName, "table");
    assert.strictEqual(table.className, "skyss small");
    const tbody = table.childNodes.find((c) => c.tagName === "tbody");
    assert.ok(tbody, "table has a tbody");
    assert.strictEqual(tbody.childNodes.length, 1);
});
