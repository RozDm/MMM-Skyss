// @ts-check
/* Magic Mirror
 * Module: MMM-Skyss
 *
 * Based on MMM-Ruter by Cato Antonsen (https://github.com/CatoAntonsen)
 * MIT Licensed.
 */

/**
 * MagicMirror module definition. Typed loosely as a string-keyed record because
 * MagicMirror injects many members at runtime (translate, sendSocketNotification,
 * updateDom, identifier, name, ...) that are not declared on this object.
 * @type {Record<string, any>}
 */
const Skyss = {
    // Default module config.
    defaults: {
        stops: [], // Array of stops to display (see README). Empty = nothing to show
        timeFormat: null, // This is set automatically based on global config
        showHeader: false, // Set this to true to show header above the journeys (default is false)
        showPlatform: false, // Set this to true to get the names of the platforms (default is false)
        showStopName: false, // Show the stop name (fetched automatically from the Skyss API)
        maxItems: 5, // Number of journeys to display (default is 5)
        walkingTime: 0, // Minutes needed to reach the stop; departures leaving sooner are hidden (0 = show all)
        humanizeTimeTreshold: 15, // If time to next journey is below this value, it will be displayed as "x minutes" instead of time (default is 15 minutes)
        serviceReloadInterval: 30000, // Refresh rate in MS for how often we call Skyss' web service. NB! Don't set it too low! (default is 30 seconds)
        maxReloadInterval: 300000, // Upper bound for the exponential backoff applied after API errors (default is 5 minutes)
        animationSpeed: 0, // How fast the animation changes when updating mirror (default is 0 second)
        fade: true, // Set this to true to fade list from light to dark. (default is true)
        fadePoint: 0.25, // Start on 1/4th of the list.
        useRealtime: true, // Whether to use realtime data from Skyss
        showDeviations: true, // Show Skyss service messages / deviations when present (default true)
        debug: false // Enable verbose debug logging
    },

    getStyles: function () {
        return ["skyss.css"];
    },

    getScripts: function () {
        return [];
    },

    getTranslations: function () {
        return {
            en: "translations/en.json",
            nb: "translations/nb.json",
            nn: "translations/nn.json"
        };
    },

    start: function () {
        console.log(this.translate("STARTINGMODULE") + ": " + this.name); // always shown
        if (this.config.debug) console.log("[MMM-Skyss][DEBUG] Configuration:", this.config);

        this.journeys = [];
        this.deviations = []; // Service messages / deviations from the last successful response
        this.hasLoaded = false; // Have we ever received a successful response?
        this.consecutiveErrors = 0; // Drives the exponential backoff after errors

        // Per-instance request map keyed by a unique id. Every MMM-Skyss instance
        // receives the broadcast "getstop" notification, so each request is tagged
        // with an id and an instance only consumes responses for ids it issued.
        this.requests = {};
        this.requestSeq = 0;
        this.instanceId = (this.identifier || "skyss") + "-" + Math.random().toString(36).slice(2, 10);

        // Set locale and time format based on global config
        if (config.timeFormat === 24) {
            this.config.timeFormat = "HH:mm";
        } else {
            this.config.timeFormat = "h:mm A";
        }

        // Back-compat: accept the correctly spelled `humanizeTimeThreshold` as an
        // alias for the historical (misspelled) `humanizeTimeTreshold` option.
        if (this.config.humanizeTimeThreshold !== undefined) {
            this.config.humanizeTimeTreshold = this.config.humanizeTimeThreshold;
        }

        if (this.config.debug) console.log("[MMM-Skyss][DEBUG] Time format set to:", this.config.timeFormat);

        // Poll immediately, then self-schedule each subsequent poll so we can back
        // off when the API is failing instead of hammering it on a fixed interval.
        this.scheduleNextPoll(0);
    },

    getDom: function () {
        var wrapper = document.createElement("div");

        // Service messages / deviations (when enabled and present), shown above the
        // departures so a disruption is visible even when nothing is running.
        if (this.config.showDeviations && this.deviations && this.deviations.length > 0) {
            var devBox = document.createElement("div");
            devBox.className = "skyss-deviations xsmall";
            for (var d = 0; d < this.deviations.length; d++) {
                var devLine = document.createElement("div");
                devLine.className = "skyss-deviation";
                devLine.appendChild(document.createTextNode(this.deviations[d]));
                devBox.appendChild(devLine);
            }
            wrapper.appendChild(devBox);
        }

        if (this.journeys.length > 0) {
            var table = document.createElement("table");
            table.className = "skyss small";

            if (this.config.showHeader) {
                table.appendChild(this.getTableHeaderRow());
            }

            var tbody = document.createElement("tbody");

            for (var i = 0; i < this.journeys.length; i++) {
                var journey = this.journeys[i];
                var tr = this.getTableRow(journey);

                // Create fade effect. <-- stolen from default "calendar" module
                if (this.config.fade && this.config.fadePoint < 1) {
                    if (this.config.fadePoint < 0) {
                        this.config.fadePoint = 0;
                    }
                    var startingPoint = this.journeys.length * this.config.fadePoint;
                    var steps = this.journeys.length - startingPoint;
                    if (i >= startingPoint) {
                        var currentStep = i - startingPoint;
                        tr.style.opacity = 1 - (1 / steps) * currentStep;
                    }
                }

                tbody.appendChild(tr);
            }

            table.appendChild(tbody);
            wrapper.appendChild(table);
        } else {
            var message = document.createElement("div");
            // "Loading" until the first successful poll, then "no departures".
            message.innerHTML = this.translate(this.hasLoaded ? "NODEPARTURES" : "LOADING");
            message.className = "small dimmed";
            wrapper.appendChild(message);
        }

        return wrapper;
    },

    /**
     * Schedule the next poll, replacing any pending one.
     * @param {number} delay milliseconds until the next poll
     */
    scheduleNextPoll: function (delay) {
        var self = this;
        clearTimeout(this.pollTimer);
        this.pollTimer = setTimeout(function () {
            self.poll();
        }, delay);
    },

    /**
     * Next poll delay: the base interval, or exponential backoff (capped at
     * `maxReloadInterval`) while consecutive errors persist.
     * @returns {number} milliseconds
     */
    nextBackoff: function () {
        return Math.min(
            this.config.serviceReloadInterval * Math.pow(2, this.consecutiveErrors),
            this.config.maxReloadInterval
        );
    },

    /** Run one poll cycle, then schedule the next (with exponential backoff on error). */
    poll: function () {
        var self = this;
        if (this.config.debug) console.log("[MMM-Skyss][DEBUG] Starting poll for departure data");

        // A lost response can never stall the self-scheduling chain: every request
        // has a frontend timeout (see HttpClient) that surfaces an error, so this
        // callback always runs and always schedules the next poll.
        this.getStopInfo(this.config.stops, function (err, result) {
            if (err) {
                // Keep the last good data on screen and back off the next poll
                // (exponential, capped at maxReloadInterval).
                self.consecutiveErrors++;
                if (self.config.debug)
                    console.log("[MMM-Skyss][DEBUG] Poll error (", err, "); next poll in", self.nextBackoff(), "ms");
                self.scheduleNextPoll(self.nextBackoff());
                return;
            }

            self.consecutiveErrors = 0;
            self.hasLoaded = true;

            var allJourneys = (result || []).slice();
            allJourneys.sort(function (a, b) {
                return new Date(a.time.Timestamp).getTime() - new Date(b.time.Timestamp).getTime();
            });

            // Hide departures leaving too soon to walk to (walkingTime minutes).
            if (self.config.walkingTime > 0) {
                var nowMs = Date.now();
                allJourneys = allJourneys.filter(function (j) {
                    return (new Date(j.time.Timestamp).getTime() - nowMs) / 60000 >= self.config.walkingTime;
                });
            }

            self.journeys = allJourneys.slice(0, self.config.maxItems);

            if (self.config.debug) console.log("[MMM-Skyss][DEBUG] Displaying", self.journeys.length, "journeys");

            self.updateDom(self.config.animationSpeed);
            self.scheduleNextPoll(self.config.serviceReloadInterval);
        });
    },

    /**
     * Fetch and normalise departures for the configured stops, then hand the
     * resulting view-model array to the callback.
     * @param {Array<Object>} stopItems the `stops` config array
     * @param {(err: any, items: Array<Object>) => void} callback
     */
    getStopInfo: function (stopItems, callback) {
        var self = this;

        var HttpClient = function () {
            this.get = function (requestBody, requestCallback) {
                var id = self.instanceId + ":" + ++self.requestSeq;
                // Safety net: if the node helper's response is ever lost, drop the
                // pending entry (so the request map can't leak) and surface an error
                // so polling reschedules. Must exceed the helper's own 15s timeout.
                // The timer is cleared in socketNotificationReceived once a response
                // arrives, and unref()'d so a pending safety-net timer never by
                // itself keeps the runtime alive (unref is a no-op in the browser,
                // where setTimeout returns a number).
                var timer = setTimeout(function () {
                    if (!self.requests[id]) return;
                    delete self.requests[id];
                    if (self.config.debug) console.log("[MMM-Skyss][DEBUG] No response for", id, "- timing out");
                    requestCallback("request timed out", null);
                }, 30000);
                if (timer && typeof timer.unref === "function") timer.unref();
                self.requests[id] = { callback: requestCallback, timer: timer };
                self.sendSocketNotification("getstop", { id: id, body: requestBody, debug: self.config.debug });
            };
        };

        //DisplayTime contains realtime-information. Formatted as "x min"(remaining time), or "HH:mm"
        /**
         * Parse Skyss' realtime "DisplayTime" ("x min" or "HH:mm") into a moment.
         * @param {string} displayTime
         * @returns {any} a moment instance, or undefined if unrecognised
         */
        var processSkyssDisplaytime = function (displayTime) {
            var realTime;
            var regexInMinutes = new RegExp("([0-9]+) min");
            var regexLocalTimeStamp = new RegExp("[0-9]{2}:[0-9]{2}");

            //Time format is "x min"
            if (regexInMinutes.test(displayTime)) {
                var inMinutes = parseInt(displayTime.match(regexInMinutes)[1], 10);

                // "x min" is the realtime estimate of whole minutes until departure.
                realTime = moment().add(inMinutes, "minutes");

                //Time format is "HH:mm".
            } else if (regexLocalTimeStamp.test(displayTime)) {
                realTime = moment(displayTime, "HH:mm");

                //Time is next day
                if (realTime.isBefore(moment())) {
                    realTime.add(1, "day");
                }
            }
            return realTime;
        };

        /**
         * Build the v3 `/departures` request body by grouping configured stops by
         * stopGroupId and normalising ids to the `NSR:` form.
         * @returns {{ stopGroups: Array<{id: string, stops: Array<{id: string}>}> }}
         */
        var buildRequestBody = function () {
            // Helper function to add NSR prefix if not present
            const normalizeId = function (id, type) {
                if (!id) return undefined;
                if (id.startsWith && id.startsWith("NSR:")) return id;
                return "NSR:" + type + ":" + id;
            };

            const stopGroupsMap = {}; // key = groupId

            // Guard against a missing/invalid `stops` config (undefined, null, non-array)
            const items = Array.isArray(stopItems) ? stopItems : [];

            for (let i = 0; i < items.length; i++) {
                const item = items[i];

                // Support alternative grouped config form: { stopGroupId: "32383", stopIds: ["55869", "55870"] }
                if (Array.isArray(item.stopIds) && item.stopGroupId) {
                    const groupId = normalizeId(item.stopGroupId, "StopPlace");
                    if (!groupId) {
                        console.warn("[MMM-Skyss] Skipping grouped entry without valid stopGroupId", item);
                        continue;
                    }
                    if (!stopGroupsMap[groupId]) {
                        stopGroupsMap[groupId] = { id: groupId, stops: [] };
                    }
                    item.stopIds.forEach((rawStopId) => {
                        const stopId = normalizeId(rawStopId, "Quay");
                        if (stopId) {
                            stopGroupsMap[groupId].stops.push({ id: stopId });
                        } else {
                            console.warn("[MMM-Skyss] Skipping invalid stopId in grouped entry", rawStopId);
                        }
                    });
                    continue; // proceed to next config item
                }

                // Original form: { stopId: "55863", stopGroupId: "32379" }
                const rawGroupId = item.stopGroupId;
                const rawStopId = item.stopId;

                if (!rawGroupId) {
                    console.warn("[MMM-Skyss] Missing stopGroupId for stop entry. This stop will be skipped:", item);
                    continue;
                }
                if (!rawStopId) {
                    console.warn("[MMM-Skyss] Missing stopId for stop entry. This stop will be skipped:", item);
                    continue;
                }

                const groupId = normalizeId(rawGroupId, "StopPlace");
                const stopId = normalizeId(rawStopId, "Quay");

                if (!stopGroupsMap[groupId]) {
                    stopGroupsMap[groupId] = { id: groupId, stops: [] };
                }
                stopGroupsMap[groupId].stops.push({ id: stopId });
            }

            const stopGroupsArray = Object.values(stopGroupsMap);

            // Additional safeguard: remove groups without id or with no stops
            const filtered = stopGroupsArray.filter((g) => g.id && g.stops.length > 0);

            if (filtered.length === 0) {
                if (self.config.debug)
                    console.log(
                        "[MMM-Skyss][DEBUG] No valid stop groups constructed from configuration. Check your stops config."
                    );
            } else if (self.config.debug) {
                console.log("[MMM-Skyss][DEBUG] Constructed request body with", filtered.length, "group(s).");
                filtered.forEach((g) =>
                    console.log("[MMM-Skyss][DEBUG] Group", g.id, "stops:", g.stops.map((s) => s.id).join(", "))
                );
            }

            return { stopGroups: filtered };
        };

        var requestBody = buildRequestBody();
        if (!requestBody.stopGroups || requestBody.stopGroups.length === 0) {
            if (self.config.debug) console.log("[MMM-Skyss][DEBUG] No valid stops configured; skipping API call.");
            callback(null, []);
            return;
        }

        var client = new HttpClient();

        client.get(requestBody, function (err, stopResponse) {
            if (err) {
                if (self.config.debug) console.log("[MMM-Skyss][DEBUG] Request failed:", err);
                callback(err, []);
                return;
            }

            if (self.config.debug) console.log("[MMM-Skyss][DEBUG] Parsing API response");

            var departure;
            try {
                departure = JSON.parse(stopResponse);
            } catch (e) {
                if (self.config.debug) console.log("[MMM-Skyss][DEBUG] Failed to parse API response:", e.message);
                callback("parse error", []);
                return;
            }

            if (!departure || !Array.isArray(departure.PassingTimes) || !departure.Stops) {
                if (self.config.debug) console.log("[MMM-Skyss][DEBUG] Unexpected API response shape, skipping update");
                callback("unexpected response shape", []);
                return;
            }

            var times = departure.PassingTimes;

            if (self.config.debug) {
                console.log("[MMM-Skyss][DEBUG] Received", times.length, "passing times");
                console.log("[MMM-Skyss][DEBUG] Available stops:", Object.keys(departure.Stops));
            }

            var allStopItems = [];

            for (var j = 0; j < times.length; j++) {
                var journey = times[j];
                var stop = departure.Stops[journey.StopIdentifier] || {};
                var timestamp;

                var realtimeStamp = processSkyssDisplaytime(journey.DisplayTime);
                if (self.config.useRealtime && moment.isMoment(realtimeStamp)) {
                    timestamp = realtimeStamp.toISOString();
                    if (self.config.debug)
                        console.log(
                            "[MMM-Skyss][DEBUG] Using realtime for",
                            journey.RoutePublicIdentifier,
                            ":",
                            journey.DisplayTime,
                            "->",
                            timestamp
                        );
                } else {
                    timestamp = journey.AimedTime;
                    if (self.config.debug)
                        console.log(
                            "[MMM-Skyss][DEBUG] Using scheduled time for",
                            journey.RoutePublicIdentifier,
                            ":",
                            timestamp
                        );
                }

                allStopItems.push({
                    stopId: journey.StopIdentifier,
                    stopName: stop.Description || "",
                    lineName: journey.RoutePublicIdentifier,
                    destinationName: journey.TripDestination,
                    service: journey.ServiceMode,
                    time: {
                        Timestamp: timestamp,
                        Status: journey.Status
                    },
                    platform: journey.Platform || ""
                });
            }

            // Service messages / deviations live in the top-level "Messages" array.
            // The message object shape is undocumented, so pull text from the common
            // field names defensively; the raw array is logged under debug so a real
            // disruption sample can refine this.
            if (self.config.debug) console.log("[MMM-Skyss][DEBUG] Messages:", JSON.stringify(departure.Messages));
            self.deviations = (Array.isArray(departure.Messages) ? departure.Messages : [])
                .map(function (m) {
                    if (typeof m === "string") return m.trim();
                    if (m && typeof m === "object") {
                        // The message shape is undocumented and a field may itself be a
                        // localised object, so only accept a non-empty *string* field
                        // (otherwise we would render "[object Object]").
                        var fields = [m.Text, m.Message, m.Title, m.Description, m.Body, m.Value];
                        for (var i = 0; i < fields.length; i++) {
                            if (typeof fields[i] === "string" && fields[i].trim()) return fields[i].trim();
                        }
                    }
                    return "";
                })
                .filter(function (s) {
                    return s.length > 0;
                });

            if (self.config.debug) console.log("[MMM-Skyss][DEBUG] Processed", allStopItems.length, "stop items");
            callback(null, allStopItems);
        });
    },

    getTableHeaderRow: function () {
        var thLine = document.createElement("th");
        thLine.appendChild(document.createTextNode(this.translate("LINEHEADER")));

        var thDestination = document.createElement("th");
        thDestination.appendChild(document.createTextNode(this.translate("DESTINATIONHEADER")));

        var thPlatform = document.createElement("th");
        thPlatform.appendChild(document.createTextNode(this.translate("PLATFORMHEADER")));

        var thStopName = document.createElement("th");
        thStopName.appendChild(document.createTextNode(this.translate("STOPNAMEHEADER")));

        var thTime = document.createElement("th");
        thTime.className = "time";
        thTime.appendChild(document.createTextNode(this.translate("TIMEHEADER")));

        var tr = document.createElement("tr");
        tr.appendChild(document.createElement("th"));
        tr.appendChild(thLine);
        tr.appendChild(thDestination);
        if (this.config.showStopName) {
            tr.appendChild(thStopName);
        }
        if (this.config.showPlatform) {
            tr.appendChild(thPlatform);
        }
        tr.appendChild(thTime);

        var thead = document.createElement("thead");
        thead.className = "xsmall dimmed";
        thead.appendChild(tr);

        return thead;
    },

    getTableRow: function (journey) {
        var tdIcon = document.createElement("td");
        var imageFA;
        switch (journey.service) {
            case "Bus":
            case "Express":
            case "Airport bus":
                imageFA = "bus";
                break;
            case "Light rail":
                imageFA = "subway";
                break;
            case "Ferry":
            case "Boat":
                imageFA = "ship";
                break;
            case "Train":
                imageFA = "train";
                break;
            default:
                imageFA = "rocket";
                break;
        }
        tdIcon.className = "fa fa-" + imageFA;

        var tdLine = document.createElement("td");
        tdLine.className = "line";
        var txtLine = document.createTextNode(journey.lineName);
        tdLine.appendChild(txtLine);

        var tdDestination = document.createElement("td");
        tdDestination.className = "destination bright";
        tdDestination.appendChild(document.createTextNode(journey.destinationName));

        if (this.config.showPlatform) {
            var tdPlatform = document.createElement("td");
            tdPlatform.className = "platform";
            tdPlatform.appendChild(document.createTextNode(journey.platform));
        }

        if (this.config.showStopName) {
            var tdStopName = document.createElement("td");
            tdStopName.className = "light";
            tdStopName.appendChild(document.createTextNode(journey.stopName));
        }

        var tdTime = document.createElement("td");
        if (journey.time.Status !== "Schedule") {
            tdTime.className = "time light sanntid";
        } else {
            tdTime.className = "time light";
        }
        tdTime.appendChild(document.createTextNode(this.formatTime(journey.time.Timestamp)));

        var tr = document.createElement("tr");
        tr.appendChild(tdIcon);
        tr.appendChild(tdLine);
        tr.appendChild(tdDestination);
        if (this.config.showStopName) {
            tr.appendChild(tdStopName);
        }
        if (this.config.showPlatform) {
            tr.appendChild(tdPlatform);
        }
        tr.appendChild(tdTime);

        return tr;
    },

    /**
     * Format a departure time for display: "Now" / "1 min" / "x minutes" when the
     * departure is near, otherwise the clock time in the configured 12/24h format.
     * @param {string|number|Date} t departure timestamp
     * @returns {string}
     */
    formatTime: function (t) {
        var now = new Date();
        var tti = new Date(t);
        var diff = tti.getTime() - now.getTime();
        var min = Math.floor(diff / 60000);

        if (this.config.humanizeTimeTreshold !== 0) {
            if (min <= 0) {
                return this.translate("NOW");
            } else if (min === 1) {
                return this.translate("1MIN");
            } else if (min < this.config.humanizeTimeTreshold) {
                return min + " " + this.translate("MINUTES");
            }
        }
        // Honour the 12/24h format derived from the global config in start()
        return moment(tti).format(this.config.timeFormat);
    },

    socketNotificationReceived: function (notification, payload) {
        var self = this;
        if (this.config.debug) Log.log(this.name + " received a socket notification: " + notification);
        if (notification !== "getstop") return;
        if (!payload || !payload.id) return;

        // The notification is broadcast to every MMM-Skyss instance, so only act on
        // responses for a request id THIS instance issued.
        var request = self.requests[payload.id];
        if (!request) return;
        delete self.requests[payload.id];
        clearTimeout(request.timer); // response arrived; cancel the safety-net timeout

        if (payload.err) {
            if (this.config.debug) console.log("[MMM-Skyss][DEBUG] Socket notification error:", payload.err);
            request.callback(payload.err, null);
        } else {
            if (this.config.debug) console.log("[MMM-Skyss][DEBUG] Socket notification received successfully");
            request.callback(null, payload.response);
        }
    }
};

Module.register("MMM-Skyss", Skyss);
