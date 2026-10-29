"use strict";

/*
 * Shared stubs for testing the MagicMirror frontend module (MMM-Skyss.js)
 * outside of a real MagicMirror runtime. The module expects a handful of
 * globals (Module, document, config, Log); we provide minimal fakes. The module
 * formats time with the native Date, so no `moment` stub is needed.
 */

// Tiny DOM stub: elements just record what the module sets on them.
function makeElement(tag) {
    return {
        tagName: tag,
        className: "",
        innerHTML: "",
        style: {},
        childNodes: [],
        appendChild(c) {
            this.childNodes.push(c);
            return c;
        }
    };
}
const documentStub = {
    createElement: (tag) => makeElement(tag),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t) })
};

// Load MMM-Skyss.js with the globals in place and return its module definition.
function loadFrontend() {
    global.config = { timeFormat: 24 };
    global.document = documentStub;
    global.Log = { log() {} };
    let def = null;
    global.Module = {
        register: (name, d) => {
            def = d;
        }
    };
    delete require.cache[require.resolve("../MMM-Skyss.js")];
    require("../MMM-Skyss.js");
    return def;
}

// Build a fresh instance (prototype = def) with sensible config + spies.
// Timers and DOM updates are stubbed so tests stay synchronous.
function makeInstance(def, configOverrides) {
    const ctx = Object.create(def);
    // The module's own defaults, with the 24h format start() derives from config.
    ctx.config = Object.assign({}, def.defaults, { timeFormat: "HH:mm" }, configOverrides);
    ctx.name = "MMM-Skyss";
    ctx.identifier = "test_instance";
    // The state start() sets up.
    ctx.journeys = [];
    ctx.deviations = [];
    ctx.requests = {};
    ctx.requestSeq = 0;
    ctx.instanceId = "inst-" + Math.random().toString(36).slice(2, 8);
    ctx.hasLoaded = false;
    ctx.lastSuccess = 0;
    ctx.error = null;
    ctx.unknownStops = false;
    ctx.warnedQuays = {};
    ctx.consecutiveErrors = 0;
    ctx.translate = (k) => k;
    ctx.updateDom = () => {
        ctx._updated = (ctx._updated || 0) + 1;
    };
    ctx.sendSocketNotification = (n, p) => {
        (ctx._sent = ctx._sent || []).push({ n, p });
    };
    ctx.scheduleNextPoll = (d) => {
        ctx._scheduled = d;
    }; // no real timers in tests
    return ctx;
}

module.exports = { loadFrontend, makeInstance };
