// Philips Hue StreamDock Plugin
let streamDeckSocket = null;
let globalPluginUUID = "";
const actionContexts = {
    "com.laoy.streamdock.hue.toggle": [],
    "com.laoy.streamdock.hue.scene": []
};
const lightStates = {}; // context -> { on: false, sceneIndex: 0 }
const SCENES = ["Lecture", "Relax", "Ambiance", "Soirée", "Veilleuse"];

function sendState(context, state) {
    if (!streamDeckSocket || streamDeckSocket.readyState !== WebSocket.OPEN) return;
    streamDeckSocket.send(JSON.stringify({
        event: "setState",
        context: context,
        payload: { state: state }
    }));
}

function sendTitle(context, title) {
    if (!streamDeckSocket || streamDeckSocket.readyState !== WebSocket.OPEN) return;
    streamDeckSocket.send(JSON.stringify({
        event: "setTitle",
        context: context,
        payload: { title: title, target: 0 }
    }));
}

function handleHardwareEvent(jsonObj) {
    const event = jsonObj.event;
    const action = jsonObj.action;
    const context = jsonObj.context;

    if (!event) return;

    if (event === "willAppear") {
        if (!actionContexts[action]) actionContexts[action] = [];
        if (!actionContexts[action].includes(context)) {
            actionContexts[action].push(context);
        }
        if (!lightStates[context]) {
            lightStates[context] = { on: false, sceneIndex: 0 };
        }
        if (action === "com.laoy.streamdock.hue.toggle") {
            const st = lightStates[context];
            sendState(context, st.on ? 1 : 0);
            sendTitle(context, st.on ? "ON" : "OFF");
        } else if (action === "com.laoy.streamdock.hue.scene") {
            const st = lightStates[context];
            sendTitle(context, SCENES[st.sceneIndex]);
        }
    }

    if (event === "willDisappear") {
        if (actionContexts[action]) {
            actionContexts[action] = actionContexts[action].filter(c => c !== context);
        }
    }

    if (event === "keyDown" || event === "keyUp" || (event === "dialPress" && jsonObj.payload?.pressed)) {
        // Debounce if both keyDown and keyUp arrive within 150ms
        const now = Date.now();
        if (lightStates[context] && lightStates[context]._lastPress && (now - lightStates[context]._lastPress < 150)) {
            return;
        }
        if (!lightStates[context]) lightStates[context] = { on: false, sceneIndex: 0 };
        lightStates[context]._lastPress = now;

        if (action === "com.laoy.streamdock.hue.toggle") {
            const st = lightStates[context];
            st.on = !st.on;
            sendState(context, st.on ? 1 : 0);
            sendTitle(context, st.on ? "ON" : "OFF");
            console.log("[HUE] Light toggled:", st.on ? "ON" : "OFF");
        } else if (action === "com.laoy.streamdock.hue.scene") {
            const st = lightStates[context];
            st.sceneIndex = (st.sceneIndex + 1) % SCENES.length;
            const sceneName = SCENES[st.sceneIndex];
            sendTitle(context, sceneName);
            console.log("[HUE] Switched scene to:", sceneName);
        }
    }
}

function connectElgatoStreamDeckSocket(inPort, inPluginUUID, inRegisterEvent, inInfo) {
    globalPluginUUID = inPluginUUID;

    const connectHw = () => {
        if (streamDeckSocket && (streamDeckSocket.readyState === WebSocket.OPEN || streamDeckSocket.readyState === WebSocket.CONNECTING)) {
            return;
        }

        streamDeckSocket = new WebSocket("ws://127.0.0.1:" + inPort);

        streamDeckSocket.onopen = function() {
            console.log("[HUE] Connected to StreamDock on port", inPort);
            streamDeckSocket.send(JSON.stringify({
                event: inRegisterEvent,
                uuid: inPluginUUID
            }));
        };

        streamDeckSocket.onclose = function() {
            console.warn("[HUE] StreamDock socket closed, retrying in 3s...");
            streamDeckSocket = null;
            setTimeout(() => connectHw(), 3000);
        };

        streamDeckSocket.onerror = function(err) {
            console.error("[HUE] WebSocket error", err);
            try { streamDeckSocket.close(); } catch(e) {}
        };

        streamDeckSocket.onmessage = function(evt) {
            try {
                const jsonObj = JSON.parse(evt.data);
                handleHardwareEvent(jsonObj);
            } catch(e) {
                console.error("[HUE] Error parsing hardware message:", e);
            }
        };
    };

    window.connectHw = connectHw;
    connectHw();
}

window.connectElgatoStreamDeckSocket = connectElgatoStreamDeckSocket;
