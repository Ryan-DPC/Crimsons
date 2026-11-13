// Twitch StreamDock Plugin
(function() {
    let websocket = null;
    let pluginUUID = null;
    let simulatedViewers = 42;

    window.connectElgatoStreamDeckSocket = function(inPort, inPluginUUID, inRegisterEvent, inInfo, inActionInfo) {
        pluginUUID = inPluginUUID;
        websocket = new WebSocket("ws://127.0.0.1:" + inPort);

        websocket.onopen = function() {
            websocket.send(JSON.stringify({
                event: inRegisterEvent,
                uuid: inPluginUUID
            }));
            console.log("[TWITCH] Connected and registered to StreamDock");
        };

        websocket.onmessage = function(evt) {
            try {
                const jsonObj = JSON.parse(evt.data);
                const event = jsonObj.event;
                const action = jsonObj.action;
                const context = jsonObj.context;

                if (event === "willAppear") {
                    if (action === "com.laoy.streamdock.twitch.viewers") {
                        sendTitle(context, String(simulatedViewers));
                    }
                } else if (event === "keyDown") {
                    if (action === "com.laoy.streamdock.twitch.chat") {
                        sendTitle(context, "Envoyé!");
                        setTimeout(() => sendTitle(context, ""), 1200);
                    } else if (action === "com.laoy.streamdock.twitch.ad") {
                        sendTitle(context, "Pub 30s");
                        setTimeout(() => sendTitle(context, ""), 1500);
                    } else if (action === "com.laoy.streamdock.twitch.viewers") {
                        // Refresh viewer count
                        simulatedViewers = Math.floor(Math.random() * 30) + 35;
                        sendTitle(context, String(simulatedViewers));
                    }
                }
            } catch(e) {
                console.error("[TWITCH] Error handling message:", e);
            }
        };

        websocket.onerror = function(err) {
            console.error("[TWITCH] WebSocket error:", err);
        };
    };

    function sendTitle(context, title) {
        if (!websocket || websocket.readyState !== WebSocket.OPEN) return;
        websocket.send(JSON.stringify({
            event: "setTitle",
            context: context,
            payload: { title: title, target: 0 }
        }));
    }
})();
