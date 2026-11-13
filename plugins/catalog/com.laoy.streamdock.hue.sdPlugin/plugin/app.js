// Philips Hue StreamDock Plugin with Local Bridge Auto-Integration
let streamDeckSocket = null;
let globalPluginUUID = "";
const HUE_BRIDGE_IP = "192.168.1.3";
let hueUser = localStorage.getItem("hue_username") || "";
let isPairing = false;
let pairingInterval = null;

async function loadTokenFromFile() {
    try {
        const resp = await fetch("hue_token.json");
        if (resp.ok) {
            const data = await resp.json();
            if (data && data.username) {
                hueUser = data.username;
                localStorage.setItem("hue_username", hueUser);
                syncRealHueState();
            }
        }
    } catch(e) {}
}
loadTokenFromFile();

const actionContexts = {
    "com.laoy.streamdock.hue.toggle": [],
    "com.laoy.streamdock.hue.scene": []
};

const lightStates = {}; // context -> { on: false, sceneIndex: 0 }
let hueScenes = [];

// Pre-converted base64 cache
const iconCache = {
    off: null,
    on: null,
    scene: null
};

function preloadIcons() {
    function toB64(path, key) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement("canvas");
            canvas.width = 144;
            canvas.height = 144;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, 144, 144);
            iconCache[key] = canvas.toDataURL("image/png");
        };
        img.src = path;
    }
    toB64("static/icon/hue_off.png", "off");
    toB64("static/icon/hue_on.png", "on");
    toB64("static/icon/hue_scene.png", "scene");
}
preloadIcons();

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
        payload: { title: "" + title, target: 0 }
    }));
}

function sendImage(context, imageB64) {
    if (!streamDeckSocket || streamDeckSocket.readyState !== WebSocket.OPEN || !imageB64) return;
    streamDeckSocket.send(JSON.stringify({
        event: "setImage",
        context: context,
        payload: { image: imageB64, target: 0 }
    }));
}

function updateToggleKeyVisual(context, isOn) {
    sendState(context, isOn ? 1 : 0);
    sendTitle(context, isOn ? "ON" : "OFF");
    const b64 = isOn ? iconCache.on : iconCache.off;
    if (b64) sendImage(context, b64);
}

// -------------------------------------------------------------
// Philips Hue Bridge Local API
// -------------------------------------------------------------
async function hueRequest(endpoint, method = "GET", body = null) {
    try {
        const opts = { method, headers: { "Content-Type": "application/json" } };
        if (body) opts.body = JSON.stringify(body);
        const resp = await fetch(`http://${HUE_BRIDGE_IP}${endpoint}`, opts);
        if (resp.ok) {
            return await resp.json();
        }
    } catch (e) {
        console.warn("[HUE] Network error on", endpoint, e);
    }
    return null;
}

async function syncRealHueState() {
    if (!hueUser) return;
    const data = await hueRequest(`/api/${hueUser}/groups/0`);
    if (data && data.state) {
        const anyOn = !!data.state.any_on;
        actionContexts["com.laoy.streamdock.hue.toggle"].forEach(ctx => {
            if (!lightStates[ctx]) lightStates[ctx] = { on: false, sceneIndex: 0 };
            lightStates[ctx].on = anyOn;
            updateToggleKeyVisual(ctx, anyOn);
        });
    }

    // Also fetch scenes
    const scenes = await hueRequest(`/api/${hueUser}/scenes`);
    if (scenes && typeof scenes === "object") {
        hueScenes = Object.keys(scenes).map(id => ({ id, name: scenes[id].name }));
    }
}

async function startPairingFlow(context) {
    if (isPairing) return;
    isPairing = true;
    sendTitle(context, "Appuie\nPont Hue");
    console.log("[HUE] Starting pairing flow, waiting for Hue link button...");

    let attempts = 0;
    pairingInterval = setInterval(async () => {
        attempts++;
        const res = await hueRequest("/api", "POST", { devicetype: "crimsons#streamdock" });
        if (res && res[0] && res[0].success && res[0].success.username) {
            clearInterval(pairingInterval);
            isPairing = false;
            hueUser = res[0].success.username;
            localStorage.setItem("hue_username", hueUser);
            sendTitle(context, "Connecté !");
            console.log("[HUE] Paired successfully with Hue Bridge! User:", hueUser);
            setTimeout(() => syncRealHueState(), 1200);
            return;
        }

        if (attempts >= 20) { // 30 seconds timeout
            clearInterval(pairingInterval);
            isPairing = false;
            sendTitle(context, "OFF");
            console.log("[HUE] Pairing timed out.");
        }
    }, 1500);
}

async function toggleHueLight(context) {
    if (!lightStates[context]) lightStates[context] = { on: false, sceneIndex: 0 };
    const st = lightStates[context];

    // If not paired yet, try pairing or prompt
    if (!hueUser) {
        await startPairingFlow(context);
        return;
    }

    // Toggle state immediately for 0-latency UI
    st.on = !st.on;
    updateToggleKeyVisual(context, st.on);

    // Send command to real Philips Hue bridge
    const res = await hueRequest(`/api/${hueUser}/groups/0/action`, "PUT", { on: st.on });
    console.log("[HUE] Toggled group 0 to:", st.on, res);
}

async function cycleHueScene(context) {
    if (!lightStates[context]) lightStates[context] = { on: false, sceneIndex: 0 };
    const st = lightStates[context];

    if (!hueUser) {
        await startPairingFlow(context);
        return;
    }

    if (hueScenes.length === 0) {
        const scenes = await hueRequest(`/api/${hueUser}/scenes`);
        if (scenes && typeof scenes === "object") {
            hueScenes = Object.keys(scenes).map(id => ({ id, name: scenes[id].name }));
        }
    }

    if (hueScenes.length > 0) {
        st.sceneIndex = (st.sceneIndex + 1) % hueScenes.length;
        const currentScene = hueScenes[st.sceneIndex];
        sendTitle(context, currentScene.name.slice(0, 10));
        await hueRequest(`/api/${hueUser}/groups/0/action`, "PUT", { scene: currentScene.id });
        console.log("[HUE] Activated scene:", currentScene.name);
    } else {
        const fallback = ["Lecture", "Relax", "Ambiance", "Soirée"];
        st.sceneIndex = (st.sceneIndex + 1) % fallback.length;
        sendTitle(context, fallback[st.sceneIndex]);
    }
}

// -------------------------------------------------------------
// Hardware Event Handler
// -------------------------------------------------------------
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
            updateToggleKeyVisual(context, st.on);
            // Sync with real bridge if available
            syncRealHueState();
        } else if (action === "com.laoy.streamdock.hue.scene") {
            sendTitle(context, "Scènes");
            if (iconCache.scene) sendImage(context, iconCache.scene);
        }
    }

    if (event === "willDisappear") {
        if (actionContexts[action]) {
            actionContexts[action] = actionContexts[action].filter(c => c !== context);
        }
    }

    if (event === "keyUp" || event === "keyDown" || (event === "dialPress" && jsonObj.payload?.pressed)) {
        const now = Date.now();
        if (lightStates[context] && lightStates[context]._lastPress && (now - lightStates[context]._lastPress < 200)) {
            return;
        }
        if (!lightStates[context]) lightStates[context] = { on: false, sceneIndex: 0 };
        lightStates[context]._lastPress = now;

        if (action === "com.laoy.streamdock.hue.toggle") {
            toggleHueLight(context);
        } else if (action === "com.laoy.streamdock.hue.scene") {
            cycleHueScene(context);
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
            // Initial sync
            setTimeout(() => {
                syncRealHueState();
            }, 300);
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
