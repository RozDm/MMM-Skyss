"use strict";

/*
 * Shared stubs for testing the MagicMirror frontend module (MMM-Skyss.js)
 * outside of a real MagicMirror runtime. The module expects a handful of
 * globals (Module, moment, document, config, Log); we provide minimal fakes.
 */

function pad(n) {
    return ("0" + n).slice(-2);
}

// Minimal `moment` replacement covering what the module uses: construction from a
// Date/ISO string or a "HH:mm" time, plus add()/isBefore()/toISOString()/format().
function momentStub(arg, fmt) {
    let d;
    if (arg === undefined) d = new Date();
    else if (arg instanceof Date) d = arg;
    else if (typeof arg === "string" && fmt === "HH:mm") {
        const parts = arg.split(":");
        d = new Date();
        d.setHours(Number(parts[0]), Number(parts[1]), 0, 0);
    } else d = new Date(arg);

    function wrap(date) {
        return {
            _isMoment: true,
            _d: date,
            format(f) {
                const h = date.getHours(),
                    m = date.getMinutes();
                if (f === "HH:mm") return pad(h) + ":" + pad(m);
                if (f === "h:mm A") {
                    const ap = h >= 12 ? "PM" : "AM";
                    let hr = h % 12;
                    if (hr === 0) hr = 12;
                    return hr + ":" + pad(m) + " " + ap;
                }
                return date.toISOString();
            },
            add(n, unit) {
                const ms = (unit || "").indexOf("day") === 0 ? n * 86400000 : n * 60000;
                return wrap(new Date(date.getTime() + ms));
            },
            isBefore(other) {
                return date.getTime() < (other && other._d ? other._d.getTime() : Date.now());
            },
            toISOString() {
                return date.toISOString();
            }
        };
    }
    return wrap(d);
}
momentStub.isMoment = (x) => !!(x && x._isMoment);

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
    global.moment = momentStub;
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
    ctx.config = Object.assign(
        {
            stops: [],
            timeFormat: "HH:mm",
            maxItems: 5,
            walkingTime: 0,
            humanizeTimeTreshold: 15,
            serviceReloadInterval: 30000,
            maxReloadInterval: 300000,
            animationSpeed: 0,
            useRealtime: true,
            showDeviations: true,
            fade: true,
            fadePoint: 0.25,
            showHeader: false,
            showPlatform: false,
            showStopName: false,
            debug: false
        },
        configOverrides
    );
    ctx.name = "MMM-Skyss";
    ctx.identifier = "test_instance";
    ctx.journeys = [];
    ctx.deviations = [];
    ctx.requests = {};
    ctx.requestSeq = 0;
    ctx.instanceId = "inst-" + Math.random().toString(36).slice(2, 8);
    ctx.hasLoaded = false;
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

module.exports = { loadFrontend, makeInstance, momentStub };
