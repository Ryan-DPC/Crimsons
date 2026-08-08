let streamDeckSocket = null;
let globalPluginUUID = "";
let actionContexts = {
    "com.laoy.streamdock.discord.togglemute": [],
    "com.laoy.streamdock.discord.toggledeafen": [],
    "com.laoy.streamdock.discord.joinvoice": [],
    "com.laoy.streamdock.discord.togglecamera": []
};
/** @type {Record<string, { channelId?: string }>} */
let settingsByContext = {};

let currentVoiceSettings = { mute: false, deaf: false };
let currentVideoState = { cameraOn: false };

function crimsonAuthToken() {
    try {
        var fs = require('fs');
        var path = require('path');
        var tokenPath = path.join(process.env.APPDATA || '', 'com.laoy.crimsons', 'auth.token');
        return (fs.readFileSync(tokenPath, 'utf8') || '').trim();
    } catch (e) {
        try {
            var shell = new ActiveXObject('WScript.Shell');
            var fso = new ActiveXObject('Scripting.FileSystemObject');
            var p = shell.ExpandEnvironmentStrings('%APPDATA%\\com.laoy.crimsons\\auth.token');
            if (!fso.FileExists(p)) return '';
            var f = fso.OpenTextFile(p, 1);
            var t = f.ReadAll();
            f.Close();
            return (t || '').trim();
        } catch (e2) {
            return '';
        }
    }
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
    const payload = jsonObj['payload'] || {};

    if (!event) return;

    if (event === "willAppear") {
        if (actionContexts[action] && !actionContexts[action].includes(context)) {
            actionContexts[action].push(context);
        }
        if (payload.settings) {
            settingsByContext[context] = payload.settings;
        }
    }

    if (event === "willDisappear") {
        if (actionContexts[action]) {
            actionContexts[action] = actionContexts[action].filter(c => c !== context);
        }
        delete settingsByContext[context];
    }

    if (event === "didReceiveSettings") {
        settingsByContext[context] = payload.settings || {};
    }

    // When the Crimson bridge owns the StreamDock socket, keyDown is handled
    // server-side. Still handle locally for the fallback direct-HW path.
    if (event === "keyDown") {
        handleKeyDown(action, context);
    }
}

const crimsonAPI = {
    ws: null,
    queue: [],
    onOpen: null,
    connect() {
        this.ws = new WebSocket(crimsonWsUrl(40510));
        this.ws.onopen = () => {
            console.log("[Discord] Connected to Crimson Backend on 40510.");
            if (this.onOpen) {
                this.onOpen();
            }
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
                if (data.type === "DISCORD_STATE" && data.data) {
                    const state = data.data;
                    currentVoiceSettings.mute = state.is_muted;
                    currentVoiceSettings.deaf = state.is_deaf;
                    currentVideoState.cameraOn = state.is_camera_on;

                    updateActionState("com.laoy.streamdock.discord.togglemute", state.is_muted ? 1 : 0);
                    updateActionState("com.laoy.streamdock.discord.toggledeafen", state.is_deaf ? 1 : 0);
                    updateActionState("com.laoy.streamdock.discord.togglecamera", state.is_camera_on ? 1 : 0);
                }
                // Hardware events rebroadcast by the Crimson StreamDock bridge
                if (data.event) {
                    handleHardwareEvent(data);
                }
            } catch (e) {
                console.error("[Discord] Error parsing Crimson message", e);
            }
        };
        this.ws.onclose = () => {
            console.warn("[Discord] Crimson connection closed. Reconnecting in 2s...");
            setTimeout(() => this.connect(), 2000);

            setTimeout(() => {
                if (!streamDeckSocket || streamDeckSocket.readyState === WebSocket.CLOSED) {
                    if (window.connectHw) {
                        window.connectHw();
                    }
                }
            }, 1000);
        };
        this.ws.onerror = (err) => {
            console.error("[Discord] Crimson connection error", err);
            this.ws.close();
        };
    },
    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        } else {
            this.queue.push(data);
        }
    }
};
crimsonAPI.connect();

/**
 * Entry point for StreamDock Plugin
 */
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
        if (crimsonAPI.ws && crimsonAPI.ws.readyState === WebSocket.OPEN) {
            console.log("[Discord] Crimson Server is active. Skipping direct hardware connection.");
            return;
        }

        streamDeckSocket = new WebSocket("ws://127.0.0.1:" + inPort);

        streamDeckSocket.onopen = function () {
            const json = { "event": inRegisterEvent, "uuid": inPluginUUID };
            streamDeckSocket.send(JSON.stringify(json));
        };

        streamDeckSocket.onclose = function () {
            console.warn("[Discord] Hardware socket closed.");
            setTimeout(() => {
                if (!crimsonAPI.ws || crimsonAPI.ws.readyState !== WebSocket.OPEN) {
                    connectHw();
                }
            }, 3000);
        };

        streamDeckSocket.onerror = function () {
            streamDeckSocket.close();
        };

        streamDeckSocket.onmessage = function (evt) {
            try {
                handleHardwareEvent(JSON.parse(evt.data));
            } catch (e) {
                console.error("[Discord] Hardware message error", e);
            }
        };
    };

    window.connectHw = connectHw;
    connectHw();
}

function handleKeyDown(action, context) {
    // Prefer server-side handling when Crimson bridge owns the socket
    // (avoids duplicate commands). Local path covers Crimson-offline fallback.
    if (crimsonAPI.ws && crimsonAPI.ws.readyState === WebSocket.OPEN) {
        return;
    }

    let execAction = null;
    let execParams = {};

    switch (action) {
        case "com.laoy.streamdock.discord.togglemute":
            execAction = 'toggleMute';
            break;
        case "com.laoy.streamdock.discord.toggledeafen":
            execAction = 'toggleDeafen';
            break;
        case "com.laoy.streamdock.discord.joinvoice": {
            const channelId = (settingsByContext[context] && settingsByContext[context].channelId || '').trim();
            if (!channelId) {
                console.warn("[Discord] Voice Channel: configure channelId in the Property Inspector.");
                return;
            }
            execAction = 'joinVoiceChannel';
            execParams = { channelId: channelId };
            break;
        }
        case "com.laoy.streamdock.discord.togglecamera":
            execAction = 'toggleCamera';
            break;
        default:
            console.warn("[Discord] Unsupported action:", action);
            return;
    }

    if (execAction) {
        console.log(`[Discord] Executing ${execAction}...`);
        crimsonAPI.send({
            type: "DISCORD_COMMAND",
            endpoint: execAction,
            payload: execParams
        });
    }
}

function updateActionState(action, state) {
    const contexts = actionContexts[action] || [];
    contexts.forEach(context => {
        const json = { "event": "setState", "context": context, "payload": { "state": state } };
        if (streamDeckSocket && streamDeckSocket.readyState === WebSocket.OPEN) {
            streamDeckSocket.send(JSON.stringify(json));
        } else if (crimsonAPI.ws && crimsonAPI.ws.readyState === WebSocket.OPEN) {
            crimsonAPI.send({
                type: "FORWARD_TO_STREAMDOCK",
                payload: json
            });
        }
    });
}

window.connectElgatoStreamDeckSocket = connectElgatoStreamDeckSocket;
