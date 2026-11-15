/**
 * Crimsons StreamDock plugin debug logger (dev-only).
 *
 * OFF by default (production installs write nothing).
 * Enable on a test machine by creating either:
 *   %APPDATA%\com.laoy.crimsons\debug.flag
 * or env CRIMSON_PLUGIN_DEBUG=1
 *
 * Logs land in:
 *   %APPDATA%\com.laoy.crimsons\logs\<pluginId>.log
 * Soft-rotated at ~2 MB (keeps last half).
 *
 * Usage (each plugin app.js):
 *   <script src="../_shared/crimson_debug.js"></script>  // or copied sibling
 *   const log = CrimsonDebug.create("applemusic");
 *   log.info("boot");
 */
(function (root) {
    "use strict";

    var MAX_BYTES = 2 * 1024 * 1024;

    function dataDir() {
        try {
            var path = require("path");
            return path.join(process.env.APPDATA || "", "com.laoy.crimsons");
        } catch (e) {
            return "";
        }
    }

    function isEnabled() {
        try {
            if (process.env.CRIMSON_PLUGIN_DEBUG === "1" || process.env.CRIMSON_PLUGIN_DEBUG === "true") {
                return true;
            }
        } catch (e0) {}
        try {
            var fs = require("fs");
            var path = require("path");
            var flag = path.join(dataDir(), "debug.flag");
            if (fs.existsSync(flag)) return true;
        } catch (e1) {}
        return false;
    }

    function rotateIfNeeded(fs, filePath) {
        try {
            var st = fs.statSync(filePath);
            if (!st || st.size < MAX_BYTES) return;
            var raw = fs.readFileSync(filePath);
            var keep = raw.slice(Math.floor(raw.length / 2));
            fs.writeFileSync(filePath, Buffer.concat([
                Buffer.from("==== rotated " + new Date().toISOString() + " ====\n"),
                keep
            ]));
        } catch (e) {}
    }

    function ensureFile(id) {
        try {
            var fs = require("fs");
            var path = require("path");
            var dir = path.join(dataDir(), "logs");
            fs.mkdirSync(dir, { recursive: true });
            var filePath = path.join(dir, id + ".log");
            if (!fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, "");
            }
            return filePath;
        } catch (e) {
            return null;
        }
    }

    function create(pluginId) {
        var enabled = isEnabled();
        var filePath = null;
        var lastTs = 0;
        var id = String(pluginId || "plugin").replace(/[^\w.-]+/g, "_");
        var sessionWritten = false;

        if (enabled) {
            filePath = ensureFile(id);
            if (filePath) {
                try {
                    var fs0 = require("fs");
                    fs0.appendFileSync(filePath, "\n==== session " + new Date().toISOString() + " plugin=" + id + " ====\n");
                    sessionWritten = true;
                } catch (eS) {}
            }
        }

        function write(level, msg, extra) {
            // Re-check flag so enabling debug.flag mid-session starts working.
            if (!enabled) {
                enabled = isEnabled();
                if (!enabled) return;
            }
            if (!filePath) filePath = ensureFile(id);
            if (filePath && !sessionWritten) {
                try {
                    var fsS = require("fs");
                    fsS.appendFileSync(filePath, "\n==== session " + new Date().toISOString() + " plugin=" + id + " ====\n");
                    sessionWritten = true;
                } catch (eS2) {}
            }
            var now = Date.now();
            var delta = lastTs ? (now - lastTs) : 0;
            lastTs = now;
            var line = "[" + new Date(now).toISOString() + "] +" + delta + "ms [" + level + "] " + msg
                + (extra !== undefined ? (" " + (typeof extra === "string" ? extra : JSON.stringify(extra))) : "")
                + "\n";
            try { console.log("[CrimsonDebug:" + id + "]", level, msg, extra !== undefined ? extra : ""); } catch (e0) {}
            if (!filePath) return;
            try {
                var fs = require("fs");
                rotateIfNeeded(fs, filePath);
                fs.appendFileSync(filePath, line);
            } catch (e1) {}
        }

        return {
            enabled: enabled,
            path: filePath,
            info: function (m, e) { write("INFO", m, e); },
            warn: function (m, e) { write("WARN", m, e); },
            error: function (m, e) { write("ERROR", m, e); },
            timing: function (label, startedAt) {
                var ms = Date.now() - startedAt;
                if (ms >= 250) write("WARN", "SLOW " + label, { ms: ms });
                else write("INFO", label, { ms: ms });
                return ms;
            }
        };
    }

    root.CrimsonDebug = { create: create, isEnabled: isEnabled };
})(typeof window !== "undefined" ? window : globalThis);
