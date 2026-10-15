/// <reference path="streamdeck_ui.js" />
const actionContexts = {};
const contextSettings = {};


const actionImageCache = {};
const actionUrlCache = {};
let clearArtTimeout = null;

// ==========================================
// CRIMSON BACKEND CONNECT (Stand-alone)
// ==========================================
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

const crimsonAPI = {
    ws: null,
    queue: [],
    currentPort: 40510,
    onOpen: null,
    connect() {
        this.ws = new WebSocket(crimsonWsUrl(this.currentPort));
        this.ws.onopen = () => {
            console.log(`Crimson Plugin: Connected to Backend on port ${this.currentPort}.`);
            if (this.onOpen) {
                this.onOpen();
            }
            while (this.queue.length > 0) {
                this.ws.send(JSON.stringify(this.queue.shift()));
            }
        };
        this.ws.onmessage = async (e) => {
            try {
                const data = JSON.parse(e.data);
                
                // If the message is a raw event from the Rust Proxy Bridge, forward it to the native handler!
                if (data.event && !data.type) {
                    if (window.streamDeckSocket && typeof window.streamDeckSocket.onmessage === 'function') {
                        // Create a fake MessageEvent object and pass it to the handler
                        window.streamDeckSocket.onmessage({ data: e.data });
                    }
                    // Continue with normal processing
                }
                
                if (data.type === "SPOTIFY_STATE" && data.data) {
                    const state = data.data;
                    
                    // Update Play/Pause state
                    const playPauseContexts = actionContexts["com.laoy.streamdock.spotify.playpause"] || [];
                    const playPauseVal = state.is_playing ? 1 : 0;
                    playPauseContexts.forEach(ctx => {
                        ui.setState(ctx, playPauseVal);
                    });
                    
                    // Update Shuffle state
                    const shuffleContexts = actionContexts["com.laoy.streamdock.spotify.shuffle"] || [];
                    let shuffleVal = 0;
                    if (state.shuffle_state) {
                        shuffleVal = state.smart_shuffle ? 2 : 1;
                    }
                    shuffleContexts.forEach(ctx => {
                        ui.setState(ctx, shuffleVal);
                    });

                    // Update Repeat state
                    const repeatContexts = actionContexts["com.laoy.streamdock.spotify.repeat"] || [];
                    let repeatVal = 0;
                    if (state.repeat_state === "context") repeatVal = 1;
                    else if (state.repeat_state === "track") repeatVal = 2;
                    
                    repeatContexts.forEach(ctx => {
                        ui.setState(ctx, repeatVal);
                    });

                    // Optimistically update album art immediately
                    const playPauseContextsAll = actionContexts["com.laoy.streamdock.spotify.playpause"] || [];
                    const songInfoContexts = actionContexts["com.laoy.streamdock.spotify.songinfo"] || [];
                    if (state.album_art) {
                        if (clearArtTimeout) {
                            clearTimeout(clearArtTimeout);
                            clearArtTimeout = null;
                        }
                        playPauseContextsAll.forEach(ctx => {
                            handleSetImage({ context: ctx, payload: { image: state.album_art } });
                        });
                        songInfoContexts.forEach(ctx => {
                            handleSetImage({ context: ctx, payload: { image: state.album_art } });
                        });
                    } else {
                        // Only clear album art if there is no active track and player is not playing
                        const hasActiveTrack = state.track_name && state.track_name !== "Unknown" && state.track_name !== "";
                        if (!hasActiveTrack && !state.is_playing) {
                            if (!clearArtTimeout) {
                                clearArtTimeout = setTimeout(() => {
                                    playPauseContextsAll.forEach(ctx => {
                                        handleSetImage({ context: ctx, payload: { image: null } });
                                    });
                                    songInfoContexts.forEach(ctx => {
                                        handleSetImage({ context: ctx, payload: { image: null } });
                                    });
                                    clearArtTimeout = null;
                                }, 3000); // 3 seconds delay before clearing art to prevent blinking during transitions
                            }
                        } else {
                            if (clearArtTimeout) {
                                clearTimeout(clearArtTimeout);
                                clearArtTimeout = null;
                            }
                        }
                    }

                    // Update Titles and Timers
                    Object.keys(actionContexts).forEach(action => {
                        if (action.includes("playpause") || action.includes("songinfo") || action.includes("previousornext")) {
                            actionContexts[action].forEach(ctx => {
                                updateButtonTitle(ctx, action, state);
                            });
                        }
                    });
                }
                
                if (data.event === "setImageBroadcast" && data.payload) {
                    const img = data.payload.image;
                    Object.keys(actionContexts).forEach(action => {
                        // Only broadcast current cover art to actions meant for cover display (playpause & songinfo)
                        if (action.includes("playpause") || action.includes("songinfo")) {
                            actionContexts[action].forEach(ctx => {
                                handleSetImage({ context: ctx, payload: { image: img } });
                            });
                        }
                    });
                } else if (data.event === "setImage") {
                    handleSetImage(data);
                } else if (data.event) {
                    ui.send(data);
                }
            } catch (err) {}
        };
        this.ws.onclose = () => {
            this.currentPort = 40510;
            setTimeout(() => this.connect(), 2000);
            
            // Reconnect hardware socket since backend is down!
            setTimeout(() => {
                if (!window.streamDeckSocket || window.streamDeckSocket.readyState === WebSocket.CLOSED) {
                    if (window.connectHw) {
                        window.connectHw();
                    }
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

function formatTime(ms) {
    if (!ms || ms < 0) return "0:00";
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function updateButtonTitle(context, action, state) {
    const settings = contextSettings[context] || {};
    
    // Default settings based on manifest
    let showTitle = true;
    if (settings.showTitle !== undefined) showTitle = settings.showTitle;
    
    let titleFormat = "title-artist";
    if (action.includes("songinfo")) {
        titleFormat = settings.mode || "title-artist";
    } else {
        titleFormat = settings.titleFormat || "title-artist";
    }
    
    let timeDisplay = "none";
    if (action.includes("playpause") || action.includes("previousornext")) {
        timeDisplay = settings.timeDisplay || "elapsed";
    } else if (action.includes("songinfo")) {
        timeDisplay = settings.timeDisplay || "remaining";
    }
    
    // Build title parts
    let titleParts = [];
    if (showTitle) {
        const trackName = state.track_name || "";
        const artistName = state.artist_name || state.track_artist || "";
        
        if (titleFormat === "title-artist" && trackName && artistName) {
            titleParts.push(trackName);
            titleParts.push(artistName);
        } else if (titleFormat === "artist" && artistName) {
            titleParts.push(artistName);
        } else if (trackName) {
            titleParts.push(trackName);
        }
    }
    
    // Build time part
    if (timeDisplay === "elapsed" && state.progress_ms !== undefined) {
        titleParts.push(formatTime(state.progress_ms));
    } else if (timeDisplay === "remaining" && state.progress_ms !== undefined && state.duration_ms !== undefined) {
        const remaining = state.duration_ms - state.progress_ms;
        titleParts.push("-" + formatTime(remaining));
    }
    
    const finalTitle = titleParts.join("\n");
    ui.setTitle(context, finalTitle);
}

async function handleSetImage(data) {
    const ctx = data.context;
    let img = data.payload?.image;
    if (!ctx) return;

    if (!img) {
        if (actionImageCache[ctx] !== null) {
            ui.send({
                event: "setImage",
                context: ctx,
                payload: {
                    image: null,
                    target: 0
                }
            });
            actionImageCache[ctx] = null;
            delete actionUrlCache[ctx];
        }
        return;
    }

    // Fast URL cache check
    if (actionUrlCache[ctx] === img) return;

    // Convert URL to Base64 if needed
    if (img.startsWith("http")) {
        const base64 = await crimsonAPI.toBase64(img);
        if (base64) {
            actionUrlCache[ctx] = img; // Store URL
            img = base64;
        } else {
            return; // Don't send broken images
        }
    }

    if (actionImageCache[ctx] !== img) {
        ui.send({
            event: "setImage",
            context: ctx,
            payload: {
                image: img,
                target: 0
            }
        });
        actionImageCache[ctx] = img;
    }
}

function handleActionClick(action, context, settings) {
    const actionKey = action.replace("com.laoy.streamdock.spotify.", "");
    let endpoint = actionKey;
    
    if (actionKey === "playpause") endpoint = "playpause";
    if (actionKey === "previous") endpoint = "prev";
    if (actionKey === "playplaylist") endpoint = "play";
    
    crimsonAPI.send({ 
        type: "SPOTIFY_COMMAND", 
        endpoint: endpoint,
        payload: settings 
    });
}

function updateDisplayLogic(context, action) {
    // Exclude play/pause and dial actions so their progress timers and text labels remain fully visible
    if (action.includes("playpause") || action.includes("previousornext")) {
        return;
    }
    if (action.includes("play") || action.includes("pause") || action.includes("art") || action.includes("track")) {
        // Backend handles images
        ui.setTitle(context, ""); 
    }
}

window.connectElgatoStreamDeckSocket = function(inPort, inPluginUUID, inRegisterEvent, inInfo) {
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
        // Always own the StreamDock socket. REGISTER_STREAMDOCK handover is
        // unreliable for HTML plugins: willAppear may reach crimson-server while
        // keyDown stays on this connection and was previously dropped.
        if (window.streamDeckSocket &&
            (window.streamDeckSocket.readyState === WebSocket.OPEN ||
             window.streamDeckSocket.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const streamDeckSocket = new WebSocket("ws://127.0.0.1:" + inPort);
        window.streamDeckSocket = streamDeckSocket;
        ui.setSocket(streamDeckSocket);

        streamDeckSocket.onopen = function () {
            streamDeckSocket.send(JSON.stringify({ "event": inRegisterEvent, "uuid": inPluginUUID }));
        };

        streamDeckSocket.onclose = function () {
            console.warn("Crimson Plugin: Hardware socket closed.");
            window.streamDeckSocket = null;
            setTimeout(() => connectHw(), 3000);
        };

        streamDeckSocket.onerror = function () {
            streamDeckSocket.close();
        };

        let lastClickTime = 0;
        streamDeckSocket.onmessage = function (evt) {
            const jsonObj = JSON.parse(evt.data);
            const event = jsonObj['event'];
            const action = jsonObj['action'];
            const context = jsonObj['context'];

            // Forward hardware events (including keyDown) for server logs / PI sync.
            // Presses are executed via handleActionClick → SPOTIFY_COMMAND below:
            // the Rust StreamDock handover often never sees keyDown on AJAZZ.
            if (event === "propertyInspectorDidAppear" || event === "propertyInspectorDidDisappear" || event === "sendToPlugin" || event === "didReceiveSettings" || event === "didReceiveGlobalSettings" || event === "willAppear" || event === "willDisappear" || event === "keyDown" || event === "keyUp" || event === "dialPress" || event === "dialRotate") {
                crimsonAPI.send(jsonObj);
            }

            if (event === "willAppear") {
                // Force bypass image cache on new appearance
                delete actionUrlCache[context];
                delete actionImageCache[context];

                if (!actionContexts[action]) actionContexts[action] = [];
                if (!actionContexts[action].includes(context)) {
                    actionContexts[action].push(context);
                }
                if (jsonObj['payload']?.settings) {
                    const settings = jsonObj['payload'].settings;
                    contextSettings[context] = settings;
                    if (action.includes("playplaylist") && (settings.playlist_image || settings.image)) {
                        handleSetImage({ context: context, payload: { image: settings.playlist_image || settings.image } });
                    }
                }
                updateDisplayLogic(context, action);
            }

            if (event === "willDisappear") {
                // Clear caches and active context tracking when a button goes off-screen
                delete actionUrlCache[context];
                delete actionImageCache[context];
                if (actionContexts[action]) {
                    actionContexts[action] = actionContexts[action].filter(c => c !== context);
                }
            }

            if (event === "didReceiveSettings") {
                // Clear caches on settings updates to force redraw
                delete actionUrlCache[context];
                delete actionImageCache[context];

                if (jsonObj['payload']?.settings) {
                    const settings = jsonObj['payload'].settings;
                    contextSettings[context] = settings;
                    if (action.includes("playplaylist") && (settings.playlist_image || settings.image)) {
                        handleSetImage({ context: context, payload: { image: settings.playlist_image || settings.image } });
                    }
                }
            }

            // AJAZZ delivers keyDown to this HTML plugin socket; the Rust handover
            // rarely sees presses. Emit SPOTIFY_COMMAND (works on all sidecars).
            if (event === "keyDown" || (event === "dialPress" && jsonObj['payload']?.pressed)) {
                const now = Date.now();
                if (now - lastClickTime > 200) {
                    lastClickTime = now;
                    const settings = contextSettings[context] || (jsonObj['payload'] && jsonObj['payload'].settings) || {};
                    handleActionClick(action, context, settings);
                }
            }

            if (event === "dialRotate") {
                const ticks = (jsonObj['payload'] && jsonObj['payload'].ticks) || 0;
                if (action === "com.laoy.streamdock.spotify.volumecontrol") {
                    crimsonAPI.send({ type: "SPOTIFY_COMMAND", endpoint: "volumecontrol", payload: { ticks: ticks } });
                } else if (action === "com.laoy.streamdock.spotify.previousornext") {
                    crimsonAPI.send({ type: "SPOTIFY_COMMAND", endpoint: "skip", payload: { ticks: ticks > 0 ? 1 : -1 } });
                }
            }
        };
    };

    window.connectHw = connectHw;
    connectHw();
}
