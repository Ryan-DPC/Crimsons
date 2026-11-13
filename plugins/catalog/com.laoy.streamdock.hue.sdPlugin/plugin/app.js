/**
 * Philips Hue StreamDock plugin.
 * Talks to crimson-server WS on 127.0.0.1:40510 (HUE_STATE / HUE_COMMAND).
 */
const UUID = {
    toggle: "com.laoy.streamdock.hue.toggle",
    bri_up: "com.laoy.streamdock.hue.bri_up",
    bri_down: "com.laoy.streamdock.hue.bri_down",
    status: "com.laoy.streamdock.hue.status",
    room_prev: "com.laoy.streamdock.hue.room_prev",
    room_next: "com.laoy.streamdock.hue.room_next",
    scene_prev: "com.laoy.streamdock.hue.scene_prev",
    scene_next: "com.laoy.streamdock.hue.scene_next",
    ct_preset: "com.laoy.streamdock.hue.ct_preset",
    refresh: "com.laoy.streamdock.hue.refresh",
    openhub: "com.laoy.streamdock.hue.openhub",
};

const actionContexts = {};
Object.keys(UUID).forEach((k) => {
    actionContexts[UUID[k]] = [];
});

let hueState = {
    connected: false,
    mock: true,
    groups: [],
    scenes: [],
    selected_group_index: 0,
    selected_scene_index: 0,
    bridge_ip: null,
    error: null,
};

const STORE_URL = "https://store.crimsons.app/plugins/philips-hue";
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

function briPct(bri) {
    if (typeof bri !== "number" || isNaN(bri)) return "—";
    return Math.round(Math.max(1, Math.min(254, bri)) / 254 * 100) + "%";
}

function selectedGroup() {
    const groups = hueState.groups || [];
    if (!groups.length) return null;
    const idx = Math.max(0, Math.min(hueState.selected_group_index || 0, groups.length - 1));
    return groups[idx];
}

function scenesForSelected() {
    const g = selectedGroup();
    const scenes = hueState.scenes || [];
    if (!g) return scenes;
    return scenes.filter((s) => !s.group || s.group === g.id);
}

function selectedScene() {
    const list = scenesForSelected();
    if (!list.length) return null;
    const idx = Math.max(0, Math.min(hueState.selected_scene_index || 0, list.length - 1));
    return list[idx];
}

function formatToggleTitle() {
    const g = selectedGroup();
    if (!g) return "Hue\n—";
    return (g.name || "Room").slice(0, 12) + "\n" + (g.on ? "ON" : "OFF");
}

function formatStatusTitle() {
    const g = selectedGroup();
    const sc = selectedScene();
    if (!g) return (hueState.mock ? "Mock" : "Hue") + "\n—";
    const line1 = (g.name || "?").slice(0, 12);
    const line2 = (g.on ? briPct(g.bri) : "OFF") + (hueState.mock ? " ·m" : "");
    const line3 = sc ? (sc.name || "?").slice(0, 12) : "—";
    return line1 + "\n" + line2 + "\n" + line3;
}

function formatSceneTitle() {
    const sc = selectedScene();
    const g = selectedGroup();
    if (!sc) return "Scene\n—";
    return (sc.name || "?").slice(0, 12) + "\n" + ((g && g.name) || "").slice(0, 10);
}

function paintAll() {
    const g = selectedGroup();
    for (const ctx of actionContexts[UUID.toggle] || []) {
        ui.setTitle(ctx, formatToggleTitle());
        ui.setState(ctx, g && g.on ? 1 : 0);
    }
    for (const ctx of actionContexts[UUID.bri_up] || []) {
        ui.setTitle(ctx, "Bri +\n" + (g ? briPct(g.bri) : "—"));
    }
    for (const ctx of actionContexts[UUID.bri_down] || []) {
        ui.setTitle(ctx, "Bri −\n" + (g ? briPct(g.bri) : "—"));
    }
    for (const ctx of actionContexts[UUID.status] || []) {
        ui.setTitle(ctx, formatStatusTitle());
    }
    for (const ctx of actionContexts[UUID.scene_next] || []) {
        ui.setTitle(ctx, "Next\n" + formatSceneTitle());
    }
    for (const ctx of actionContexts[UUID.scene_prev] || []) {
        ui.setTitle(ctx, "Prev\n" + formatSceneTitle());
    }
    for (const ctx of actionContexts[UUID.ct_preset] || []) {
        const ct = g && g.ct != null ? String(g.ct) : "—";
        ui.setTitle(ctx, "CT\n" + ct);
    }
    const roomLabel = g ? (g.name || "?").slice(0, 10) : "—";
    for (const ctx of actionContexts[UUID.room_next] || []) {
        ui.setTitle(ctx, "Room →\n" + roomLabel);
    }
    for (const ctx of actionContexts[UUID.room_prev] || []) {
        ui.setTitle(ctx, "← Room\n" + roomLabel);
    }
}

function sendCommand(endpoint, payload) {
    crimsonAPI.send({
        type: "HUE_COMMAND",
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
    if (data.type === "HUE_STATE" && data.data) {
        hueState = Object.assign({}, hueState, data.data);
        paintAll();
    }
    if (data.type === "AUTH_ERROR" || data.type === "FEATURE_UNAVAILABLE") {
        console.warn("[Hue]", data.message || data.type);
    }
};

function handleActionClick(uuid) {
    switch (uuid) {
        case UUID.toggle:
            sendCommand("toggle");
            break;
        case UUID.bri_up:
            sendCommand("bri_up");
            break;
        case UUID.bri_down:
            sendCommand("bri_down");
            break;
        case UUID.room_prev:
            sendCommand("room_prev");
            break;
        case UUID.room_next:
            sendCommand("room_next");
            break;
        case UUID.scene_prev:
            sendCommand("scene_prev");
            break;
        case UUID.scene_next:
            sendCommand("scene_next");
            break;
        case UUID.ct_preset:
            sendCommand("ct_preset", { preset: "neutral" });
            break;
        case UUID.refresh:
        case UUID.status:
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
        if (event === "dialRotate") {
            const ticks = payload.ticks || 0;
            if (action === UUID.status || action === UUID.bri_up || action === UUID.bri_down) {
                if (ticks > 0) sendCommand("bri_up");
                else if (ticks < 0) sendCommand("bri_down");
            } else if (action === UUID.scene_next || action === UUID.scene_prev) {
                if (ticks > 0) sendCommand("scene_next");
                else if (ticks < 0) sendCommand("scene_prev");
            } else if (action === UUID.room_next || action === UUID.room_prev) {
                if (ticks > 0) sendCommand("room_next");
                else if (ticks < 0) sendCommand("room_prev");
            }
        }
    };
}

window.connectElgatoStreamDeckSocket = connectElgatoStreamDeckSocket;

sendCommand("refresh");
