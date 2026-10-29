"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { loadFrontend, makeInstance } = require("./helpers");

const def = loadFrontend();
const pad = (n) => ("0" + n).slice(-2);
const now = Date.now();

// A real Skyss v3 /departures response for Bergen busstasjon + Byparken, captured
// 2026-10-29 and trimmed to 10 representative departures and the quays they use
// (Messages are complete). Tests that depend on the clock pin "now" to its
// ServerTime, the moment its relative DisplayTime values ("5 min") were computed.
const FIXTURE_RAW = fs.readFileSync(path.join(__dirname, "fixtures", "departures-bergen-busstasjon.json"), "utf8");
const FIXTURE = JSON.parse(FIXTURE_RAW);
const FIXTURE_NOW = Date.parse(FIXTURE.ServerTime);

// Feed a raw API response through getStopInfo, the way the node helper delivers it.
function parseResponse(ctx, raw) {
    let result;
    ctx.getStopInfo(ctx.config.stops, (err, items) => {
        result = { err, items };
    });
    ctx.socketNotificationReceived("getstop", { id: ctx._sent[ctx._sent.length - 1].p.id, response: raw });
    return result;
}

// ---- formatTime ---------------------------------------------------------

test("formatTime: past departure collapses to NOW (no negative minutes)", () => {
    const ctx = makeInstance(def);
    assert.strictEqual(ctx.formatTime(new Date(now - 2 * 60000).toISOString()), "NOW");
});

test("formatTime: humanizes minutes under the threshold", (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: FIXTURE_NOW });
    const ctx = makeInstance(def);
    assert.strictEqual(ctx.formatTime(new Date(FIXTURE_NOW + 5 * 60000).toISOString()), "5 MINUTES");
});

test("formatTime: rounds to the nearest minute like Skyss (1:59 -> 2, 0:20 -> now)", (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: FIXTURE_NOW });
    const ctx = makeInstance(def);
    const inMs = (ms) => new Date(FIXTURE_NOW + ms).toISOString();
    assert.strictEqual(ctx.formatTime(inMs(119000)), "2 MINUTES");
    assert.strictEqual(ctx.formatTime(inMs(80000)), "1MIN");
    assert.strictEqual(ctx.formatTime(inMs(20000)), "NOW");
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

test("getTableRow: accents the time only for a live realtime estimate", () => {
    const ctx = makeInstance(def);
    const rowFor = (journey) => {
        const tr = ctx.getTableRow(journey);
        return tr.childNodes.find((c) => (c.className || "").indexOf("time") === 0);
    };
    const base = { service: "Bus", lineName: "5", destinationName: "Town", platform: "", stopName: "" };
    const ts = new Date(now + 9 * 60000).toISOString();

    const rt = rowFor(Object.assign({}, base, { usedRealtime: true, time: { Timestamp: ts } }));
    assert.match(rt.className, /sanntid/);

    const sched = rowFor(Object.assign({}, base, { usedRealtime: false, time: { Timestamp: ts } }));
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
            time: { Status: "OnTime", Timestamp: new Date(now + 9 * 60000).toISOString() }
        }
    ];
    const table = ctx.getDom().childNodes.find((c) => c.tagName === "table");
    assert.ok(table, "wrapper contains a table");
    assert.strictEqual(table.className, "skyss small");
    const tbody = table.childNodes.find((c) => c.tagName === "tbody");
    assert.ok(tbody, "table has a tbody");
    assert.strictEqual(tbody.childNodes.length, 1);
});

// ---- real API response (fixture) ----------------------------------------

test("real response: platform comes from the quay's Stops entry", (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: FIXTURE_NOW });
    const ctx = makeInstance(def, { stops: [{ stopId: "1", stopGroupId: "2" }] });
    const { err, items } = parseResponse(ctx, FIXTURE_RAW);
    assert.strictEqual(err, null);
    assert.deepStrictEqual(
        items.map((i) => i.platform),
        ["U", "A", "B", "S", "S", "M", "R", "M", "S", "M"]
    );
});

test("real response: only live departures are realtime; timetable rows use AimedTime", (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: FIXTURE_NOW });
    const ctx = makeInstance(def, { stops: [{ stopId: "1", stopGroupId: "2" }] });
    const { items } = parseResponse(ctx, FIXTURE_RAW);
    // Every row has a DisplayTime, but only OnTime/Late rows carry live data.
    assert.deepStrictEqual(
        items.map((i) => i.usedRealtime),
        FIXTURE.PassingTimes.map((p) => p.Status !== "Schedule")
    );
    FIXTURE.PassingTimes.forEach((p, i) => {
        if (p.Status === "Schedule") assert.strictEqual(items[i].time.Timestamp, p.AimedTime);
    });
});

test("real response: useRealtime false uses the timetable everywhere", (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: FIXTURE_NOW });
    const ctx = makeInstance(def, { stops: [{ stopId: "1", stopGroupId: "2" }], useRealtime: false });
    const { items } = parseResponse(ctx, FIXTURE_RAW);
    assert.ok(items.every((i) => i.usedRealtime === false));
    assert.deepStrictEqual(
        items.map((i) => i.time.Timestamp),
        FIXTURE.PassingTimes.map((p) => p.AimedTime)
    );
});

test("real response: rendered minutes match Skyss' own DisplayTime", (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: FIXTURE_NOW });
    const ctx = makeInstance(def, { stops: [{ stopId: "1", stopGroupId: "2" }] });
    const { items } = parseResponse(ctx, FIXTURE_RAW);
    t.mock.timers.tick(50); // the DOM is rendered a moment after the response is parsed
    const shown = {};
    FIXTURE.PassingTimes.forEach((p, i) => {
        if (/^\d+ min$/.test(p.DisplayTime)) shown[p.DisplayTime] = ctx.formatTime(items[i].time.Timestamp);
    });
    assert.deepStrictEqual(shown, {
        "1 min": "1MIN",
        "5 min": "5 MINUTES",
        "8 min": "8 MINUTES",
        "10 min": "10 MINUTES"
    });
});

// Two departures from one live response (2026-10-29, ServerTime 13:37:06Z).
const EARLY_ROW = {
    RouteDirectionIdentifier: "SKY:Line:10~outbound",
    RoutePublicIdentifier: "10",
    StopIdentifier: "NSR:Quay:53069",
    TripDestination: "Wergeland",
    TripDestinationDescription: "",
    Status: "Early",
    AimedTime: "2026-10-29T13:38:00.000Z",
    DisplayTime: "1 min",
    PredictionInaccurate: false,
    ServiceMode: "Bus",
    DirectionName: "Til Wergeland",
    Passed: false
};
const CANCELLED_ROW = {
    RouteDirectionIdentifier: "SKY:Line:85~inbound",
    RoutePublicIdentifier: "85",
    StopIdentifier: "NSR:Quay:50151",
    TripDestination: "Servicelinjen",
    TripDestinationDescription: "",
    Status: "Cancelled",
    AimedTime: "2026-10-29T14:24:00.000Z",
    DisplayTime: "15:24",
    PredictionInaccurate: false,
    ServiceMode: "Bus",
    DirectionName: "Servicelinjen",
    Passed: false
};

test("real rows: a cancelled departure is left out; an early one is live", (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-29T13:37:06.005Z") });
    const ctx = makeInstance(def, { stops: [{ stopId: "1", stopGroupId: "2" }] });
    const body = JSON.stringify({ PassingTimes: [CANCELLED_ROW, EARLY_ROW], Stops: {}, Messages: [] });
    const { items } = parseResponse(ctx, body);
    assert.deepStrictEqual(
        items.map((i) => [i.lineName, i.usedRealtime]),
        [["10", true]]
    );
});

// ---- deviations ---------------------------------------------------------

const TUNNEL_MSG = "Sydnestunnelen stengd kl. 22.00-05.30. Sjå skyss.no/avvik.";
const LINE39_MSG = "Linje 39: Køyrer ikkje nedom Bekkjarvik.";

test("real response: deviations list the active messages", (t) => {
    // At capture time only the line 39 message is active: the tunnel closure
    // (valid 20:45Z-04:30Z) was already sent in the morning.
    t.mock.timers.enable({ apis: ["Date"], now: FIXTURE_NOW });
    const ctx = makeInstance(def, { stops: [{ stopId: "1", stopGroupId: "2" }] });
    parseResponse(ctx, FIXTURE_RAW);
    assert.deepStrictEqual(ctx.deviations, [LINE39_MSG]);
});

test("extractDeviations: honours validity periods and shows each text once", () => {
    const ctx = makeInstance(def);
    const at = (iso) => ctx.extractDeviations(FIXTURE.Messages, Date.parse(iso));
    // The tunnel closure is repeated for 7 routes but listed once.
    assert.deepStrictEqual(at("2026-10-29T21:00:00Z"), [TUNNEL_MSG, LINE39_MSG]);
    assert.deepStrictEqual(at("2026-10-30T05:00:00Z"), [LINE39_MSG]);
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

test("extractDeviations: tolerates odd entries and falls back to Messages", () => {
    const ctx = makeInstance(def);
    const nowMs = Date.parse("2026-10-29T12:00:00Z");
    const result = ctx.extractDeviations(
        [
            null,
            { Messages: "not an array" },
            { messagesWithValidityPeriod: [null, { message: 42 }] },
            { messagesWithValidityPeriod: [], Messages: ["  Only text  ", { nb: "an object" }] },
            { messagesWithValidityPeriod: [{ message: "No bounds" }] },
            { messagesWithValidityPeriod: [{ message: "Bad dates", start: "soon", end: "later" }] }
        ],
        nowMs
    );
    assert.deepStrictEqual(result, ["Only text", "No bounds", "Bad dates"]);
    assert.deepStrictEqual(ctx.extractDeviations(undefined, nowMs), []);
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

test("processSkyssDisplaytime: '5 min' -> ~5 minutes from now as a Date", () => {
    const ctx = makeInstance(def);
    const d = ctx.processSkyssDisplaytime("5 min");
    assert.ok(d instanceof Date && !isNaN(d.getTime()));
    const minutes = (d.getTime() - Date.now()) / 60000;
    assert.ok(minutes > 4.5 && minutes <= 5.05, "expected ~5 minutes, got " + minutes);
});

test("processSkyssDisplaytime: 'HH:mm' already past today rolls to tomorrow", () => {
    const ctx = makeInstance(def);
    const past = new Date(Date.now() - 60 * 60000); // an hour ago
    const rolled = ctx.processSkyssDisplaytime(pad(past.getHours()) + ":" + pad(past.getMinutes()));
    assert.ok(rolled instanceof Date && !isNaN(rolled.getTime()));
    assert.ok(rolled.getTime() > Date.now(), "a clock time already past today rolls to tomorrow");
    assert.strictEqual(rolled.getHours(), past.getHours());
});

test("processSkyssDisplaytime: unrecognised DisplayTime -> undefined", () => {
    const ctx = makeInstance(def);
    assert.strictEqual(ctx.processSkyssDisplaytime("soon"), undefined);
    assert.strictEqual(ctx.processSkyssDisplaytime(undefined), undefined);
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
