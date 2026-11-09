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
    "com.laoy.streamdock.applemusic.clearqueue": []
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
    }

    if (event === "willDisappear") {
        if (actionContexts[action]) {
            actionContexts[action] = actionContexts[action].filter(c => c !== context);
        }
    }

    if (event === "keyDown") {
        handleKeyDown(action);
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
            console.warn("[AppleMusic] Crimson connection closed. Reconnecting in 2s...");
            setTimeout(() => this.connect(), 2000);
            setTimeout(() => {
                if (!streamDeckSocket || streamDeckSocket.readyState === WebSocket.CLOSED) {
                    if (window.connectHw) window.connectHw();
                }
            }, 1000);
        };
        this.ws.onerror = () => {
            this.ws.close();
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
        };

        streamDeckSocket.onclose = function () {
            streamDeckSocket = null;
            setTimeout(() => connectHw(), 3000);
        };

        streamDeckSocket.onerror = function () {
            streamDeckSocket.close();
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
    if (!crimsonAPI.ws || crimsonAPI.ws.readyState !== WebSocket.OPEN) {
        console.warn("[AppleMusic] keyDown ignored: crimson-server not connected");
        return;
    }

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
            endpoint = "songinfo";
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
        default:
            console.warn("[AppleMusic] Unsupported action:", action);
            return;
    }

    console.log(`[AppleMusic] Executing ${endpoint} via Cider...`);
    crimsonAPI.send({
        type: "APPLE_MUSIC_COMMAND",
        endpoint: endpoint,
        payload: {}
    });
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

    let title = "Cider off";
    if (state.cider_connected) {
        if (state.track_name) {
            title = state.artist_name 
                ? `${state.track_name.slice(0, 16)}\n${state.artist_name.slice(0, 16)}`
                : state.track_name.slice(0, 24);
        } else {
            title = "—";
        }
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

window.connectElgatoStreamDeckSocket = connectElgatoStreamDeckSocket;
