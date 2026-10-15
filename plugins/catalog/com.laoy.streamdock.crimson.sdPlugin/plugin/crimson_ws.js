/** Resolve WS auth token for crimson-server (strict auth).
 * Order: localhost HTTP (fresh after server restart) → Node fs / ActiveX → injected.
 * Injected __CRIMSON_AUTH_TOKEN__ is frozen at plugin page load and goes stale when
 * crimson-server regenerates auth.token — never prefer it over a live fetch.
 */
function crimsonAuthToken() {
    try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', 'http://127.0.0.1:40510/local/ws-token', false);
        xhr.send(null);
        if (xhr.status === 200 && xhr.responseText) {
            var httpTok = String(xhr.responseText).trim();
            if (httpTok) {
                try { window.__CRIMSON_AUTH_TOKEN__ = httpTok; } catch (eCache) {}
                return httpTok;
            }
        }
    } catch (e1) {}
    try {
        var fs = require('fs');
        var path = require('path');
        var tokenPath = path.join(process.env.APPDATA || '', 'com.laoy.crimsons', 'auth.token');
        var fileTok = (fs.readFileSync(tokenPath, 'utf8') || '').trim();
        if (fileTok) {
            try { window.__CRIMSON_AUTH_TOKEN__ = fileTok; } catch (eCache2) {}
            return fileTok;
        }
    } catch (e2) {
        try {
            var shell = new ActiveXObject('WScript.Shell');
            var fso = new ActiveXObject('Scripting.FileSystemObject');
            var p = shell.ExpandEnvironmentStrings('%APPDATA%\\com.laoy.crimsons\\auth.token');
            if (fso.FileExists(p)) {
                var f = fso.OpenTextFile(p, 1);
                var t = (f.ReadAll() || '').trim();
                f.Close();
                if (t) {
                    try { window.__CRIMSON_AUTH_TOKEN__ = t; } catch (eCache3) {}
                    return t;
                }
            }
        } catch (e3) {}
    }
    try {
        if (typeof window !== 'undefined' && window.__CRIMSON_AUTH_TOKEN__) {
            var injected = String(window.__CRIMSON_AUTH_TOKEN__).trim();
            if (injected) return injected;
        }
    } catch (e0) {}
    return '';
}

function crimsonWsUrl(port) {
    port = port || 40510;
    var token = crimsonAuthToken();
    var base = 'ws://127.0.0.1:' + port;
    return token ? (base + '/?token=' + encodeURIComponent(token)) : base;
}

class CrimsonAPI {
    constructor(port = 40510) {
        this.port = port;
        this.url = crimsonWsUrl(port);
        this.ws = null;
        this.onMessage = null;
        this.onStatusChange = null;
        this.reconnectInterval = 1000;
        this.maxReconnectInterval = 5000; // Cap at 5s — no more 30s dead-air
        this.isConnected = false;
        this.attempts = 0;
        this._reconnectTimer = null;
        this.connect();
    }

    connect() {
        // Cancel any pending reconnect timer before starting a new attempt
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }

        this.attempts++;
        // Re-read token each attempt (server regenerates on restart).
        this.url = crimsonWsUrl(this.port);
        console.log(`CrimsonAPI: Connecting to ${this.url.replace(/token=[^&]+/, 'token=***')} (Attempt ${this.attempts})...`);
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
            console.log("CrimsonAPI: Connected to Backend.");
            if (this.onOpen) { this.onOpen(); }
            this.reconnectInterval = 1000; // Reset backoff on success
            this.attempts = 0;
            this.isConnected = true;
            if (this.onStatusChange) this.onStatusChange(true);
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (this.onMessage) this.onMessage(data);
            } catch (e) {
                console.error("Crimson WS Payload Parsing Error", e);
            }
        };

        this.ws.onclose = () => {
            console.warn(`CrimsonAPI: Connection lost. Reconnecting in ${this.reconnectInterval / 1000}s...`);
            this.isConnected = false;
            if (this.onStatusChange) this.onStatusChange(false);
            this._reconnectTimer = setTimeout(() => {
                this.reconnectInterval = Math.min(this.reconnectInterval * 2, this.maxReconnectInterval);
                this.connect();
            }, this.reconnectInterval);
        };

        this.ws.onerror = () => {
            this.ws.close();
        };
    }

    // Force an immediate reconnect (e.g. from infoboard tap button)
    forceReconnect() {
        this.reconnectInterval = 1000; // Reset backoff
        if (this.ws) {
            this.ws.onclose = null; // Suppress the normal close handler to avoid double-reconnect
            this.ws.close();
        }
        this.isConnected = false;
        this.connect();
    }

    send(command) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(command));
        } else {
            console.warn("Crimson Backend disconnected, command dropped:", command);
        }
    }
}

// Instantiate global API for all Crimson services (40510)
const api = new CrimsonAPI(40510);
// spotifyApi is aliased to api for backward compatibility
const spotifyApi = api;

