const NodeHelper = require("node_helper");
const https = require("node:https");

module.exports = NodeHelper.create({
    start: function () {
        console.log("Starting module: " + this.name);
    },

    socketNotificationReceived: function (notification, payload) {
        var self = this;
        if (notification !== "getstop") return;

        var debug = payload && payload.debug;
        var id = payload && payload.id;   // echoed back so the right instance/request gets the response
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
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(postData)
            }
        };

        // Safety cap so a misbehaving/compromised endpoint can't exhaust memory
        const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB

        var req = https.request(options, (res) => {
            if (debug) console.log("[MMM-Skyss] API response status:", res.statusCode);

            res.setEncoding("utf8");
            var data = "";
            var size = 0;
            var aborted = false;
            res.on("data", (chunk) => {
                if (aborted) return;
                size += Buffer.byteLength(chunk);
                if (size > MAX_RESPONSE_BYTES) {
                    aborted = true;
                    console.error("[MMM-Skyss] API response exceeded size limit, aborting");
                    req.destroy(new Error("Response too large"));
                    return;
                }
                data = data.concat(chunk);
            });

            res.on("end", () => {
                if (aborted) return;
                if (debug) {
                    console.log("[MMM-Skyss] API response received, data length:", data.length);
                    console.log("[MMM-Skyss] Response preview:", data.substring(0, 200) + "...");
                }
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
});
