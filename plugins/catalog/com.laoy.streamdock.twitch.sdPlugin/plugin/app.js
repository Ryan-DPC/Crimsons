// Twitch StreamDock Plugin
let streamDeckSocket = null;
let globalPluginUUID = "";
let simulatedViewers = 42;
const actionContexts = {
    "com.laoy.streamdock.twitch.chat": [],
    "com.laoy.streamdock.twitch.ad": [],
    "com.laoy.streamdock.twitch.viewers": []
};
const pressTimers = {};

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
        if (action === "com.laoy.streamdock.twitch.viewers") {
            sendTitle(context, String(simulatedViewers));
        }
    }

    if (event === "willDisappear") {
        if (actionContexts[action]) {
            actionContexts[action] = actionContexts[action].filter(c => c !== context);
        }
    }

    if (event === "keyDown" || event === "keyUp" || (event === "dialPress" && jsonObj.payload?.pressed)) {
        const now = Date.now();
        if (pressTimers[context] && (now - pressTimers[context] < 150)) {
            return;
        }
        pressTimers[context] = now;

        if (action === "com.laoy.streamdock.twitch.chat") {
            sendTitle(context, "Envoyé!");
            setTimeout(() => sendTitle(context, ""), 1200);
        } else if (action === "com.laoy.streamdock.twitch.ad") {
            sendTitle(context, "Pub 30s");
            setTimeout(() => sendTitle(context, ""), 1500);
        } else if (action === "com.laoy.streamdock.twitch.viewers") {
            simulatedViewers = Math.floor(Math.random() * 30) + 35;
            sendTitle(context, String(simulatedViewers));
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
            console.log("[TWITCH] Connected to StreamDock on port", inPort);
            streamDeckSocket.send(JSON.stringify({
                event: inRegisterEvent,
                uuid: inPluginUUID
            }));
        };

        streamDeckSocket.onclose = function() {
            console.warn("[TWITCH] StreamDock socket closed, retrying in 3s...");
            streamDeckSocket = null;
            setTimeout(() => connectHw(), 3000);
        };

        streamDeckSocket.onerror = function(err) {
            console.error("[TWITCH] WebSocket error", err);
            try { streamDeckSocket.close(); } catch(e) {}
        };

        streamDeckSocket.onmessage = function(evt) {
            try {
                const jsonObj = JSON.parse(evt.data);
                handleHardwareEvent(jsonObj);
            } catch(e) {
                console.error("[TWITCH] Error parsing hardware message:", e);
            }
        };
    };

    window.connectHw = connectHw;
    connectHw();
}

window.connectElgatoStreamDeckSocket = connectElgatoStreamDeckSocket;
