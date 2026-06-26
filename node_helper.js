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

        var req = https.request(options, (res) => {
            if (debug) console.log("[MMM-Skyss] API response status:", res.statusCode);

            res.setEncoding("utf8");
            var data = "";
            res.on("data", (chunk) => {
                data = data.concat(chunk);
            });

            res.on("end", () => {
                if (debug) {
                    console.log("[MMM-Skyss] API response received, data length:", data.length);
                    console.log("[MMM-Skyss] Response preview:", data.substring(0, 200) + "...");
                }
                self.sendSocketNotification("getstop", { response: data });
            });
        });

        req.on("error", (e) => {
            console.error("[MMM-Skyss] API request error:", e.message);
            self.sendSocketNotification("getstop", { err: e.message });
        });

        req.on("timeout", () => {
            console.error("[MMM-Skyss] API request timed out");
            req.destroy(new Error("Request timed out"));
        });

        req.write(postData);
        req.end();
    }
});
