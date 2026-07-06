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
    // Far enough ahead to always clear the humanize threshold, so it formats as a
    // clock time (with AM/PM) regardless of the current time of day.
    const t = new Date(now + 3 * 60 * 60000);
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

test("poll: walkingTime hides departures too soon to catch", () => {
    const ctx = makeInstance(def, { walkingTime: 10 });
    const t = (m) => new Date(now + m * 60000).toISOString();
    ctx.getStopInfo = (stops, cb) =>
        cb(null, [
            { lineName: "soon", time: { Timestamp: t(3) } },
            { lineName: "ok1", time: { Timestamp: t(12) } },
            { lineName: "ok2", time: { Timestamp: t(20) } }
        ]);
    ctx.poll();
    assert.deepStrictEqual(
        ctx.journeys.map((j) => j.lineName),
        ["ok1", "ok2"]
    );
});

// ---- getDom -------------------------------------------------------------

test("getDom: LOADING before first load, NODEPARTURES after", () => {
    const ctx = makeInstance(def);
    const msg = () => ctx.getDom().childNodes.find((c) => c.className === "small dimmed");
    ctx.hasLoaded = false;
    assert.strictEqual(msg().textContent, "LOADING");
    ctx.hasLoaded = true;
    assert.strictEqual(msg().textContent, "NODEPARTURES");
});

test("getTableRow: realtime accent follows usedRealtime, not the API Status", () => {
    const ctx = makeInstance(def);
    const rowFor = (journey) => {
        const tr = ctx.getTableRow(journey);
        return tr.childNodes.find((c) => (c.className || "").indexOf("time") === 0);
    };
    const base = { service: "Bus", lineName: "5", destinationName: "Town", platform: "", stopName: "" };
    const ts = new Date(now + 9 * 60000).toISOString();

    // Realtime used -> accented, even when Status happens to be "Schedule".
    const rt = rowFor(Object.assign({}, base, { usedRealtime: true, time: { Status: "Schedule", Timestamp: ts } }));
    assert.match(rt.className, /sanntid/);

    // Realtime not used -> not accented, even when Status is not "Schedule".
    const sched = rowFor(Object.assign({}, base, { usedRealtime: false, time: { Status: "Realtime", Timestamp: ts } }));
    assert.doesNotMatch(sched.className, /sanntid/);
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
    const table = ctx.getDom().childNodes.find((c) => c.tagName === "table");
    assert.ok(table, "wrapper contains a table");
    assert.strictEqual(table.className, "skyss small");
    const tbody = table.childNodes.find((c) => c.tagName === "tbody");
    assert.ok(tbody, "table has a tbody");
    assert.strictEqual(tbody.childNodes.length, 1);
});

// ---- deviations ---------------------------------------------------------

test("getStopInfo: extracts deviation text from the Messages array", () => {
    const ctx = makeInstance(def, { stops: [{ stopId: "1", stopGroupId: "2" }] });
    ctx.getStopInfo(ctx.config.stops, () => {});
    const id = ctx._sent[0].p.id;
    const body = JSON.stringify({
        PassingTimes: [],
        Stops: {},
        Messages: [{ Text: "Buss 4 er forsinket" }, "Plain string", { Foo: "ignored" }, { Title: "Omkjøring" }]
    });
    ctx.socketNotificationReceived("getstop", { id, response: body });
    assert.deepStrictEqual(ctx.deviations, ["Buss 4 er forsinket", "Plain string", "Omkjøring"]);
});

test("getDom: renders deviations above the departures with a warning icon", () => {
    const ctx = makeInstance(def);
    ctx.hasLoaded = true;
    ctx.deviations = ["Omkjøring linje 4"];
    const devBox = ctx.getDom().childNodes.find((c) => c.className === "skyss-deviations xsmall");
    assert.ok(devBox, "deviation box is present");
    assert.strictEqual(devBox.childNodes.length, 1);
    const devLine = devBox.childNodes[0];
    const icon = devLine.childNodes.find((n) => n.tagName === "span");
    assert.ok(icon && /fa-exclamation-triangle/.test(icon.className), "warning icon present");
    const text = devLine.childNodes.find((n) => n.nodeType === 3);
    assert.strictEqual(text.textContent, "Omkjøring linje 4");
});

test("getDom: no deviation box when showDeviations is false", () => {
    const ctx = makeInstance(def, { showDeviations: false });
    ctx.hasLoaded = true;
    ctx.deviations = ["something"];
    const devBox = ctx.getDom().childNodes.find((c) => c.className === "skyss-deviations xsmall");
    assert.strictEqual(devBox, undefined);
});

test("getStopInfo: skips a Message whose field is a non-string object", () => {
    const ctx = makeInstance(def, { stops: [{ stopId: "1", stopGroupId: "2" }] });
    ctx.getStopInfo(ctx.config.stops, () => {});
    const id = ctx._sent[0].p.id;
    const body = JSON.stringify({
        PassingTimes: [],
        Stops: {},
        Messages: [{ Text: { nb: "Forsinket", en: "Delayed" } }, { Title: "Omkjøring" }]
    });
    ctx.socketNotificationReceived("getstop", { id, response: body });
    assert.deepStrictEqual(ctx.deviations, ["Omkjøring"]);
});

test("getStopInfo: realtime 'x min' uses x minutes (no +1 fudge)", () => {
    const ctx = makeInstance(def, { stops: [{ stopId: "1", stopGroupId: "2" }] });
    let items;
    ctx.getStopInfo(ctx.config.stops, (err, res) => {
        items = res;
    });
    const id = ctx._sent[0].p.id;
    const body = JSON.stringify({
        Stops: {},
        Messages: [],
        PassingTimes: [
            {
                StopIdentifier: "x",
                RoutePublicIdentifier: "4",
                TripDestination: "Town",
                ServiceMode: "Bus",
                Status: "Late",
                DisplayTime: "5 min",
                AimedTime: "2026-01-01T00:00:00.000Z"
            }
        ]
    });
    ctx.socketNotificationReceived("getstop", { id, response: body });
    const minutes = (new Date(items[0].time.Timestamp).getTime() - Date.now()) / 60000;
    assert.ok(minutes > 4.5 && minutes <= 5.05, "expected ~5 minutes, got " + minutes);
    assert.strictEqual(items[0].usedRealtime, true, "realtime estimate marks the item as realtime");
});

test("getStopInfo: a non-array stopIds is skipped, not crashed", () => {
    const ctx = makeInstance(def, { stops: [{ stopGroupId: "32379", stopIds: "55861" }] });
    let cbArgs;
    ctx.getStopInfo(ctx.config.stops, (err, res) => {
        cbArgs = [err, res];
    });
    // No valid groups built (the string stopIds is skipped), so no network call.
    assert.deepStrictEqual(cbArgs, [null, []]);
    assert.strictEqual(ctx._sent, undefined);
});

// ---- safety-net timeout (lost helper response) --------------------------

test("sendRequest: a lost response times out after 30s, dropping the request", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const ctx = makeInstance(def, { stops: [{ stopId: "1", stopGroupId: "2" }] });
    let resolved = null;
    ctx.getStopInfo(ctx.config.stops, (err, res) => {
        resolved = { err, res };
    });
    const id = ctx._sent[0].p.id;
    assert.ok(ctx.requests[id], "request is pending before the timeout");

    t.mock.timers.tick(30000);

    assert.strictEqual(ctx.requests[id], undefined, "pending request entry is dropped");
    assert.strictEqual(resolved.err, "request timed out");
    // getStopInfo normalises an errored result to an empty array for the poll loop.
    assert.deepStrictEqual(resolved.res, []);
});
