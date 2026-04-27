/// <reference path="streamdeck_ui.js" />
/// <reference path="crimson_ws.js" />

const actionContexts = {};
const actionImageCache = {};

// Use the global crimsonAPI defined in crimson_ws.js
const api = window.crimsonAPI;

api.onMessage((data) => {
    try {
        if (data.event === "setImageBroadcast" && data.payload) {
            const img = data.payload.image;
            Object.keys(actionContexts).forEach(action => {
                // Send broadcast images to all active contexts
                actionContexts[action].forEach(ctx => {
                    if (actionImageCache[ctx] !== img) {
                        console.log("[Spotify Plugin] Broadcast image to", action, ctx);
                        ui.send({ event: "setImage", context: ctx, payload: { image: img, target: 0 } });
                        actionImageCache[ctx] = img;
                    }
                });
            });
        } else if (data.event === "setImage") {
            const ctx = data.context;
            const img = data.payload?.image;
            if (ctx && img && actionImageCache[ctx] !== img) {
                console.log("[Spotify Plugin] Setting image for context:", ctx);
                ui.send(data);
                actionImageCache[ctx] = img;
            }
        } else if (data.event) {
            ui.send(data);
        }
    } catch (err) {
        console.error("[Spotify Plugin] Error handling Crimson message:", err);
    }
});

function handleActionClick(action, context, settings) {
    console.log("[Spotify Plugin] ACTION CLICKED:", action, "Context:", context, "Settings:", settings);
    const actionKey = action.replace("com.laoy.streamdock.spotify.", "");
    
    // No endpoint mapping - just send the action directly
    console.log("[Spotify Plugin] Sending button event to Crimson for action:", action, "endpoint:", actionKey, "settings:", settings);
    
    // Send as a standard StreamDeck event (will be processed by streamdock.rs)
    api.send({ 
        event: "keyDown",
        context: context,
        action: action,
        payload: {
            settings: settings || {}
        }
    });
}

function updateDisplayLogic(context, action) {
    if (action.includes("play") || action.includes("pause") || action.includes("art") || action.includes("track")) {
        // Reset title to allow cover to be prominent
        ui.setTitle(context, ""); 
    }
}

window.connectElgatoStreamDeckSocket = function(inPort, inPluginUUID, inRegisterEvent, inInfo) {
    console.log("[Spotify Plugin] StreamDock Software Connecting... Port:", inPort);
    const streamDeckSocket = new WebSocket("ws://127.0.0.1:" + inPort);
    ui.setSocket(streamDeckSocket);

    streamDeckSocket.onopen = function () {
        console.log("[Spotify Plugin] Registered with StreamDock Software.");
        streamDeckSocket.send(JSON.stringify({ "event": inRegisterEvent, "uuid": inPluginUUID }));

        const register = () => {
            console.log("[Spotify Plugin] Requesting Handover to Crimson Server...");
            api.send({
                type: 'REGISTER_STREAMDOCK',
                port: inPort,
                uuid: inPluginUUID,
                register_event: inRegisterEvent
            });
        };
        
        register();
        // Periodic re-register to keep connection alive and ensure cover delivery
        setInterval(register, 15000);
    };

    streamDeckSocket.onmessage = function (evt) {
        try {
            const jsonObj = JSON.parse(evt.data);
            const event = jsonObj['event'];
            const action = jsonObj['action'];
            const context = jsonObj['context'];
            
            // LOG EVERY EVENT FROM SOFTWARE
            console.log("[Spotify Plugin] RECEIVED EVENT:", event, "ACTION:", action, "CONTEXT:", context);

            if (event === "propertyInspectorDidAppear" || event === "propertyInspectorDidDisappear" || event === "sendToPlugin") {
                api.send(jsonObj);
            }

            if (event === "willAppear") {
                if (!actionContexts[action]) actionContexts[action] = [];
                if (!actionContexts[action].includes(context)) {
                    actionContexts[action].push(context);
                    console.log("[Spotify Plugin] Registered context", context, "for action", action);
                }
                updateDisplayLogic(context, action);
            }

            if (event === "keyDown" || event === "dialPress") {
                console.log("[Spotify Plugin] Button pressed! Forwarding to Crimson...");
                handleActionClick(action, context, jsonObj['payload']?.settings);
            }
        } catch (err) {
            console.error("[Spotify Plugin] Error parsing SD message:", err);
        }
    }
    
    streamDeckSocket.onclose = function() {
        console.warn("[Spotify Plugin] StreamDock Software connection lost. Reconnecting plugin...");
    };
}
