/**
 * Twitch StreamDock plugin (MVP).
 * Talks to crimson-server WS on 127.0.0.1:40510 — Helix via sidecar, mock without creds.
 */
const UUID = {
    viewers: "com.laoy.streamdock.twitch.viewers",
    clip: "com.laoy.streamdock.twitch.clip",
    marker: "com.laoy.streamdock.twitch.marker",
    refresh: "com.laoy.streamdock.twitch.refresh",
    opentwitch: "com.laoy.streamdock.twitch.opentwitch",
    openhub: "com.laoy.streamdock.twitch.openhub",
    mute_alerts: "com.laoy.streamdock.twitch.mute_alerts",
    follower_goal: "com.laoy.streamdock.twitch.follower_goal",
    clear_chat: "com.laoy.streamdock.twitch.clear_chat",
};

const actionContexts = {
    [UUID.viewers]: [],
    [UUID.clip]: [],
    [UUID.marker]: [],
    [UUID.refresh]: [],
    [UUID.opentwitch]: [],
    [UUID.openhub]: [],
    [UUID.mute_alerts]: [],
    [UUID.follower_goal]: [],
    [UUID.clear_chat]: [],
};

let twitchState = {
    connected: false,
    mock: true,
    live: false,
    viewers: 0,
    username: null,
    title: null,
    last_clip_id: null,
    last_marker_id: null,
    follower_goal_current: 0,
    follower_goal_target: 0,
    alerts_muted: false,
    error: null,
};

const STORE_URL = "https://store.crimsons.app/plugins/twitch";
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

function formatViewersTitle() {
    if (!twitchState.live && !twitchState.mock) return "OFF\n—";
    const n = typeof twitchState.viewers === "number" ? twitchState.viewers : 0;
    const badge = twitchState.live ? "LIVE" : "MOCK";
    return `${badge}\n${n}`;
}

function formatClipTitle() {
    if (twitchState.last_clip_id) {
        const id = String(twitchState.last_clip_id);
        return `CLIP\n${id.slice(0, 8)}`;
    }
    return "CLIP";
}

function formatMarkerTitle() {
    if (twitchState.last_marker_id) {
        const id = String(twitchState.last_marker_id);
        return `MARK\n${id.slice(0, 8)}`;
    }
    return "MARK";
}

function formatGoalTitle() {
    const cur = twitchState.follower_goal_current || 0;
    const tgt = twitchState.follower_goal_target || 0;
    return `${cur}/${tgt}`;
}

function paintAll() {
    for (const ctx of actionContexts[UUID.viewers]) {
        ui.setTitle(ctx, formatViewersTitle());
    }
    for (const ctx of actionContexts[UUID.clip]) {
        ui.setTitle(ctx, formatClipTitle());
    }
    for (const ctx of actionContexts[UUID.marker]) {
        ui.setTitle(ctx, formatMarkerTitle());
    }
    for (const ctx of actionContexts[UUID.mute_alerts]) {
        ui.setTitle(ctx, twitchState.alerts_muted ? "MUTED" : "ALERTS");
    }
    for (const ctx of actionContexts[UUID.follower_goal]) {
        ui.setTitle(ctx, formatGoalTitle());
    }
}

function sendCommand(endpoint, payload) {
    crimsonAPI.send({
        type: "TWITCH_COMMAND",
        endpoint,
        payload: payload || {},
    });
}

function openUrl(url) {
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

function openTwitch() {
    const user = twitchState.username || "twitch";
    openUrl(`https://www.twitch.tv/${encodeURIComponent(user)}`);
}

function openHubOrStore() {
    openUrl(STORE_URL);
}

window.handleCrimsonMessage = function (data) {
    if (!data || !data.type) return;
    if (data.type === "TWITCH_STATE" && data.data) {
        twitchState = Object.assign({}, twitchState, data.data);
        paintAll();
    }
    if (data.type === "AUTH_ERROR" || data.type === "FEATURE_UNAVAILABLE") {
        console.warn("[Twitch]", data.message || data.type);
    }
};

function handleActionClick(uuid) {
    switch (uuid) {
        case UUID.refresh:
        case UUID.viewers:
            sendCommand("refresh");
            break;
        case UUID.clip:
            sendCommand("create_clip");
            break;
        case UUID.marker:
            sendCommand("create_marker");
            break;
        case UUID.mute_alerts:
            sendCommand("mute_alerts");
            break;
        case UUID.follower_goal:
            sendCommand("follower_goal");
            break;
        case UUID.clear_chat:
            sendCommand("clear_chat");
            break;
        case UUID.opentwitch:
            openTwitch();
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
    };
}

window.connectElgatoStreamDeckSocket = connectElgatoStreamDeckSocket;

sendCommand("refresh");
