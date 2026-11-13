/**
 * Volume / Wave Link StreamDock plugin.
 * Talks to crimson-server WS on 127.0.0.1:40510 (VOLUME_STATE / VOLUME_COMMAND).
 */
const UUID = {
    master_up: "com.laoy.streamdock.volume.master_up",
    master_down: "com.laoy.streamdock.volume.master_down",
    master_mute: "com.laoy.streamdock.volume.master_mute",
    level: "com.laoy.streamdock.volume.level",
    track_prev: "com.laoy.streamdock.volume.track_prev",
    track_next: "com.laoy.streamdock.volume.track_next",
    track_up: "com.laoy.streamdock.volume.track_up",
    track_down: "com.laoy.streamdock.volume.track_down",
    track_mute: "com.laoy.streamdock.volume.track_mute",
    refresh: "com.laoy.streamdock.volume.refresh",
    openhub: "com.laoy.streamdock.volume.openhub",
};

const actionContexts = {};
Object.keys(UUID).forEach((k) => {
    actionContexts[UUID[k]] = [];
});

let volumeState = {
    connected: false,
    mock: true,
    master_level: 0,
    master_muted: false,
    tracks: [],
    selected_track_index: 0,
    wavelink: { available: false, connected: false, status: "" },
    error: null,
};

const STORE_URL = "https://store.crimsons.app/plugins/volume";
const HUB_FALLBACK = "http://127.0.0.1:5173/";

const crimsonAPI = new CrimsonAPI(40510);
window.crimsonAPI = crimsonAPI;

function trackContext(uuid, context, appear) {
    const list = actionContexts[uuid];
    if (!list) return;
    const i = list.indexOf(context);
    if (appear && i < 0) list.push(context);
    if (!appear && i >= 0) list.splice(i, 1);
}

function pct(level) {
    if (typeof level !== "number" || isNaN(level)) return "—";
    return Math.round(Math.max(0, Math.min(1, level)) * 100) + "%";
}

function selectedTrack() {
    const tracks = volumeState.tracks || [];
    if (!tracks.length) return null;
    const idx = Math.max(0, Math.min(volumeState.selected_track_index || 0, tracks.length - 1));
    return tracks[idx];
}

function formatMasterTitle() {
    const mute = volumeState.master_muted ? "MUTE" : pct(volumeState.master_level);
    return "Master\n" + mute;
}

function formatLevelTitle() {
    const t = selectedTrack();
    const master = volumeState.master_muted ? "M MUTE" : "M " + pct(volumeState.master_level);
    if (!t) return master + "\n—";
    const idx = (volumeState.selected_track_index || 0) + 1;
    const total = (volumeState.tracks || []).length;
    const mute = t.muted ? "MUTE" : pct(t.level);
    const name = (t.name || "?").slice(0, 12);
    return master + "\n" + name + "\n" + mute + " " + idx + "/" + total;
}

function formatTrackMuteTitle() {
    const t = selectedTrack();
    if (!t) return "Mute\n—";
    return (t.muted ? "UNMUTE" : "MUTE") + "\n" + (t.name || "?").slice(0, 12);
}

function paintAll() {
    for (const ctx of actionContexts[UUID.master_up] || []) {
        ui.setTitle(ctx, "Vol +\n" + pct(volumeState.master_level));
    }
    for (const ctx of actionContexts[UUID.master_down] || []) {
        ui.setTitle(ctx, "Vol −\n" + pct(volumeState.master_level));
    }
    for (const ctx of actionContexts[UUID.master_mute] || []) {
        ui.setTitle(ctx, formatMasterTitle());
    }
    for (const ctx of actionContexts[UUID.level] || []) {
        ui.setTitle(ctx, formatLevelTitle());
    }
    for (const ctx of actionContexts[UUID.track_mute] || []) {
        ui.setTitle(ctx, formatTrackMuteTitle());
    }
    const t = selectedTrack();
    const trackLabel = t ? (t.name || "?").slice(0, 10) : "—";
    for (const ctx of actionContexts[UUID.track_up] || []) {
        ui.setTitle(ctx, trackLabel + "\n+ " + (t ? pct(t.level) : ""));
    }
    for (const ctx of actionContexts[UUID.track_down] || []) {
        ui.setTitle(ctx, trackLabel + "\n− " + (t ? pct(t.level) : ""));
    }
}

function sendCommand(endpoint, payload) {
    crimsonAPI.send({
        type: "VOLUME_COMMAND",
        endpoint: endpoint,
        payload: payload || {},
    });
}

function openHubOrStore() {
    const url = STORE_URL;
    try {
        if (ui.socket && ui.socket.readyState === WebSocket.OPEN) {
            ui.socket.send(JSON.stringify({ event: "openUrl", payload: { url: url } }));
            return;
        }
    } catch (e) {}
    try {
        if (typeof require === "function") {
            const { shell } = require("electron");
            if (shell && shell.openExternal) {
                shell.openExternal(url);
                return;
            }
        }
    } catch (e2) {}
    try {
        window.open(url || HUB_FALLBACK, "_blank");
    } catch (e3) {}
}

window.handleCrimsonMessage = function (data) {
    if (!data || !data.type) return;
    if (data.type === "VOLUME_STATE" && data.data) {
        volumeState = Object.assign({}, volumeState, data.data);
        paintAll();
    }
    if (data.type === "AUTH_ERROR" || data.type === "FEATURE_UNAVAILABLE") {
        console.warn("[Volume]", data.message || data.type);
    }
};

function handleActionClick(uuid) {
    switch (uuid) {
        case UUID.master_up:
            sendCommand("master_up");
            break;
        case UUID.master_down:
            sendCommand("master_down");
            break;
        case UUID.master_mute:
            sendCommand("master_mute");
            break;
        case UUID.track_prev:
            sendCommand("track_prev");
            break;
        case UUID.track_next:
            sendCommand("track_next");
            break;
        case UUID.track_up:
            sendCommand("track_up");
            break;
        case UUID.track_down:
            sendCommand("track_down");
            break;
        case UUID.track_mute:
            sendCommand("track_mute");
            break;
        case UUID.refresh:
        case UUID.level:
            sendCommand("refresh");
            break;
        case UUID.openhub:
            openHubOrStore();
            break;
        default:
            break;
    }
}

let websocket = null;
let pluginUUID = null;

function connectElgatoStreamDeckSocket(inPort, inPluginUUID, inRegisterEvent, inInfo) {
    pluginUUID = inPluginUUID;
    websocket = new WebSocket("ws://127.0.0.1:" + inPort);
    ui.setSocket(websocket);

    websocket.onopen = function () {
        websocket.send(JSON.stringify({
            event: inRegisterEvent,
            uuid: inPluginUUID,
        }));
        sendCommand("refresh");
    };

    websocket.onmessage = function (evt) {
        let jsonObj;
        try {
            jsonObj = JSON.parse(evt.data);
        } catch (e) {
            return;
        }
        const event = jsonObj.event;
        const context = jsonObj.context;
        const action = jsonObj.action;
        const payload = jsonObj.payload || {};

        if (event === "willAppear" && action) {
            trackContext(action, context, true);
            paintAll();
        }
        if (event === "willDisappear" && action) {
            trackContext(action, context, false);
        }
        if (event === "keyDown" || (event === "dialPress" && payload.pressed)) {
            handleActionClick(action);
        }
        // Dial rotate on Level key: scroll tracks; on Track Up/Down: adjust volume.
        if (event === "dialRotate") {
            const ticks = payload.ticks || 0;
            if (action === UUID.level) {
                if (ticks > 0) sendCommand("track_next");
                else if (ticks < 0) sendCommand("track_prev");
            } else if (action === UUID.track_up || action === UUID.track_down || action === UUID.master_up || action === UUID.master_down) {
                if (ticks > 0) sendCommand(action === UUID.master_up || action === UUID.master_down ? "master_up" : "track_up");
                else if (ticks < 0) sendCommand(action === UUID.master_up || action === UUID.master_down ? "master_down" : "track_down");
            }
        }
    };
}

window.connectElgatoStreamDeckSocket = connectElgatoStreamDeckSocket;

sendCommand("refresh");
