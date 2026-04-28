/// <reference path="streamdeck_ui.js" />

const actionContexts = {};

const actionImageCache = {};
const actionUrlCache = {};

// ==========================================
// CRIMSON BACKEND CONNECT (Stand-alone)
// ==========================================
const crimsonAPI = {
    ws: null,
    queue: [],
    connect() {
        this.ws = new WebSocket('ws://127.0.0.1:40510');
        this.ws.onopen = () => {
            console.log("Crimson Plugin: Connected to Backend.");
            while (this.queue.length > 0) {
                this.ws.send(JSON.stringify(this.queue.shift()));
            }
        };
        this.ws.onmessage = async (e) => {
            try {
                const data = JSON.parse(e.data);
                if (data.event === "setImageBroadcast" && data.payload) {
                    const img = data.payload.image;
                    Object.keys(actionContexts).forEach(action => {
                        // Anti-Flicker & Playlist skip (Playlist buttons keep their own cover)
                        if (action.includes("spotify") && !action.includes("playlist")) {
                            actionContexts[action].forEach(ctx => {
                                handleSetImage({ context: ctx, payload: { image: img } });
                            });
                        }
                    });
                } else if (data.event === "setImage") {
                    handleSetImage(data);
                } else if (data.event) {
                    ui.send(data);
                }
            } catch (err) {}
        };
        this.ws.onclose = () => setTimeout(() => this.connect(), 3000);
    },
    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        } else {
            this.queue.push(data);
        }
    },
    async toBase64(url) {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0);
                resolve(canvas.toDataURL("image/png"));
            };
            img.onerror = () => resolve(null);
            img.src = url;
        });
    }
};
crimsonAPI.connect();

async function handleSetImage(data) {
    const ctx = data.context;
    let img = data.payload?.image;
    if (!ctx || !img) return;

    // Fast URL cache check
    if (actionUrlCache[ctx] === img) return;

    // Convert URL to Base64 if needed
    if (img.startsWith("http")) {
        const base64 = await crimsonAPI.toBase64(img);
        if (base64) {
            actionUrlCache[ctx] = img; // Store URL
            img = base64;
        } else {
            return; // Don't send broken images
        }
    }

    if (actionImageCache[ctx] !== img) {
        ui.send({
            event: "setImage",
            context: ctx,
            payload: {
                image: img,
                target: 0
            }
        });
        actionImageCache[ctx] = img;
    }
}

function handleActionClick(action, context, settings) {
    const actionKey = action.replace("com.laoy.streamdock.spotify.", "");
    let endpoint = actionKey;
    
    if (actionKey === "playpause") endpoint = "playpause";
    if (actionKey === "previous") endpoint = "prev";
    if (actionKey === "playplaylist") endpoint = "play";
    
    crimsonAPI.send({ 
        type: "SPOTIFY_COMMAND", 
        endpoint: endpoint,
        payload: settings 
    });
}

function updateDisplayLogic(context, action) {
    if (action.includes("play") || action.includes("pause") || action.includes("art") || action.includes("track")) {
        // Backend handles images
        ui.setTitle(context, ""); 
    }
}

window.connectElgatoStreamDeckSocket = function(inPort, inPluginUUID, inRegisterEvent, inInfo) {
    const streamDeckSocket = new WebSocket("ws://127.0.0.1:" + inPort);
    ui.setSocket(streamDeckSocket);

    streamDeckSocket.onopen = function () {
        streamDeckSocket.send(JSON.stringify({ "event": inRegisterEvent, "uuid": inPluginUUID }));

        const register = () => {
            crimsonAPI.send({
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
        const jsonObj = JSON.parse(evt.data);
        const event = jsonObj['event'];
        const action = jsonObj['action'];
        const context = jsonObj['context'];

        if (event === "propertyInspectorDidAppear" || event === "propertyInspectorDidDisappear" || event === "sendToPlugin" || event === "didReceiveSettings" || event === "didReceiveGlobalSettings") {
            crimsonAPI.send(jsonObj);
        }

        if (event === "willAppear") {
            if (!actionContexts[action]) actionContexts[action] = [];
            if (!actionContexts[action].includes(context)) {
                actionContexts[action].push(context);
            }
            updateDisplayLogic(context, action);
        }

        if (event === "keyDown" || event === "dialPress") {
            handleActionClick(action, context, jsonObj['payload']?.settings);
        }
    }
}
