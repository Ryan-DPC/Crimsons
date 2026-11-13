/**
 * Twitch StreamDock plugin (MVP).
 * Talks to crimson-server WS on 127.0.0.1:40510 — Helix via sidecar, mock without creds.
 * Error feedback: showAlert + ERR title on viewers/clip/marker/refresh when TWITCH_STATE.error is set.
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
    has_credentials: false,
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
    error_detail: null,
};

/** Last pressed action UUID — used to flash the right key on error. */
let lastActionUuid = null;
let lastErrorCode = null;

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

function shortError(code) {
    if (!code) return "ERR";
    const c = String(code);
    if (c.length <= 10) return c.toUpperCase();
    return c.slice(0, 10).toUpperCase();
}

function formatViewersTitle() {
    if (twitchState.error === "refresh_failed") {
        return `ERR\n${shortError(twitchState.error)}`;
    }
    if (!twitchState.live && !twitchState.mock) return "OFF\n—";
    const n = typeof twitchState.viewers === "number" ? twitchState.viewers : 0;
    const badge = twitchState.live ? "LIVE" : "MOCK";
    return `${badge}\n${n}`;
}

function formatClipTitle() {
    if (twitchState.error === "clip_failed") {
        return `ERR\nCLIP`;
    }
    if (twitchState.last_clip_id) {
        const id = String(twitchState.last_clip_id);
        return `CLIP\n${id.slice(0, 8)}`;
    }
    return "CLIP";
}

function formatMarkerTitle() {
    if (twitchState.error === "marker_failed") {
        return `ERR\nMARK`;
    }
    if (twitchState.last_marker_id) {
        const id = String(twitchState.last_marker_id);
        return `MARK\n${id.slice(0, 8)}`;
    }
    return "MARK";
}

function formatRefreshTitle() {
    if (twitchState.error === "refresh_failed" || twitchState.error === "creds_invalid") {
        return `ERR\n${shortError(twitchState.error)}`;
    }
    return "REFRESH";
}

function formatGoalTitle() {
    const cur = twitchState.follower_goal_current || 0;
    const tgt = twitchState.follower_goal_target || 0;
    return `${cur}/${tgt}`;
}

function flashErrorOn(uuids) {
    for (const uuid of uuids) {
        const list = actionContexts[uuid] || [];
        for (const ctx of list) {
            try {
                ui.showAlert(ctx);
            } catch (e) {}
        }
    }
}

function flashOkOn(uuids) {
    for (const uuid of uuids) {
        const list = actionContexts[uuid] || [];
        for (const ctx of list) {
            try {
                ui.showOk(ctx);
            } catch (e) {}
        }
    }
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
    for (const ctx of actionContexts[UUID.refresh]) {
        ui.setTitle(ctx, formatRefreshTitle());
    }
    for (const ctx of actionContexts[UUID.mute_alerts]) {
        ui.setTitle(ctx, twitchState.alerts_muted ? "MUTED" : "ALERTS");
    }
    for (const ctx of actionContexts[UUID.follower_goal]) {
        ui.setTitle(ctx, formatGoalTitle());
    }
    for (const ctx of actionContexts[UUID.clear_chat]) {
        ui.setTitle(ctx, twitchState.error === "clear_chat_stub" ? "STUB" : "CHAT");
    }
}

function errorTargetsForCode(code) {
    switch (code) {
        case "clip_failed":
            return [UUID.clip];
        case "marker_failed":
            return [UUID.marker];
        case "refresh_failed":
        case "creds_invalid":
            return [UUID.refresh, UUID.viewers];
        case "clear_chat_stub":
            return [UUID.clear_chat];
        default:
            if (lastActionUuid) return [lastActionUuid];
            return [UUID.refresh];
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
        const prevClip = twitchState.last_clip_id;
        const prevMarker = twitchState.last_marker_id;
        twitchState = Object.assign({}, twitchState, data.data);
        paintAll();

        const err = twitchState.error || null;
        if (err && err !== lastErrorCode) {
            flashErrorOn(errorTargetsForCode(err));
            lastErrorCode = err;
        } else if (!err) {
            if (lastErrorCode) lastErrorCode = null;
            // Success feedback for clip / marker after a press
            if (lastActionUuid === UUID.clip && twitchState.last_clip_id && twitchState.last_clip_id !== prevClip) {
                flashOkOn([UUID.clip]);
            }
            if (lastActionUuid === UUID.marker && twitchState.last_marker_id && twitchState.last_marker_id !== prevMarker) {
                flashOkOn([UUID.marker]);
            }
        }
    }
    if (data.type === "AUTH_ERROR" || data.type === "FEATURE_UNAVAILABLE") {
        console.warn("[Twitch]", data.message || data.type);
        if (lastActionUuid) flashErrorOn([lastActionUuid]);
        else flashErrorOn([UUID.refresh]);
    }
};

function handleActionClick(uuid) {
    lastActionUuid = uuid;
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
