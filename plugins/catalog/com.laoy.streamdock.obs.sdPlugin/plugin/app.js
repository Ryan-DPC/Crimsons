/**
 * OBS Studio StreamDock plugin (obs-websocket v5 via crimson-server).
 * HL scene actions: Start / Pause / Live / End (configurable names).
 * Countdown / HTML overlays stay on the VPS API — this pack only switches local OBS scenes.
 */
const UUID = {
    start: "com.laoy.streamdock.obs.start",
    pause: "com.laoy.streamdock.obs.pause",
    live: "com.laoy.streamdock.obs.live",
    end: "com.laoy.streamdock.obs.end",
    status: "com.laoy.streamdock.obs.status",
    refresh: "com.laoy.streamdock.obs.refresh",
    openhub: "com.laoy.streamdock.obs.openhub",
};

const actionContexts = {
    [UUID.start]: [],
    [UUID.pause]: [],
    [UUID.live]: [],
    [UUID.end]: [],
    [UUID.status]: [],
    [UUID.refresh]: [],
    [UUID.openhub]: [],
};

/** @type {Record<string, Record<string, unknown>>} */
let settingsByContext = {};

let obsState = {
    connected: false,
    mock: true,
    current_scene: null,
    scenes: [],
    scene_start: "Start",
    scene_pause: "Pause",
    scene_live: "Live",
    scene_end: "End",
    error: null,
};

const STORE_URL = "https://store.crimsons.app/plugins/obs";

const crimsonAPI = new CrimsonAPI(40510);
window.crimsonAPI = crimsonAPI;

function trackContext(uuid, context, appear) {
    const list = actionContexts[uuid];
    if (!list) return;
    const i = list.indexOf(context);
    if (appear && i < 0) list.push(context);
    if (!appear && i >= 0) list.splice(i, 1);
}

function formatStatusTitle() {
    const scene = obsState.current_scene || "—";
    const badge = obsState.mock ? "MOCK" : obsState.connected ? "OBS" : "OFF";
    const short = String(scene).length > 10 ? String(scene).slice(0, 10) : scene;
    return `${badge}\n${short}`;
}

function paintAll() {
    for (const ctx of actionContexts[UUID.status]) {
        ui.setTitle(ctx, formatStatusTitle());
    }
    const map = [
        [UUID.start, obsState.scene_start || "Start"],
        [UUID.pause, obsState.scene_pause || "Pause"],
        [UUID.live, obsState.scene_live || "Live"],
        [UUID.end, obsState.scene_end || "End"],
    ];
    for (const [uuid, label] of map) {
        for (const ctx of actionContexts[uuid]) {
            const settings = settingsByContext[ctx] || {};
            const custom = String(settings.sceneName || settings.scene || "").trim();
            ui.setTitle(ctx, custom || label);
        }
    }
}

function sendCommand(endpoint, payload) {
    crimsonAPI.send({
        type: "OBS_COMMAND",
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
        window.open(url, "_blank");
    } catch (e2) {}
}

window.handleCrimsonMessage = function (data) {
    if (!data || !data.type) return;
    if (data.type === "OBS_STATE" && data.data) {
        obsState = Object.assign({}, obsState, data.data);
        paintAll();
    }
    if (data.type === "AUTH_ERROR" || data.type === "FEATURE_UNAVAILABLE") {
        console.warn("[OBS]", data.message || data.type);
    }
};

function scenePayload(context) {
    const settings = settingsByContext[context] || {};
    const sceneName = String(settings.sceneName || settings.scene || "").trim();
    return sceneName ? { sceneName } : {};
}

function handleActionClick(uuid, context) {
    const payload = scenePayload(context);
    switch (uuid) {
        case UUID.start:
            sendCommand("start", payload);
            break;
        case UUID.pause:
            sendCommand("pause", payload);
            break;
        case UUID.live:
            sendCommand("live", payload);
            break;
        case UUID.end:
            sendCommand("end", payload);
            break;
        case UUID.status:
        case UUID.refresh:
            sendCommand("refresh");
            break;
        case UUID.openhub:
            openUrl(STORE_URL);
            break;
        default:
            break;
    }
}

let websocket = null;

function connectElgatoStreamDeckSocket(inPort, inPluginUUID, inRegisterEvent) {
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
            if (payload.settings) settingsByContext[context] = payload.settings;
            trackContext(action, context, true);
            paintAll();
        }
        if (event === "willDisappear" && action) {
            trackContext(action, context, false);
            delete settingsByContext[context];
        }
        if (event === "didReceiveSettings" && context) {
            settingsByContext[context] = payload.settings || {};
            paintAll();
        }
        if (event === "keyDown" || (event === "dialPress" && payload.pressed)) {
            handleActionClick(action, context);
        }
    };
}

window.connectElgatoStreamDeckSocket = connectElgatoStreamDeckSocket;

sendCommand("refresh");
