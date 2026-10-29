// @ts-check
/* Magic Mirror
 * Module: MMM-Skyss
 *
 * Based on MMM-Ruter by Cato Antonsen (https://github.com/CatoAntonsen)
 * MIT Licensed.
 */

// Skyss "DisplayTime" is either "x min" (realtime minutes to departure) or a
// "HH:mm" clock time. Compile the matchers once instead of per departure.
const SKYSS_MINUTES_RE = /([0-9]+) min/;
const SKYSS_CLOCK_RE = /([0-9]{2}):([0-9]{2})/;

// Departure statuses that carry live tracking. The API also sends "Schedule"
// (timetable only) and "Cancelled"; an unknown status is treated as timetable.
const SKYSS_LIVE_STATUSES = ["OnTime", "Early", "Late"];

// How often the board is redrawn between polls, so countdowns stay current and
// departed rows drop off even while the API cannot be reached.
const REFRESH_INTERVAL = 15000;

// Departures kept from a response, earliest first. A big station returns over a
// thousand for the rest of the day, and the board shows only `maxItems`.
const MAX_KEPT_DEPARTURES = 200;

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
        showCancelled: true, // Show cancelled departures, marked as cancelled (false hides them)
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

        this.journeys = []; // Departures from the last successful response, earliest first
        this.deviations = []; // Service messages / deviations from the last successful response
        this.hasLoaded = false; // Have we ever received a successful response?
        this.lastSuccess = 0; // When the last successful response arrived (ms)
        this.error = null; // { type: "nostops" | "stop" | "fetch", detail } while updates fail
        this.unknownStops = false; // Skyss knows none of the configured quays
        this.warnedQuays = {}; // Quays already reported as unknown (each is warned about once)
        this.consecutiveErrors = 0; // Drives the exponential backoff after errors

        // Per-instance request map keyed by a unique id. Every MMM-Skyss instance
        // receives the broadcast "getstop" notification, so each request is tagged
        // with an id and an instance only consumes responses for ids it issued.
        this.requests = {};
        this.requestSeq = 0;
        this.instanceId = (this.identifier || "skyss") + "-" + Math.random().toString(36).slice(2, 10);

        // The configured stops never change at runtime, so the request body is
        // built once (lazily, on the first poll) and cached here.
        this._requestBody = undefined;

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

        this.startRefreshTimer();
        // Poll immediately, then self-schedule each subsequent poll so we can back
        // off when the API is failing instead of hammering it on a fixed interval.
        this.scheduleNextPoll(0);
    },

    // MagicMirror calls suspend() when the module is hidden (e.g. by a pages
    // module) and resume() when it is shown again: no polling while hidden.
    suspend: function () {
        this.suspended = true;
        clearTimeout(this.pollTimer);
        clearInterval(this.refreshTimer);
    },

    resume: function () {
        if (!this.suspended) return;
        this.suspended = false;
        this.startRefreshTimer();
        this.updateDom(0); // drop the rows that departed while hidden
        this.scheduleNextPoll(0); // and fetch fresh data straight away
    },

    getDom: function () {
        var wrapper = document.createElement("div");
        wrapper.className = "skyss-wrapper";

        // Service messages / deviations (when enabled and present), shown above the
        // departures so a disruption is visible even when nothing is running. Each
        // line carries a warning icon and its own accent so it is not confused with
        // the (orange) realtime highlighting on departure times.
        if (this.config.showDeviations && this.deviations && this.deviations.length > 0) {
            var devBox = document.createElement("div");
            devBox.className = "skyss-deviations xsmall";
            for (var d = 0; d < this.deviations.length; d++) {
                var devLine = document.createElement("div");
                devLine.className = "skyss-deviation";
                var devIcon = document.createElement("span");
                devIcon.className = "skyss-deviation-icon fa fa-exclamation-triangle";
                devLine.appendChild(devIcon);
                devLine.appendChild(document.createTextNode(this.deviations[d]));
                devBox.appendChild(devLine);
            }
            wrapper.appendChild(devBox);
        }

        var now = Date.now();
        var rows = this.visibleJourneys(now);

        if (rows.length > 0) {
            var table = document.createElement("table");
            table.className = "skyss small";

            if (this.config.showHeader) {
                table.appendChild(this.getTableHeaderRow());
            }

            var tbody = document.createElement("tbody");

            for (var i = 0; i < rows.length; i++) {
                var tr = this.getTableRow(rows[i]);

                // Create fade effect. <-- stolen from default "calendar" module
                if (this.config.fade && this.config.fadePoint < 1) {
                    if (this.config.fadePoint < 0) {
                        this.config.fadePoint = 0;
                    }
                    var startingPoint = rows.length * this.config.fadePoint;
                    var steps = rows.length - startingPoint;
                    if (i >= startingPoint) {
                        var currentStep = i - startingPoint;
                        tr.style.opacity = 1 - (1 / steps) * currentStep;
                    }
                }

                tbody.appendChild(tr);
            }

            table.appendChild(tbody);
            wrapper.appendChild(table);

            // While updates keep failing, say how old the departures on screen are.
            if (this.error && now - this.lastSuccess > 2 * this.config.serviceReloadInterval) {
                var stale = document.createElement("div");
                stale.className = "skyss-stale xsmall dimmed";
                stale.textContent = this.translate("UPDATED", { time: this.formatClock(new Date(this.lastSuccess)) });
                wrapper.appendChild(stale);
            }
        } else {
            var status = this.statusMessage();
            var message = document.createElement("div");
            message.className = status.isError ? "small skyss-error" : "small dimmed";
            // Rendered as text (not innerHTML) since it is plain, translated copy.
            message.textContent = this.translate(status.key);
            wrapper.appendChild(message);
        }

        return wrapper;
    },

    /**
     * The departures to show at `now`: rows that have left (more than a minute
     * ago) or leave sooner than `walkingTime` are dropped, then `maxItems` applies.
     * Doing this at render time keeps the list moving between polls and during
     * an outage.
     * @param {number} now current time in milliseconds
     * @returns {Array<Object>}
     */
    visibleJourneys: function (now) {
        var minAhead = this.config.walkingTime > 0 ? this.config.walkingTime * 60000 : -60000;
        var rows = [];
        for (var i = 0; i < this.journeys.length && rows.length < this.config.maxItems; i++) {
            var journey = this.journeys[i];
            if (new Date(journey.time.Timestamp).getTime() - now >= minAhead) rows.push(journey);
        }
        return rows;
    },

    /**
     * What to say when there are no departures to show.
     * @returns {{ key: string, isError: boolean }} a translation key, and whether it reports a problem
     */
    statusMessage: function () {
        var type = this.error ? this.error.type : null;
        if (type === "nostops") return { key: "NOSTOPS", isError: true };
        if (type === "stop" || (!type && this.unknownStops)) return { key: "ERROR_STOP", isError: true };
        if (type === "fetch") return { key: "ERROR_FETCH", isError: true };
        return { key: this.hasLoaded ? "NODEPARTURES" : "LOADING", isError: false };
    },

    /** Redraw every REFRESH_INTERVAL ms (MagicMirror skips the update when nothing changed). */
    startRefreshTimer: function () {
        var self = this;
        clearInterval(this.refreshTimer);
        this.refreshTimer = setInterval(function () {
            self.updateDom(0);
        }, REFRESH_INTERVAL);
    },

    /**
     * Schedule the next poll, replacing any pending one. Nothing is scheduled
     * while the module is suspended; resume() polls again.
     * @param {number} delay milliseconds until the next poll
     */
    scheduleNextPoll: function (delay) {
        var self = this;
        clearTimeout(this.pollTimer);
        if (this.suspended) return;
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
        // has a frontend timeout (see sendRequest) that surfaces an error, so this
        // callback always runs and always schedules the next poll.
        this.getStopInfo(this.config.stops, function (err, result) {
            if (err) {
                // Keep the last good data on screen, say what went wrong, and back
                // off the next poll (exponential, capped at maxReloadInterval).
                var error = err && err.type ? err : { type: "fetch", detail: String(err) };
                self.error = error;
                self.logError(error);
                self.updateDom(0);
                // A config without valid stops cannot recover until a restart.
                if (error.type === "nostops") return;
                self.consecutiveErrors++;
                if (self.config.debug) console.log("[MMM-Skyss][DEBUG] Next poll in", self.nextBackoff(), "ms");
                self.scheduleNextPoll(self.nextBackoff());
                return;
            }

            self.consecutiveErrors = 0;
            self.error = null;
            self.loggedError = null;
            self.hasLoaded = true;
            self.lastSuccess = Date.now();

            self.journeys = (result || [])
                .slice()
                .sort(function (a, b) {
                    return new Date(a.time.Timestamp).getTime() - new Date(b.time.Timestamp).getTime();
                })
                .slice(0, MAX_KEPT_DEPARTURES);

            if (self.config.debug) console.log("[MMM-Skyss][DEBUG] Kept", self.journeys.length, "departures");

            self.updateDom(self.config.animationSpeed);
            self.scheduleNextPoll(self.config.serviceReloadInterval);
        });
    },

    /**
     * Report a failed update in the browser console, once per distinct error so a
     * long outage does not repeat it every poll. The node helper also logs
     * transport and API errors to the MagicMirror server log.
     * @param {{ type: string, detail?: string }} error
     */
    logError: function (error) {
        var text = error.type + (error.detail ? ": " + error.detail : "");
        if (text === this.loggedError) return;
        this.loggedError = text;
        console.warn("[MMM-Skyss] Could not update departures (" + text + ")");
    },

    /**
     * Fetch and normalise departures for the configured stops, then hand the
     * resulting view-model array to the callback. Errors are a string for a
     * transport or parse failure, or { type, detail } when the cause is known.
     * @param {Array<Object>} stopItems the `stops` config array
     * @param {(err: any, items: Array<Object>) => void} callback
     */
    getStopInfo: function (stopItems, callback) {
        var self = this;

        // Build the request body once and reuse it: the stops config is static.
        if (this._requestBody === undefined) {
            this._requestBody = this.buildRequestBody(stopItems);
        }
        var requestBody = this._requestBody;

        if (!requestBody.stopGroups || requestBody.stopGroups.length === 0) {
            callback({ type: "nostops", detail: "no valid stops configured" }, []);
            return;
        }

        this.sendRequest(requestBody, function (err, stopResponse) {
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

            // Skyss answers a bad request with HTTP 200 and an error body, e.g.
            // PERMANENT_ERROR "Holdeplassen finnes ikke" for an unknown stop.
            if (departure && departure.resultCode) {
                callback(
                    {
                        type: departure.resultCode === "PERMANENT_ERROR" ? "stop" : "fetch",
                        detail: [departure.resultCode, departure.errorCode, departure.errorMessage]
                            .filter(Boolean)
                            .join(" ")
                    },
                    []
                );
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
                // A departure that has already passed the stop is gone.
                if (journey.Passed === true) {
                    if (self.config.debug)
                        console.log("[MMM-Skyss][DEBUG] Skipping passed", journey.RoutePublicIdentifier);
                    continue;
                }
                // A cancelled departure keeps its timetable DisplayTime but will not
                // run: it is shown as cancelled, or left out with showCancelled off.
                var cancelled = journey.Status === "Cancelled";
                if (cancelled && !self.config.showCancelled) {
                    if (self.config.debug)
                        console.log("[MMM-Skyss][DEBUG] Skipping cancelled", journey.RoutePublicIdentifier);
                    continue;
                }
                var stop = departure.Stops[journey.StopIdentifier] || {};
                var timestamp;

                // Only live-tracked departures carry a realtime estimate. Every row has
                // a DisplayTime, but for "Schedule" rows it is just the timetable, so
                // those use the exact AimedTime and are not flagged as realtime (which
                // drives the realtime accent).
                var hasLiveData = SKYSS_LIVE_STATUSES.indexOf(journey.Status) !== -1;
                var realtimeStamp =
                    self.config.useRealtime && hasLiveData
                        ? self.processSkyssDisplaytime(journey.DisplayTime)
                        : undefined;
                var usedRealtime = realtimeStamp instanceof Date && !isNaN(realtimeStamp.getTime());
                if (usedRealtime) {
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
                    usedRealtime: usedRealtime,
                    cancelled: cancelled,
                    // Skyss flags a live estimate it does not trust; it is shown as approximate.
                    approximate: usedRealtime && journey.PredictionInaccurate === true,
                    // The platform letter ("A", "B", ...) belongs to the quay, so it is
                    // on the Stops entry, not on the departure. Many roadside stops
                    // have none.
                    platform: stop.Platform || ""
                });
            }

            if (self.config.debug) console.log("[MMM-Skyss][DEBUG] Messages:", JSON.stringify(departure.Messages));
            self.deviations = self.extractDeviations(departure.Messages, Date.now());
            self.checkKnownStops(requestBody, departure.Stops, allStopItems.length);

            if (self.config.debug) console.log("[MMM-Skyss][DEBUG] Processed", allStopItems.length, "stop items");
            callback(null, allStopItems);
        });
    },

    /**
     * Warn, once per quay, about configured quays that Skyss does not know under
     * their stop group (a typo, or a quay paired with the wrong stopGroupId): the
     * API just returns nothing for them. When none of the quays is known and
     * nothing departs, the board says so instead of "No departures".
     * @param {{ stopGroups: Array<{id: string, stops: Array<{id: string}>}> }} requestBody
     * @param {Object} knownStops the response's `Stops`, keyed by quay id
     * @param {number} departureCount departures in the response
     */
    checkKnownStops: function (requestBody, knownStops, departureCount) {
        var self = this;
        var configured = 0;
        var unknown = 0;
        requestBody.stopGroups.forEach(function (group) {
            group.stops.forEach(function (quay) {
                configured++;
                if (knownStops[quay.id]) return;
                unknown++;
                if (self.warnedQuays[quay.id]) return;
                self.warnedQuays[quay.id] = true;
                console.warn(
                    "[MMM-Skyss] Skyss does not know " +
                        quay.id +
                        " under " +
                        group.id +
                        "; check stopId / stopGroupId (node scripts/api-sample.js " +
                        group.id.split(":").pop() +
                        " lists the quays of that stop)"
                );
            });
        });
        this.unknownStops = configured > 0 && unknown === configured && departureCount === 0;
    },

    /**
     * Build the v3 `/departures` request body by grouping configured stops by
     * stopGroupId and normalising ids to the `NSR:` form. A stop given only by its
     * stopGroupId is sent without quays, which makes Skyss return all of them.
     * @param {Array<Object>} stopItems the `stops` config array
     * @returns {{ stopGroups: Array<{id: string, stops: Array<{id: string}>}> }}
     */
    buildRequestBody: function (stopItems) {
        var self = this;

        // Helper function to add NSR prefix if not present
        const normalizeId = function (id, type) {
            if (!id) return undefined;
            if (id.startsWith && id.startsWith("NSR:")) return id;
            return "NSR:" + type + ":" + id;
        };

        const stopGroupsMap = {}; // key = groupId
        const wholeGroups = {}; // groups configured without quays: ask for all of them

        // Guard against a missing/invalid `stops` config (undefined, null, non-array)
        const items = Array.isArray(stopItems) ? stopItems : [];

        for (let i = 0; i < items.length; i++) {
            const item = items[i] || {};

            // StopPlace only: { stopGroupId: "62356" } shows every quay of the stop.
            if (item.stopGroupId && item.stopId === undefined && item.stopIds === undefined) {
                const groupId = normalizeId(item.stopGroupId, "StopPlace");
                wholeGroups[groupId] = true;
                if (!stopGroupsMap[groupId]) {
                    stopGroupsMap[groupId] = { id: groupId, stops: [] };
                }
                continue;
            }

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

        // A whole StopPlace wins over quays listed for it elsewhere: send none.
        Object.keys(wholeGroups).forEach((groupId) => {
            stopGroupsMap[groupId].stops = [];
        });

        // Additional safeguard: remove groups without id, or with no quays unless
        // the whole stop was asked for.
        const filtered = Object.values(stopGroupsMap).filter((g) => g.id && (g.stops.length > 0 || wholeGroups[g.id]));

        if (filtered.length === 0) {
            console.warn("[MMM-Skyss] No valid stops configured. Check the stops config (see README).");
        } else if (self.config.debug) {
            console.log("[MMM-Skyss][DEBUG] Constructed request body with", filtered.length, "group(s).");
            filtered.forEach((g) =>
                console.log(
                    "[MMM-Skyss][DEBUG] Group",
                    g.id,
                    "stops:",
                    g.stops.length ? g.stops.map((s) => s.id).join(", ") : "all quays"
                )
            );
        }

        return { stopGroups: filtered };
    },

    /**
     * Turn the response's top-level `Messages` into the service-message texts to
     * show: only messages valid right now, each distinct text once. Each entry is
     * one affected route at one quay, so the same text repeats for every route:
     *   { RoutePublicIdentifier, StopIdentifier, Messages: ["text"],
     *     messagesWithValidityPeriod: [{ message: "text", start: ISO, end: ISO }] }
     * Messages arrive before their validity period starts (tonight's closure is
     * already sent in the morning), so the period is honoured when present.
     * @param {any} messages the response's `Messages` value
     * @param {number} nowMs the current time in milliseconds
     * @returns {string[]}
     */
    extractDeviations: function (messages, nowMs) {
        var texts = [];
        var add = function (text) {
            if (typeof text !== "string") return;
            var trimmed = text.trim();
            if (trimmed && texts.indexOf(trimmed) === -1) texts.push(trimmed);
        };
        // A missing or unparseable bound leaves that side of the period open.
        var isActive = function (period) {
            var start = Date.parse(period.start);
            var end = Date.parse(period.end);
            if (!isNaN(start) && nowMs < start) return false; // not started yet
            if (!isNaN(end) && nowMs > end) return false; // already over
            return true;
        };

        (Array.isArray(messages) ? messages : []).forEach(function (entry) {
            if (!entry || typeof entry !== "object") return;
            var periods = Array.isArray(entry.messagesWithValidityPeriod) ? entry.messagesWithValidityPeriod : [];
            if (periods.length > 0) {
                periods.forEach(function (period) {
                    if (period && isActive(period)) add(period.message);
                });
            } else if (Array.isArray(entry.Messages)) {
                entry.Messages.forEach(add);
            }
        });
        return texts;
    },

    /**
     * Parse Skyss' realtime "DisplayTime" ("x min" or "HH:mm") into a Date.
     * @param {string} displayTime
     * @returns {Date|undefined} the departure time, or undefined if unrecognised
     */
    processSkyssDisplaytime: function (displayTime) {
        if (typeof displayTime !== "string") return undefined;

        // "x min": the realtime estimate of whole minutes until departure.
        var minutesMatch = displayTime.match(SKYSS_MINUTES_RE);
        if (minutesMatch) {
            return new Date(Date.now() + parseInt(minutesMatch[1], 10) * 60000);
        }

        // "HH:mm": a clock time today, rolled to tomorrow if it has already passed.
        var clockMatch = displayTime.match(SKYSS_CLOCK_RE);
        if (clockMatch) {
            var when = new Date();
            when.setHours(parseInt(clockMatch[1], 10), parseInt(clockMatch[2], 10), 0, 0);
            if (when.getTime() < Date.now()) {
                when.setDate(when.getDate() + 1);
            }
            return when;
        }

        return undefined;
    },

    /**
     * Send a request body to the node helper, tagged with a unique per-instance id
     * so only the issuing instance consumes the broadcast response. A safety-net
     * timeout drops the pending entry and surfaces an error if the helper's response
     * is ever lost (so polling reschedules and the request map can't leak). It must
     * exceed the helper's own 15s timeout, is cleared in socketNotificationReceived
     * once a response arrives, and is unref()'d so a pending timer never by itself
     * keeps the runtime alive (unref is a no-op in the browser, where setTimeout
     * returns a number).
     * @param {Object} requestBody
     * @param {(err: any, response: any) => void} requestCallback
     */
    sendRequest: function (requestBody, requestCallback) {
        var self = this;
        var id = self.instanceId + ":" + ++self.requestSeq;
        var timer = setTimeout(function () {
            if (!self.requests[id]) return;
            delete self.requests[id];
            if (self.config.debug) console.log("[MMM-Skyss][DEBUG] No response for", id, "- timing out");
            requestCallback("request timed out", null);
        }, 30000);
        if (timer && typeof timer.unref === "function") timer.unref();
        self.requests[id] = { callback: requestCallback, timer: timer };
        self.sendSocketNotification("getstop", { id: id, body: requestBody, debug: self.config.debug });
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
        // The icon sits in a span: Font Awesome's classes would turn a <td> itself
        // into an inline block and break the table layout.
        var imageFA;
        switch (journey.service) {
            case "Light rail":
                imageFA = "subway";
                break;
            case "Boat":
            case "Ferry":
                imageFA = "ship";
                break;
            case "Train":
                imageFA = "train";
                break;
            default:
                // "Bus", and a neutral transit glyph for any mode Skyss adds later.
                imageFA = "bus";
                break;
        }
        var icon = document.createElement("span");
        icon.className = "fa fa-" + imageFA;
        var tdIcon = document.createElement("td");
        tdIcon.className = "icon";
        tdIcon.appendChild(icon);

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
        var timeText;
        if (journey.cancelled) {
            tdTime.className = "time light";
            timeText = this.translate("CANCELLED");
        } else {
            // Accent the time only when it is a live realtime estimate (see
            // getStopInfo); timetable-only departures stay unaccented.
            tdTime.className = journey.usedRealtime ? "time light sanntid" : "time light";
            timeText = this.formatTime(journey.time.Timestamp);
            if (journey.approximate) timeText = this.translate("APPROX") + " " + timeText;
        }
        tdTime.appendChild(document.createTextNode(timeText));

        var tr = document.createElement("tr");
        if (journey.cancelled) tr.className = "cancelled";
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
     * Minutes are rounded to the nearest whole minute, as Skyss' own DisplayTime
     * is (a departure 1:59 away reads "2 min"). Rounding down would show an
     * "x min" estimate parsed a moment earlier as x-1.
     * @param {string|number|Date} t departure timestamp
     * @returns {string}
     */
    formatTime: function (t) {
        var now = new Date();
        var tti = new Date(t);
        var diff = tti.getTime() - now.getTime();
        var min = Math.round(diff / 60000);

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
        return this.formatClock(tti);
    },

    /**
     * Format a Date as a clock time honouring the configured 12/24-hour format
     * ("HH:mm" or "h:mm A"), without depending on the `moment` global.
     * @param {Date} date
     * @returns {string}
     */
    formatClock: function (date) {
        var hours = date.getHours();
        var minutes = date.getMinutes();
        var mm = minutes < 10 ? "0" + minutes : "" + minutes;

        if (this.config.timeFormat === "HH:mm") {
            var hh = hours < 10 ? "0" + hours : "" + hours;
            return hh + ":" + mm;
        }

        // 12-hour "h:mm A"
        var suffix = hours >= 12 ? "PM" : "AM";
        var hour12 = hours % 12 || 12;
        return hour12 + ":" + mm + " " + suffix;
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
