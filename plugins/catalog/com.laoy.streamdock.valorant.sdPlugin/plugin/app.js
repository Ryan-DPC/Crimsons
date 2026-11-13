/**
 * Valorant info-only StreamDock plugin (MVP stub).
 * Talks to crimson-server WS on 127.0.0.1:40510 — no client control / Vanguard.
 */
const UUID = {
    rank: "com.laoy.streamdock.valorant.rank",
    lastmatch: "com.laoy.streamdock.valorant.lastmatch",
    match_prev: "com.laoy.streamdock.valorant.match_prev",
    match_next: "com.laoy.streamdock.valorant.match_next",
    refresh: "com.laoy.streamdock.valorant.refresh",
    openhub: "com.laoy.streamdock.valorant.openhub",
};

const actionContexts = {
    [UUID.rank]: [],
    [UUID.lastmatch]: [],
    [UUID.match_prev]: [],
    [UUID.match_next]: [],
    [UUID.refresh]: [],
    [UUID.openhub]: [],
};

let valorantState = {
    connected: false,
    mock: true,
    rank: { tier: "—", rr: 0, episode: "" },
    matches: [],
    match_index: 0,
    error: null,
};

const STORE_URL = "https://store.crimsons.app/plugins/valorant";
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

function currentMatch() {
    const matches = valorantState.matches || [];
    if (!matches.length) return null;
    const idx = Math.max(0, Math.min(valorantState.match_index || 0, matches.length - 1));
    return matches[idx];
}

function formatRankTitle() {
    const r = valorantState.rank || {};
    const tier = r.tier || "—";
    const rr = typeof r.rr === "number" ? r.rr : 0;
    return `${tier}\n${rr} RR`;
}

function formatMatchTitle() {
    const m = currentMatch();
    if (!m) return valorantState.error ? "ERR" : "—";
    const wl = m.won ? "W" : "L";
    const kda = `${m.kills || 0}/${m.deaths || 0}/${m.assists || 0}`;
    const agent = m.agent || "?";
    const idx = (valorantState.match_index || 0) + 1;
    const total = (valorantState.matches || []).length;
    return `${wl} ${kda}\n${agent}\n${idx}/${total}`;
}

function paintAll() {
    for (const ctx of actionContexts[UUID.rank]) {
        ui.setTitle(ctx, formatRankTitle());
    }
    for (const ctx of actionContexts[UUID.lastmatch]) {
        ui.setTitle(ctx, formatMatchTitle());
    }
}

function sendCommand(endpoint, payload) {
    crimsonAPI.send({
        type: "VALORANT_COMMAND",
        endpoint,
        payload: payload || {},
    });
}

function openHubOrStore() {
    const url = STORE_URL;
    try {
        if (ui.socket && ui.socket.readyState === WebSocket.OPEN) {
            ui.socket.send(JSON.stringify({ event: "openUrl", payload: { url } }));
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
    if (data.type === "VALORANT_STATE" && data.data) {
        valorantState = Object.assign({}, valorantState, data.data);
        paintAll();
    }
    if (data.type === "AUTH_ERROR" || data.type === "FEATURE_UNAVAILABLE") {
        console.warn("[Valorant]", data.message || data.type);
    }
};

function handleActionClick(uuid) {
    switch (uuid) {
        case UUID.refresh:
            sendCommand("refresh");
            break;
        case UUID.match_prev:
            sendCommand("match_prev");
            break;
        case UUID.match_next:
            sendCommand("match_next");
            break;
        case UUID.openhub:
            openHubOrStore();
            break;
        case UUID.rank:
        case UUID.lastmatch:
            // display-only; refresh on press for convenience
            sendCommand("refresh");
            break;
        default:
            break;
    }
}

// StreamDock / Elgato plugin bootstrap
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
        // Ask sidecar for a fresh snapshot
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
        if (event === "dialRotate" && action === UUID.lastmatch) {
            const ticks = payload.ticks || 0;
            if (ticks > 0) sendCommand("match_next");
            else if (ticks < 0) sendCommand("match_prev");
        }
    };
}

// Exposed for StreamDock host
window.connectElgatoStreamDeckSocket = connectElgatoStreamDeckSocket;

// Dev / browser smoke: still connect to sidecar
sendCommand("refresh");
