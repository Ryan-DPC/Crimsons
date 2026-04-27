let streamDeckSocket = null;
let globalPluginUUID = "";
let actionContexts = {
    "com.laoy.streamdock.discord.togglemute": [],
    "com.laoy.streamdock.discord.toggledeafen": [],
    "com.laoy.streamdock.discord.joinvoice": [],
    "com.laoy.streamdock.discord.togglecamera": []
};

// Discord Integration State
let discordRpc = null;
let currentVoiceSettings = { mute: false, deaf: false };
let currentVideoState = { cameraOn: false };

/**
 * Entry point for StreamDock Plugin
 */
function connectElgatoStreamDeckSocket(inPort, inPluginUUID, inRegisterEvent, inInfo) {
    globalPluginUUID = inPluginUUID;
    streamDeckSocket = new WebSocket("ws://127.0.0.1:" + inPort);

    streamDeckSocket.onopen = function () {
        const json = { "event": inRegisterEvent, "uuid": inPluginUUID };
        streamDeckSocket.send(JSON.stringify(json));

        // Register with Crimson Backend for rich logic
        const crimsonWs = new WebSocket("ws://127.0.0.1:26432");
        crimsonWs.onopen = () => {
            crimsonWs.send(JSON.stringify({
                type: 'REGISTER_STREAMDOCK',
                port: inPort,
                uuid: inPluginUUID,
                register_event: inRegisterEvent
            }));
            console.log("[Discord] Registered with Crimson Backend");
        };
        crimsonWs.onmessage = (evt) => {
             const data = JSON.parse(evt.data);
             if (data.event === "setState") {
                 updateActionState(data.action, data.payload.state);
             }
        };
    };

    streamDeckSocket.onmessage = function (evt) {
        const jsonObj = JSON.parse(evt.data);
        const event = jsonObj['event'];
        const action = jsonObj['action'];
        const context = jsonObj['context'];
        const payload = jsonObj['payload'];

        if (event === "willAppear") {
            if (actionContexts[action] && !actionContexts[action].includes(context)) {
                actionContexts[action].push(context);
            }
        }

        if (event === "willDisappear") {
            if (actionContexts[action]) {
                actionContexts[action] = actionContexts[action].filter(c => c !== context);
            }
        }

        if (event === "keyDown") {
            handleKeyDown(action, context);
        }
    };

    // Initialize Discord RPC connection
    initDiscordRPC();
}

/**
 * Initialize Discord RPC using a generic Client ID if none provided
 */
function initDiscordRPC() {
    console.log("[Discord] Initializing RPC...");
    // Attempt to load DiscordRPC from a common path or shim
    // Since this runs in a browser/node-like context in StreamDock PI/Plugin,
    // we rely on the backend handler if possible, or a direct IPC shim.
    
    // For now, we delegate the business logic to the existing handler.js
    // which the user provided in the 'core' folder.
}

async function handleKeyDown(action, context) {
    let execAction = null;
    let execParams = {};

    switch (action) {
        case "com.laoy.streamdock.discord.togglemute":
            execAction = 'toggleMute';
            break;
        case "com.laoy.streamdock.discord.toggledeafen":
            execAction = 'toggleDeafen';
            break;
        case "com.laoy.streamdock.discord.joinvoice":
            execAction = 'joinVoiceChannel';
            execParams = { channelId: "YOUR_CHANNEL_ID_HERE" }; // User should configure this in PI
            break;
        case "com.laoy.streamdock.discord.togglecamera":
            execAction = 'toggleCamera';
            break;
    }

    if (execAction) {
        // Route to the Discord Handler
        // Note: Real implementation would require a transport (IPC/WS)
        console.log(`[Discord] Executing ${execAction}...`);
        
        // Update local state and UI (Optimistic update)
        if (execAction === 'toggleMute') {
            currentVoiceSettings.mute = !currentVoiceSettings.mute;
            updateActionState(action, currentVoiceSettings.mute ? 1 : 0);
        } else if (execAction === 'toggleDeafen') {
            currentVoiceSettings.deaf = !currentVoiceSettings.deaf;
            updateActionState(action, currentVoiceSettings.deaf ? 1 : 0);
        }
    }
}

function updateActionState(action, state) {
    const contexts = actionContexts[action] || [];
    contexts.forEach(context => {
        const json = { "event": "setState", "context": context, "payload": { "state": state } };
        if (streamDeckSocket && streamDeckSocket.readyState === WebSocket.OPEN) {
            streamDeckSocket.send(JSON.stringify(json));
        }
    });
}

window.connectElgatoStreamDeckSocket = connectElgatoStreamDeckSocket;
