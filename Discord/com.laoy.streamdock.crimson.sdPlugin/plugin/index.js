const crimsonWs = new WebSocket('ws://localhost:40509');
let streamDeckSocket = null;
let globalPluginUUID = "";
let actionContexts = {
    "com.laoy.streamdock.crimson.autoaccept": [],
    "com.laoy.streamdock.crimson.dodge": [],
    "com.laoy.streamdock.crimson.display": [],
    "com.laoy.streamdock.crimson.autoban": [],
    "com.laoy.streamdock.crimson.autopick": [],
    "com.laoy.streamdock.crimson.inject": [],
    "com.laoy.streamdock.crimson.globalautomation": []
};

// Global plugin state
let currentPhase = "None";
let lastRank = { tier: "", division: "", lp: 0 };
let currentChampion = 0;
let currentChampionName = ""; 
let contextSettings = {}; // Store settings for each context

function connectElgatoStreamDeckSocket(inPort, inPluginUUID, inRegisterEvent, inInfo) {
    globalPluginUUID = inPluginUUID;
    streamDeckSocket = new WebSocket("ws://127.0.0.1:" + inPort);

    streamDeckSocket.onopen = function () {
        const json = { "event": inRegisterEvent, "uuid": inPluginUUID };
        streamDeckSocket.send(JSON.stringify(json));
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
            contextSettings[context] = payload.settings || {};
            updateDisplay(context, action);
        }

        if (event === "didReceiveSettings") {
            contextSettings[context] = payload.settings || {};
            updateDisplay(context, action);
        }

        if (event === "sendToPlugin") {
            handlePIEvent(action, context, payload);
        }

        if (event === "willDisappear") {
            if (actionContexts[action]) {
                actionContexts[action] = actionContexts[action].filter(c => c !== context);
            }
            delete contextSettings[context];
        }

        if (event === "keyDown") {
            handleKeyDown(action, context);
        }
    };

    crimsonWs.onmessage = function (event) {
        try {
            const data = JSON.parse(event.data);
            handleCrimsonMessage(data);
        } catch (e) { console.error("Crimson WS Error", e); }
    }
}

function handlePIEvent(action, context, payload) {
    if (payload.type === 'GET_PI_DATA' || payload.type === 'REFRESH_BUILDS') {
        if (action.includes('inject')) {
            crimsonWs.send(JSON.stringify({ 
                type: 'GET_BUILDS', 
                championId: currentChampion,
                championName: currentChampionName
            }));
        }
    }
}

// ── REFACTORED handleKeyDown (Step 5) ────────────────────────────────────────
// All business logic is now routed through core/requests/crimson/handler.js.
// Original crimsonWs.send() calls are preserved as comments for Step 6 validation.

function handleKeyDown(action, context) {
    if (crimsonWs.readyState !== WebSocket.OPEN) return;

    const settings = contextSettings[context] || {};

    let execAction = null;
    let execParams = {};

    switch (action) {
        case "com.laoy.streamdock.crimson.autoaccept":
            execAction = 'toggleAutoAccept';
            break;

        case "com.laoy.streamdock.crimson.dodge":
            execAction = 'dodgeGame';
            break;

        case "com.laoy.streamdock.crimson.autoban":
            execAction = 'toggleAutoBan';
            execParams = { championId: 0 };
            break;

        case "com.laoy.streamdock.crimson.autopick":
            execAction = 'toggleAutoPick';
            execParams = { championId: 0 };
            break;

        case "com.laoy.streamdock.crimson.globalautomation":
            execAction = 'toggleGlobalAutomation';
            break;

        case "com.laoy.streamdock.crimson.inject": {
            let build = null;
            if (settings.proBuilds && settings.selectedIndex !== undefined) {
                build = settings.proBuilds[settings.selectedIndex];
            }
            execAction = 'injectBuild';
            execParams = {
                championId:    currentChampion,
                championName:  currentChampionName,
                role:          build ? (build.role || 'mid') : 'mid',
                specificBuild: build || null
            };
            break;
        }
    }

    if (execAction) {
        // ── NEW: Route through the crimson handler ──
        _getCrimsonHandler().execute(execAction, execParams, { ws: crimsonWs })
            .then(res => { if (!res.success) console.error(`[crimson] ${execAction} failed:`, res.error); })
            .catch(err => console.error(`[crimson] ${execAction} threw:`, err));

        /* ── ORIGINAL CODE (preserved for Step 6 validation) ─────────────────
        switch (action) {
            case "com.laoy.streamdock.crimson.autoaccept":
                crimsonWs.send(JSON.stringify({ type: 'TOGGLE_AUTO_ACCEPT' }));
                break;
            case "com.laoy.streamdock.crimson.dodge":
                crimsonWs.send(JSON.stringify({ type: 'DODGE_GAME' }));
                break;
            case "com.laoy.streamdock.crimson.autoban":
                crimsonWs.send(JSON.stringify({ type: 'TOGGLE_AUTO_BAN', championId: 0 }));
                break;
            case "com.laoy.streamdock.crimson.autopick":
                crimsonWs.send(JSON.stringify({ type: 'TOGGLE_AUTO_PICK', championId: 0 }));
                break;
            case "com.laoy.streamdock.crimson.globalautomation":
                crimsonWs.send(JSON.stringify({ type: 'TOGGLE_GLOBAL_AUTOMATION' }));
                break;
            case "com.laoy.streamdock.crimson.inject":
                crimsonWs.send(JSON.stringify({ ... }));
                break;
        }
        ─────────────────────────────────────────────────────────────────────── */
    }
}

/**
 * Lazily load the CRIMSON handler.
 * Works in both:
 *   - Node.js (plugin backend) via require()
 *   - Browser/webview (plugin frontend) via a direct-WS shim
 */
let _crimsonHandlerCache = null;
function _getCrimsonHandler() {
    if (_crimsonHandlerCache) return _crimsonHandlerCache;

    try {
        if (typeof require !== 'undefined') {
            _crimsonHandlerCache = require('../../core/requests/crimson/handler');
            return _crimsonHandlerCache;
        }
    } catch (e) { /* browser context, use shim below */ }

    // Browser fallback shim — maps execute() back to direct WS messages
    _crimsonHandlerCache = {
        execute: async function(action, params, ctx) {
            const ws = ctx && ctx.ws;
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                return { success: false, error: 'WS not open (browser shim)' };
            }
            const typeMap = {
                toggleAutoAccept:       'TOGGLE_AUTO_ACCEPT',
                dodgeGame:              'DODGE_GAME',
                toggleAutoBan:          'TOGGLE_AUTO_BAN',
                toggleAutoPick:         'TOGGLE_AUTO_PICK',
                toggleGlobalAutomation: 'TOGGLE_GLOBAL_AUTOMATION',
                injectBuild:            'INJECT_BUILD',
                getBuilds:              'GET_BUILDS'
            };
            const type = typeMap[action];
            if (!type) return { success: false, error: `Unknown action: ${action}` };
            ws.send(JSON.stringify({ type, ...params }));
            return { success: true };
        }
    };
    return _crimsonHandlerCache;
}



function handleCrimsonMessage(data) {
    switch (data.type) {
        case 'AUTO_ACCEPT_STATE':
            updateActionState("com.laoy.streamdock.crimson.autoaccept", data.enabled ? 1 : 0);
            break;
        case 'GAME_PHASE':
            currentPhase = data.phase;
            updateAllDisplays();
            break;
        case 'CHAMP_SELECT':
            currentChampion = data.championId;
            currentChampionName = data.championName || "";
            updateAllDisplays();
            // Trigger build refresh if any inject PI is open (simulated by broadcasting to all)
            sendToPI({ type: 'REFRESH_BUILDS_LIST', builds: [] }); 
            break;
        case 'RANK_UPDATE':
            lastRank = data;
            updateAllDisplays();
            break;
        case 'BUILDS_LIST':
            sendToPI({ type: 'REFRESH_BUILDS_LIST', builds: data.builds });
            // Save builds to settings of active inject actions so they persist in UI
            updateInjectActionSettings(data.builds);
            break;
        case 'AUTO_BAN_STATE':
            updateActionState("com.laoy.streamdock.crimson.autoban", data.championId ? 1 : 0);
            break;
        case 'AUTO_PICK_STATE':
            updateActionState("com.laoy.streamdock.crimson.autopick", data.championId ? 1 : 0);
            break;
        case 'GLOBAL_AUTOMATION_STATE':
            updateActionState("com.laoy.streamdock.crimson.globalautomation", data.enabled ? 1 : 0);
            break;
    }
}

function updateInjectActionSettings(builds) {
    const action = "com.laoy.streamdock.crimson.inject";
    const contexts = actionContexts[action] || [];
    contexts.forEach(context => {
        let settings = contextSettings[context] || {};
        settings.proBuilds = builds;
        contextSettings[context] = settings;
        streamDeckSocket.send(JSON.stringify({
            event: "setSettings",
            context: context,
            payload: settings
        }));
    });
}

function sendToPI(payload) {
    if (!streamDeckSocket || streamDeckSocket.readyState !== WebSocket.OPEN) return;
    Object.keys(actionContexts).forEach(action => {
        actionContexts[action].forEach(context => {
            streamDeckSocket.send(JSON.stringify({
                event: "sendToPropertyInspector",
                action: action,
                context: context,
                payload: payload
            }));
        });
    });
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

function updateAllDisplays() {
    Object.keys(actionContexts).forEach(action => {
        actionContexts[action].forEach(context => updateDisplay(context, action));
    });
}

function updateDisplay(context, action) {
    if (!streamDeckSocket || streamDeckSocket.readyState !== WebSocket.OPEN) return;

    const settings = contextSettings[context] || {};

    if (action === "com.laoy.streamdock.crimson.display") {
        let title = "";
        let value = "";
        let image = "static/icon/stats.png";

        const mode = settings.displayMode || "RANK";

        switch(mode) {
            case "CHAMPION":
                title = currentChampionName || "PROCHAIN";
                value = currentChampion > 0 ? "ID: " + currentChampion : "EN ATTENTE";
                break;
            case "LP":
                title = lastRank.tier || "LP";
                value = `${lastRank.lp} LP (${lastRank.division})`;
                break;
            case "WINS":
                title = "STATS";
                value = "W/L: 0/0"; // Placeholder as backend doesn't send this yet
                break;
            default: // RANK
                title = lastRank.tier !== "UNRANKED" ? lastRank.tier : "RANK";
                value = lastRank.tier !== "UNRANKED" ? `${lastRank.division} ${lastRank.lp} LP` : "UNRANKED";
        }
        
        // Multi-controller support
        // We check if it's the side display by trying to send to Information first (SD software handles it)
        // For Ajazz, we usually just send setTitle and it works, but some use setPayload
        
        streamDeckSocket.send(JSON.stringify({
            "event": "setPayload",
            "context": context,
            "payload": { "title": title, "value": value, "image": image }
        }));
        
        streamDeckSocket.send(JSON.stringify({
            "event": "setTitle",
            "context": context,
            "payload": { "title": title + "\n" + value, "target": 0 }
        }));
    }
    
    if (action === "com.laoy.streamdock.crimson.dodge") {
        const visible = currentPhase === "ChampSelect" || currentPhase === "Lobby";
        streamDeckSocket.send(JSON.stringify({
            "event": "setTitle",
            "context": context,
            "payload": { "title": visible ? "DODGE" : "", "target": 0 }
        }));
    }
}
