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
        this.queue = [];
        this.attempts = 0;
        this.connect();
    }

    connect() {
        this.attempts++;
        this.url = crimsonWsUrl(this.port);
        this.ws = new WebSocket(this.url);
        
        this.ws.onopen = () => {
            console.log("CrimsonAPI: Connected to Backend.");
            this.attempts = 0;
            // Flush queue
            while (this.queue.length > 0) {
                const msg = this.queue.shift();
                this.ws.send(JSON.stringify(msg));
            }
        };

        this.ws.onmessage = (evt) => {
            try {
                const data = JSON.parse(evt.data);
                if (window.handleCrimsonMessage) {
                    window.handleCrimsonMessage(data);
                }
            } catch (e) {
                console.error("CrimsonAPI: Error parsing message", e);
            }
        };

        this.ws.onclose = () => {
            console.warn("CrimsonAPI: Connection closed. Reconnecting...");
            setTimeout(() => this.connect(), 2000);
        };

        this.ws.onerror = (err) => {
            console.error("CrimsonAPI: Socket error", err);
        };
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        } else {
            console.log("CrimsonAPI: Socket not open. Queuing message.");
            this.queue.push(data);
        }
    }
}

