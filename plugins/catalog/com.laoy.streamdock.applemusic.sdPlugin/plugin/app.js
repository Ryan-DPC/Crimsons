let streamDeckSocket = null;
let globalPluginUUID = "";
let lastAlbumArt = null;
let actionContexts = {
    "com.laoy.streamdock.applemusic.playpause": [],
    "com.laoy.streamdock.applemusic.previous": [],
    "com.laoy.streamdock.applemusic.next": [],
    "com.laoy.streamdock.applemusic.volumeup": [],
    "com.laoy.streamdock.applemusic.volumedown": [],
    "com.laoy.streamdock.applemusic.shuffle": [],
    "com.laoy.streamdock.applemusic.repeat": [],
    "com.laoy.streamdock.applemusic.songinfo": [],
    "com.laoy.streamdock.applemusic.love": [],
    "com.laoy.streamdock.applemusic.addtolibrary": [],
    "com.laoy.streamdock.applemusic.seekforward": [],
    "com.laoy.streamdock.applemusic.seekbackward": [],
    "com.laoy.streamdock.applemusic.clearqueue": [],
    "com.laoy.streamdock.applemusic.volumecontrol": [],
    "com.laoy.streamdock.applemusic.previousornext": [],
    "com.laoy.streamdock.applemusic.seekcontrol": []
};

const CIDER_BASE = "http://127.0.0.1:10767";

/** Dynamic Cider App Token resolver with multi-source fallback. */
function getCiderToken() {
    if (typeof window !== "undefined" && window.__CIDER_APP_TOKEN__) {
        return window.__CIDER_APP_TOKEN__;
    }
    try {
        if (typeof localStorage !== "undefined" && localStorage.getItem("cider_token")) {
            return localStorage.getItem("cider_token");
        }
    } catch (eStorage) {}
    try {
        var fs = require("fs");
        var path = require("path");
        var appdata = process.env.APPDATA || "";
        // 1. Check Crimsons cider cache
        var cachePath = path.join(appdata, "com.laoy.crimsons", "cider_cache.json");
        if (fs.existsSync(cachePath)) {
            var raw = JSON.parse(fs.readFileSync(cachePath, "utf8"));
            if (raw && raw.appToken) {
                window.__CIDER_APP_TOKEN__ = raw.appToken;
                return raw.appToken;
            }
        }
        // 2. Check Cider spa config
        var cfgPath = path.join(appdata, "sh.cider.dotnet", "spa-config.yml");
        if (fs.existsSync(cfgPath)) {
            var content = fs.readFileSync(cfgPath, "utf8");
            var m = content.match(/token:\s*([^\r\n]+)/);
            if (m && m[1]) {
                var tok = m[1].trim().replace(/^['"]|['"]$/g, "");
                if (tok) {
                    window.__CIDER_APP_TOKEN__ = tok;
                    return tok;
                }
            }
        }
    } catch (eNode) {}
    // 3. Known active token fallback
    return "q0ayx8a0n91yhg9v9wrq9h6w";
}

/** Direct Cider HTTP API Client */
const ciderAPI = {
    cachedState: null,
    lastVolume: 0.5,

    async request(path, method = "POST", body = null) {
        const token = getCiderToken();
        const headers = {};
        if (token) headers["apptoken"] = token;
        const opts = { method, headers };
        if (body !== null && body !== undefined) {
            headers["Content-Type"] = "application/json";
            opts.body = JSON.stringify(body);
        }
        try {
            const resp = await fetch(`${CIDER_BASE}${path}`, opts);
            return resp;
        } catch (err) {
            console.error(`[AppleMusic:Cider] Network error on ${path}:`, err);
            return null;
        }
    },

    async fetchState() {
        try {
            const resp = await this.request("/api/v2/playback", "GET");
            if (resp && resp.ok) {
                const json = await resp.json();
                const d = json.data || {};
                const now = d.nowPlaying || {};
                const time = d.time || {};
                const vol = typeof d.volume === "number" ? d.volume : 0.5;
                if (vol > 0) this.lastVolume = vol;

                const artwork = (now.artwork && now.artwork.url)
                    ? now.artwork.url.replace("{w}", "300").replace("{h}", "300")
                    : "";

                this.cachedState = {
                    is_playing: d.state === "playing" || d.state === "play",
                    track_name: now.name || "",
                    artist_name: now.artistName || "",
                    album_name: now.albumName || "",
                    album_art: artwork,
                    progress_ms: Math.round((time.currentTime || 0) * 1000),
                    duration_ms: now.durationInMillis || Math.round((time.duration || 0) * 1000),
                    volume_percent: Math.round(Math.min(Math.max(vol, 0), 1) * 100),
                    shuffle_state: !!d.shuffleMode,
                    repeat_state: d.repeatMode || "none",
                    cider_connected: true,
                    in_favorites: !!now.inFavorites,
                    in_library: !!now.inLibrary
                };
                return this.cachedState;
            }
        } catch (e) {
            console.warn("[AppleMusic:Cider] fetchState error", e);
        }
        return null;
    },

    async executeCommand(endpoint, payload = {}) {
        console.log(`[AppleMusic:Cider] Executing: ${endpoint}`, payload);
        switch (endpoint) {
            case "playpause":
                await this.request("/api/v1/playback/playpause");
                break;
            case "previous":
                await this.request("/api/v1/playback/previous");
                break;
            case "next":
                await this.request("/api/v1/playback/next");
                break;
            case "volumeup": {
                const cur = this.cachedState ? (this.cachedState.volume_percent / 100) : 0.5;
                const next = Math.min(1.0, cur + 0.05);
                await this.request("/api/v2/audio/volume", "PATCH", { volume: next });
                break;
            }
            case "volumedown": {
                const cur = this.cachedState ? (this.cachedState.volume_percent / 100) : 0.5;
                const next = Math.max(0.0, cur - 0.05);
                await this.request("/api/v2/audio/volume", "PATCH", { volume: next });
                break;
            }
            case "volumecontrol": {
                const ticks = payload.ticks || 0;
                const cur = this.cachedState ? (this.cachedState.volume_percent / 100) : 0.5;
                const next = Math.min(1.0, Math.max(0.0, cur + (ticks * 0.03)));
                await this.request("/api/v2/audio/volume", "PATCH", { volume: next });
                break;
            }
            case "mute": {
                const cur = this.cachedState ? (this.cachedState.volume_percent / 100) : 0.5;
                if (cur > 0.01) {
                    this.lastVolume = cur;
                    await this.request("/api/v2/audio/volume", "PATCH", { volume: 0 });
                } else {
                    await this.request("/api/v2/audio/volume", "PATCH", { volume: this.lastVolume || 0.4 });
                }
                break;
            }
            case "skip": {
                const ticks = payload.ticks || 0;
                if (ticks > 0) {
                    await this.request("/api/v1/playback/next");
                } else if (ticks < 0) {
                    await this.request("/api/v1/playback/previous");
                }
                break;
            }
            case "seekrelative": {
                const ticks = payload.ticks || 0;
                const curSecs = this.cachedState ? (this.cachedState.progress_ms / 1000) : 0;
                const durSecs = this.cachedState ? (this.cachedState.duration_ms / 1000) : 0;
                const nextSecs = Math.min(durSecs || 9999, Math.max(0, curSecs + (ticks * 5)));
                await this.request("/api/v1/playback/seek", "POST", { position: nextSecs });
                break;
            }
            case "seekforward": {
                const curSecs = this.cachedState ? (this.cachedState.progress_ms / 1000) : 0;
                const durSecs = this.cachedState ? (this.cachedState.duration_ms / 1000) : 0;
                const nextSecs = Math.min(durSecs || 9999, Math.max(0, curSecs + 15));
                await this.request("/api/v1/playback/seek", "POST", { position: nextSecs });
                break;
            }
            case "seekbackward": {
                const curSecs = this.cachedState ? (this.cachedState.progress_ms / 1000) : 0;
                const nextSecs = Math.max(0, curSecs - 15);
                await this.request("/api/v1/playback/seek", "POST", { position: nextSecs });
                break;
            }
            case "shuffle":
                await this.request("/api/v1/playback/toggle-shuffle");
                break;
            case "repeat":
                await this.request("/api/v1/playback/toggle-repeat");
                break;
            case "clearqueue":
                await this.request("/api/v1/playback/queue/clear-queue");
                break;
            case "addtolibrary":
                await this.request("/api/v1/playback/add-to-library");
                break;
            case "togglelove":
                await this.request("/api/v1/playback/set-rating", "POST", { rating: 1 });
                break;
        }

        // Fast update after command execution
        setTimeout(async () => {
            const st = await this.fetchState();
            if (st) applyNowPlaying(st);
        }, 120);
    }
};

/** Prefer live /local/ws-token over injected global (stale after server restart). */
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

function handleHardwareEvent(jsonObj) {
    const event = jsonObj['event'];
    const action = jsonObj['action'];
    const context = jsonObj['context'];

    if (!event) return;

    if (event === "willAppear") {
        if (actionContexts[action] && !actionContexts[action].includes(context)) {
            actionContexts[action].push(context);
        }
        // Immediately fetch state on appearance to display current song/volume
        ciderAPI.fetchState().then(st => {
            if (st) applyNowPlaying(st);
        });
    }

    if (event === "willDisappear") {
        if (actionContexts[action]) {
            actionContexts[action] = actionContexts[action].filter(c => c !== context);
        }
    }

    if (event === "keyDown" || (event === "dialPress" && jsonObj['payload']?.pressed)) {
        handleKeyDown(action);
    }

    if (event === "dialRotate") {
        const ticks = (jsonObj['payload'] && jsonObj['payload'].ticks) || 0;
        handleDialRotate(action, ticks);
    }
}

const crimsonAPI = {
    ws: null,
    queue: [],
    onOpen: null,
    connect() {
        this.ws = new WebSocket(crimsonWsUrl(40510));
        this.ws.onopen = () => {
            console.log("[AppleMusic] Connected to Crimson Backend on 40510.");
            if (this.onOpen) this.onOpen();
            while (this.queue.length > 0) {
                this.ws.send(JSON.stringify(this.queue.shift()));
            }
        };
        this.ws.onmessage = (evt) => {
            try {
                const data = JSON.parse(evt.data);
                if (data.event === "setState") {
                    updateActionState(data.action, data.payload.state);
                }
                if (data.type === "APPLE_MUSIC_STATE" && data.data) {
                    applyNowPlaying(data.data);
                }
                if (data.event) {
                    handleHardwareEvent(data);
                }
            } catch (e) {
                console.error("[AppleMusic] Error parsing Crimson message", e);
            }
        };
        this.ws.onclose = () => {
            setTimeout(() => this.connect(), 4000);
            setTimeout(() => {
                if (!streamDeckSocket || streamDeckSocket.readyState === WebSocket.CLOSED) {
                    if (window.connectHw) window.connectHw();
                }
            }, 1000);
        };
        this.ws.onerror = () => {
            try { this.ws.close(); } catch (e) {}
        };
    },
    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        } else {
            this.queue.push(data);
        }
    },
    async toBase64(url) {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0);
                resolve(canvas.toDataURL("image/png"));
            };
            img.onerror = () => resolve(null);
            img.src = url;
        });
    }
};
crimsonAPI.connect();

function connectElgatoStreamDeckSocket(inPort, inPluginUUID, inRegisterEvent, inInfo) {
    globalPluginUUID = inPluginUUID;

    const register = () => {
        crimsonAPI.send({
            type: 'REGISTER_STREAMDOCK',
            port: inPort,
            uuid: inPluginUUID,
            register_event: inRegisterEvent
        });
    };

    crimsonAPI.onOpen = register;
    if (crimsonAPI.ws && crimsonAPI.ws.readyState === WebSocket.OPEN) {
        register();
    }

    const connectHw = () => {
        if (streamDeckSocket &&
            (streamDeckSocket.readyState === WebSocket.OPEN ||
             streamDeckSocket.readyState === WebSocket.CONNECTING)) {
            return;
        }

        streamDeckSocket = new WebSocket("ws://127.0.0.1:" + inPort);

        streamDeckSocket.onopen = function () {
            streamDeckSocket.send(JSON.stringify({ "event": inRegisterEvent, "uuid": inPluginUUID }));
            // Immediate state sync
            ciderAPI.fetchState().then(st => {
                if (st) applyNowPlaying(st);
            });
        };

        streamDeckSocket.onclose = function () {
            streamDeckSocket = null;
            setTimeout(() => connectHw(), 3000);
        };

        streamDeckSocket.onerror = function () {
            try { streamDeckSocket.close(); } catch (e) {}
        };

        streamDeckSocket.onmessage = function (evt) {
            try {
                handleHardwareEvent(JSON.parse(evt.data));
            } catch (e) {
                console.error("[AppleMusic] Hardware message error", e);
            }
        };
    };

    window.connectHw = connectHw;
    connectHw();
}

function handleKeyDown(action) {
    let endpoint = null;
    switch (action) {
        case "com.laoy.streamdock.applemusic.playpause":
            endpoint = "playpause";
            break;
        case "com.laoy.streamdock.applemusic.previous":
            endpoint = "previous";
            break;
        case "com.laoy.streamdock.applemusic.next":
            endpoint = "next";
            break;
        case "com.laoy.streamdock.applemusic.volumeup":
            endpoint = "volumeup";
            break;
        case "com.laoy.streamdock.applemusic.volumedown":
            endpoint = "volumedown";
            break;
        case "com.laoy.streamdock.applemusic.shuffle":
            endpoint = "shuffle";
            break;
        case "com.laoy.streamdock.applemusic.repeat":
            endpoint = "repeat";
            break;
        case "com.laoy.streamdock.applemusic.songinfo":
            endpoint = "playpause";
            break;
        case "com.laoy.streamdock.applemusic.love":
            endpoint = "togglelove";
            break;
        case "com.laoy.streamdock.applemusic.addtolibrary":
            endpoint = "addtolibrary";
            break;
        case "com.laoy.streamdock.applemusic.seekforward":
            endpoint = "seekforward";
            break;
        case "com.laoy.streamdock.applemusic.seekbackward":
            endpoint = "seekbackward";
            break;
        case "com.laoy.streamdock.applemusic.clearqueue":
            endpoint = "clearqueue";
            break;
        case "com.laoy.streamdock.applemusic.volumecontrol":
            endpoint = "mute";
            break;
        case "com.laoy.streamdock.applemusic.previousornext":
            endpoint = "playpause";
            break;
        case "com.laoy.streamdock.applemusic.seekcontrol":
            endpoint = "playpause";
            break;
        default:
            console.warn("[AppleMusic] Unsupported action:", action);
            return;
    }

    // 1. Direct local execution against Cider API (always works, ultra-fast)
    ciderAPI.executeCommand(endpoint, {});

    // 2. Also forward to Crimsons sidecar if connected
    if (crimsonAPI.ws && crimsonAPI.ws.readyState === WebSocket.OPEN) {
        crimsonAPI.send({
            type: "APPLE_MUSIC_COMMAND",
            endpoint: endpoint,
            payload: {}
        });
    }
}

function formatTime(ms) {
    if (!ms || ms < 0) return "0:00";
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return mins + ":" + secs.toString().padStart(2, '0');
}

function handleDialRotate(action, ticks) {
    if (action === "com.laoy.streamdock.applemusic.volumecontrol") {
        ciderAPI.executeCommand("volumecontrol", { ticks: ticks });
        if (crimsonAPI.ws && crimsonAPI.ws.readyState === WebSocket.OPEN) {
            crimsonAPI.send({
                type: "APPLE_MUSIC_COMMAND",
                endpoint: "volumecontrol",
                payload: { ticks: ticks }
            });
        }
    } else if (action === "com.laoy.streamdock.applemusic.previousornext") {
        ciderAPI.executeCommand("skip", { ticks: ticks > 0 ? 1 : -1 });
        if (crimsonAPI.ws && crimsonAPI.ws.readyState === WebSocket.OPEN) {
            crimsonAPI.send({
                type: "APPLE_MUSIC_COMMAND",
                endpoint: "skip",
                payload: { ticks: ticks > 0 ? 1 : -1 }
            });
        }
    } else if (action === "com.laoy.streamdock.applemusic.seekcontrol") {
        ciderAPI.executeCommand("seekrelative", { ticks: ticks });
        if (crimsonAPI.ws && crimsonAPI.ws.readyState === WebSocket.OPEN) {
            crimsonAPI.send({
                type: "APPLE_MUSIC_COMMAND",
                endpoint: "seekrelative",
                payload: { ticks: ticks }
            });
        }
    }
}

function applyNowPlaying(state) {
    updateActionState(
        "com.laoy.streamdock.applemusic.playpause",
        state.is_playing ? 1 : 0
    );
    updateActionState(
        "com.laoy.streamdock.applemusic.shuffle",
        state.shuffle_state ? 1 : 0
    );
    updateActionState(
        "com.laoy.streamdock.applemusic.repeat",
        (state.repeat_state && state.repeat_state !== "none") ? 1 : 0
    );
    updateActionState(
        "com.laoy.streamdock.applemusic.love",
        state.in_favorites ? 1 : 0
    );
    updateActionState(
        "com.laoy.streamdock.applemusic.addtolibrary",
        state.in_library ? 1 : 0
    );
    updateActionState(
        "com.laoy.streamdock.applemusic.volumecontrol",
        state.volume_percent === 0 ? 1 : 0
    );
    setTitleForAction(
        "com.laoy.streamdock.applemusic.volumecontrol",
        state.cider_connected ? (state.volume_percent + "%") : "—"
    );
    updateActionState(
        "com.laoy.streamdock.applemusic.previousornext",
        state.is_playing ? 1 : 0
    );
    setTitleForAction(
        "com.laoy.streamdock.applemusic.previousornext",
        state.is_playing ? "Lecture" : "Pause"
    );
    setTitleForAction(
        "com.laoy.streamdock.applemusic.seekcontrol",
        state.duration_ms ? (formatTime(state.progress_ms) + "\n" + formatTime(state.duration_ms)) : ""
    );

    let title = "";
    if (state.cider_connected) {
        if (state.album_art) {
            // Option 1: Clean cover art only (no overlapping text)
            title = "";
        } else if (state.track_name) {
            const cleanTrack = state.track_name.replace(/\s*[\(\[](feat\.|ft\.|with).*?[\)\]]/i, "").trim();
            const cleanArtist = (state.artist_name || "").trim();
            title = cleanArtist
                ? `${cleanTrack.slice(0, 12)}\n${cleanArtist.slice(0, 12)}`
                : cleanTrack.slice(0, 14);
        } else {
            title = "Apple Music";
        }
    } else {
        title = "Cider off";
    }
    setTitleForAction("com.laoy.streamdock.applemusic.songinfo", title);

    if (state.album_art) {
        if (lastAlbumArt !== state.album_art) {
            lastAlbumArt = state.album_art;
            crimsonAPI.toBase64(state.album_art).then(b64 => {
                if (b64) {
                    setImageForAction("com.laoy.streamdock.applemusic.songinfo", b64);
                }
            });
        }
    } else if (lastAlbumArt !== "") {
        lastAlbumArt = "";
        setImageForAction("com.laoy.streamdock.applemusic.songinfo", "static/icon/songinfo.png");
    }
}

function setTitleForAction(action, title) {
    const contexts = actionContexts[action] || [];
    contexts.forEach(context => {
        const json = { "event": "setTitle", "context": context, "payload": { "title": title, "target": 0 } };
        if (streamDeckSocket && streamDeckSocket.readyState === WebSocket.OPEN) {
            streamDeckSocket.send(JSON.stringify(json));
        } else if (crimsonAPI.ws && crimsonAPI.ws.readyState === WebSocket.OPEN) {
            crimsonAPI.send({ type: "FORWARD_TO_STREAMDOCK", payload: json });
        }
    });
}

function setImageForAction(action, image) {
    const contexts = actionContexts[action] || [];
    contexts.forEach(context => {
        const json = { "event": "setImage", "context": context, "payload": { "image": image, "target": 0 } };
        if (streamDeckSocket && streamDeckSocket.readyState === WebSocket.OPEN) {
            streamDeckSocket.send(JSON.stringify(json));
        } else if (crimsonAPI.ws && crimsonAPI.ws.readyState === WebSocket.OPEN) {
            crimsonAPI.send({ type: "FORWARD_TO_STREAMDOCK", payload: json });
        }
    });
}

function updateActionState(action, state) {
    const contexts = actionContexts[action] || [];
    contexts.forEach(context => {
        const json = { "event": "setState", "context": context, "payload": { "state": state } };
        if (streamDeckSocket && streamDeckSocket.readyState === WebSocket.OPEN) {
            streamDeckSocket.send(JSON.stringify(json));
        } else if (crimsonAPI.ws && crimsonAPI.ws.readyState === WebSocket.OPEN) {
            crimsonAPI.send({ type: "FORWARD_TO_STREAMDOCK", payload: json });
        }
    });
}

// Background autonomous state polling from Cider (updates UI every 900ms)
setInterval(async () => {
    const st = await ciderAPI.fetchState();
    if (st) {
        applyNowPlaying(st);
    }
}, 900);

window.connectElgatoStreamDeckSocket = connectElgatoStreamDeckSocket;
