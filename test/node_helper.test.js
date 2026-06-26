"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const Module = require("node:module");
const { EventEmitter } = require("node:events");

/*
 * node_helper.js requires "node_helper" (MagicMirror core) and "node:https".
 * Neither is available here, so we intercept require() to inject fakes: the
 * NodeHelper stub just returns the definition object, and the https stub lets
 * the test drive a simulated response.
 */

let lastReq = null;
function fakeHttps() {
    return {
        request(options, responseHandler) {
            const req = new EventEmitter();
            req.destroyed = false;
            req.write = () => {};
            req.end = () => {};
            req.destroy = (e) => {
                req.destroyed = true;
                if (e) req.emit("error", e);
            };
            req._respond = responseHandler; // call to simulate the response arriving
            req.options = options;
            lastReq = req;
            return req;
        }
    };
}

const origLoad = Module._load;
Module._load = function (request) {
    if (request === "node_helper") return { create: (def) => def };
    if (request === "https" || request === "node:https") return fakeHttps();
    return origLoad.apply(this, arguments);
};
const helper = require("../node_helper.js"); // captures the fake https at load time
Module._load = origLoad;

function makeHelperCtx() {
    const sent = [];
    const ctx = Object.assign(Object.create(helper), {
        name: "MMM-Skyss",
        sendSocketNotification: (n, p) => sent.push({ n, p })
    });
    ctx._sent = sent;
    return ctx;
}

function fakeResponse() {
    const res = new EventEmitter();
    res.setEncoding = () => {};
    return res;
}

test("node_helper: echoes the request id on success", () => {
    const ctx = makeHelperCtx();
    ctx.socketNotificationReceived("getstop", { id: "req-1", body: { stopGroups: [] }, debug: false });
    const res = fakeResponse();
    lastReq._respond(res);
    res.emit("data", '{"ok":true}');
    res.emit("end");
    assert.deepStrictEqual(ctx._sent, [{ n: "getstop", p: { id: "req-1", response: '{"ok":true}' } }]);
});

test("node_helper: echoes the request id on a request error", () => {
    const ctx = makeHelperCtx();
    ctx.socketNotificationReceived("getstop", { id: "req-2", body: {}, debug: false });
    lastReq.emit("error", new Error("network down"));
    assert.deepStrictEqual(ctx._sent, [{ n: "getstop", p: { id: "req-2", err: "network down" } }]);
});

test("node_helper: aborts and reports oversized responses (memory cap)", () => {
    const ctx = makeHelperCtx();
    ctx.socketNotificationReceived("getstop", { id: "req-3", body: {}, debug: false });
    const res = fakeResponse();
    lastReq._respond(res);

    res.emit("data", "x".repeat(2 * 1024 * 1024 + 10)); // > 2 MB cap
    assert.strictEqual(lastReq.destroyed, true, "request destroyed on oversize");
    assert.deepStrictEqual(ctx._sent, [{ n: "getstop", p: { id: "req-3", err: "Response too large" } }]);

    // A late 'end' after aborting must not emit a second notification.
    res.emit("end");
    assert.strictEqual(ctx._sent.length, 1);
});

test("node_helper: ignores notifications other than getstop", () => {
    const ctx = makeHelperCtx();
    ctx.socketNotificationReceived("somethingelse", { id: "x" });
    assert.strictEqual(ctx._sent.length, 0);
});
