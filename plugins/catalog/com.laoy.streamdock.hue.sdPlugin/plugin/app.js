// Philips Hue StreamDock Plugin
(function() {
    let websocket = null;
    let pluginUUID = null;
    const states = {};

    window.connectElgatoStreamDeckSocket = function(inPort, inPluginUUID, inRegisterEvent, inInfo, inActionInfo) {
        pluginUUID = inPluginUUID;
        websocket = new WebSocket("ws://127.0.0.1:" + inPort);

        websocket.onopen = function() {
            websocket.send(JSON.stringify({
                event: inRegisterEvent,
                uuid: inPluginUUID
            }));
            console.log("[HUE] Connected and registered to StreamDock");
        };

        websocket.onmessage = function(evt) {
            try {
                const jsonObj = JSON.parse(evt.data);
                const event = jsonObj.event;
                const action = jsonObj.action;
                const context = jsonObj.context;

                if (event === "willAppear") {
                    if (action === "com.laoy.streamdock.hue.toggle") {
                        const cur = states[context] || 0;
                        sendState(context, cur);
                        sendTitle(context, cur === 1 ? "ON" : "OFF");
                    }
                } else if (event === "keyDown") {
                    if (action === "com.laoy.streamdock.hue.toggle") {
                        const cur = states[context] || 0;
                        const next = cur === 0 ? 1 : 0;
                        states[context] = next;
                        sendState(context, next);
                        sendTitle(context, next === 1 ? "ON" : "OFF");
                    } else if (action === "com.laoy.streamdock.hue.scene") {
                        sendTitle(context, "Actif");
                        setTimeout(() => sendTitle(context, ""), 1200);
                    }
                }
            } catch(e) {
                console.error("[HUE] Error handling message:", e);
            }
        };

        websocket.onerror = function(err) {
            console.error("[HUE] WebSocket error:", err);
        };
    };

    function sendState(context, state) {
        if (!websocket || websocket.readyState !== WebSocket.OPEN) return;
        websocket.send(JSON.stringify({
            event: "setState",
            context: context,
            payload: { state: state }
        }));
    }

    function sendTitle(context, title) {
        if (!websocket || websocket.readyState !== WebSocket.OPEN) return;
        websocket.send(JSON.stringify({
            event: "setTitle",
            context: context,
            payload: { title: title, target: 0 }
        }));
    }
})();
