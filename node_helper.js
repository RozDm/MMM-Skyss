// @ts-check
const NodeHelper = require("node_helper");
const https = require("node:https");

// Reuse a single keep-alive agent so successive polls don't each pay a fresh TLS
// handshake. Guarded because the test harness injects an https stub without Agent.
const keepAliveAgent =
    typeof https.Agent === "function" ? new https.Agent({ keepAlive: true, maxSockets: 4 }) : undefined;

/** @type {Record<string, any>} */
const helper = {
    // Safety cap so a misbehaving endpoint can't exhaust memory. A whole station
    // (a StopPlace-only stop) returns up to ~0.5 MB, so this leaves room for several.
    maxResponseBytes: 5 * 1024 * 1024,

    start: function () {
        console.log("Starting module: " + this.name);
    },

    /**
     * Log an error body from the API to the MagicMirror log. Skyss answers a bad
     * request with HTTP 200 and e.g. {"resultCode":"PERMANENT_ERROR",
     * "errorMessage":"Holdeplassen finnes ikke"} for an unknown stop. Error bodies
     * are tiny, so a (large) departures response is not parsed here.
     * @param {string} data the response text
     */
    logApiError: function (data) {
        if (data.length > 2048 || data.indexOf('"resultCode"') === -1) return;
        try {
            var body = JSON.parse(data);
            if (!body.resultCode) return;
            console.error(
                "[MMM-Skyss] Skyss API error: " +
                    [body.resultCode, body.errorCode, body.errorMessage].filter(Boolean).join(" ") +
                    (body.resultCode === "PERMANENT_ERROR" ? " (check stopId / stopGroupId)" : "")
            );
        } catch {
            // Not JSON after all: the frontend reports it as a parse error.
        }
    },

    /**
     * Handle a "getstop" request from the frontend: POST the body to the Skyss v3
     * API and return the response (or error) tagged with the same request id.
     * @param {string} notification
     * @param {{ id?: string, body?: any, debug?: boolean }} payload
     */
    socketNotificationReceived: function (notification, payload) {
        var self = this;
        if (notification !== "getstop") return;

        var debug = payload && payload.debug;
        var id = payload && payload.id; // echoed back so the right instance/request gets the response
        const postData = JSON.stringify(payload.body);

        if (debug) {
            console.log("[MMM-Skyss] Making API request to Skyss v3");
            console.log("[MMM-Skyss] Request body:", postData);
        }

        const options = {
            hostname: "skyss.giantleap.no",
            path: "/v3/departures",
            method: "POST",
            timeout: 15000,
            agent: keepAliveAgent,
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(postData)
            }
        };

        var req = https.request(options, (res) => {
            if (debug) console.log("[MMM-Skyss] API response status:", res.statusCode);

            // Treat non-2xx HTTP responses as errors so polling backs off instead of
            // trying to parse an error page/body.
            var status = res.statusCode || 0;
            if (status < 200 || status >= 300) {
                res.resume(); // drain so the socket can be freed
                console.error("[MMM-Skyss] Skyss API answered HTTP " + status);
                self.sendSocketNotification("getstop", { id: id, err: "HTTP " + status });
                return;
            }

            res.setEncoding("utf8");
            var chunks = [];
            var size = 0;
            var aborted = false;
            res.on("data", (chunk) => {
                if (aborted) return;
                size += Buffer.byteLength(chunk);
                if (size > self.maxResponseBytes) {
                    aborted = true;
                    console.error("[MMM-Skyss] API response exceeded size limit, aborting");
                    req.destroy(new Error("Response too large"));
                    return;
                }
                // Collect chunks and join once at the end instead of repeatedly
                // concatenating strings (which is quadratic on large responses).
                chunks.push(chunk);
            });

            res.on("end", () => {
                if (aborted) return;
                var data = chunks.join("");
                if (debug) {
                    console.log("[MMM-Skyss] API response received, data length:", data.length);
                    console.log("[MMM-Skyss] Response preview:", data.substring(0, 200) + "...");
                }
                self.logApiError(data);
                self.sendSocketNotification("getstop", { id: id, response: data });
            });
        });

        req.on("error", (e) => {
            console.error("[MMM-Skyss] API request error:", e.message);
            self.sendSocketNotification("getstop", { id: id, err: e.message });
        });

        req.on("timeout", () => {
            console.error("[MMM-Skyss] API request timed out");
            req.destroy(new Error("Request timed out"));
        });

        req.write(postData);
        req.end();
    }
};

module.exports = NodeHelper.create(helper);
