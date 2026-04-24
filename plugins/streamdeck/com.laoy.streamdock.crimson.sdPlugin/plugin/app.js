// App State
const actionContexts = {
    "com.laoy.streamdock.crimson.autoaccept": [],
    "com.laoy.streamdock.crimson.dodge": [],
    "com.laoy.streamdock.crimson.display": [],
    "com.laoy.streamdock.crimson.autoban": [],
    "com.laoy.streamdock.crimson.autopick": [],
    "com.laoy.streamdock.crimson.inject": [],
    "com.laoy.streamdock.crimson.infoboard": [],
    "com.laoy.streamdock.crimson.infoboard_lol": [],
};

let gameState = {
    phase: "None",
    rank: { tier: "UNRANKED", division: "", lp: 0 },
    champion: 0,
    championName: "",
    autoAccept: false,
    autoBan: null,
    autoPick: null,
    serverConnected: false,
    lolConnected: false,
    runesData: null,
};

let injectContextIndexes = {};
let injectCounter = 1;

const canvas = document.createElement("canvas");
canvas.width = 144;
canvas.height = 144;
const ctx = canvas.getContext("2d");

async function composeRuneImage(context, primaryIconUrl, secondaryIconUrl) {
    try {
        ctx.clearRect(0, 0, 144, 144);
        ctx.fillStyle = "#0a0a0c";
        ctx.fillRect(0, 0, 144, 144);

        const img1 = new Image();
        img1.crossOrigin = "Anonymous";
        const img2 = new Image();
        img2.crossOrigin = "Anonymous";

        await Promise.all([
            new Promise((resolve) => { img1.onload = resolve; img1.onerror = resolve; img1.src = primaryIconUrl; }),
            new Promise((resolve) => { img2.onload = resolve; img2.onerror = resolve; img2.src = secondaryIconUrl; })
        ]);

        // Draw primary bigger
        ctx.globalAlpha = 1.0;
        ctx.drawImage(img1, 20, 10, 80, 80);
        
        // Draw secondary smaller at bottom right
        ctx.drawImage(img2, 70, 60, 60, 60);

        const base64Img = canvas.toDataURL("image/jpeg", 0.9);
        ui.setImage(context, base64Img);
    } catch(e) {}
}

api.onMessage = (data) => {
    switch (data.type) {
        case 'AUTO_ACCEPT_STATE':
            gameState.autoAccept = data.enabled;
            updateContexts("com.laoy.streamdock.crimson.autoaccept", data.enabled ? 1 : 0);
            refreshAllDisplays(); 
            break;
        case 'GAME_PHASE':
            gameState.phase = data.phase;
            refreshAllDisplays();
            break;
        case 'CHAMP_SELECT':
            gameState.champion = data.championId;
            gameState.championName = data.championName || "";
            refreshAllDisplays();
            break;
        case 'RANK_UPDATE':
            gameState.rank = data;
            refreshAllDisplays();
            break;
        case 'AUTO_BAN_STATE':
            gameState.autoBan = data.championId;
            updateContexts("com.laoy.streamdock.crimson.autoban", data.championId ? 1 : 0);
            refreshAllDisplays();
            break;
        case 'AUTO_PICK_STATE':
            gameState.autoPick = data.championId;
            updateContexts("com.laoy.streamdock.crimson.autopick", data.championId ? 1 : 0);
            refreshAllDisplays();
            break;
        case 'RUNE_BUILDS_READY':
            gameState.runesData = data.builds;
            refreshAllDisplays();
            break;
        case 'HEARTBEAT_STATUS':
            if (gameState.serverConnected !== data.server || gameState.lolConnected !== data.lol) {
                gameState.serverConnected = data.server;
                gameState.lolConnected = data.lol;
                updateContexts("com.laoy.streamdock.crimson.infoboard", data.server ? 1 : 0);
                updateContexts("com.laoy.streamdock.crimson.infoboard_lol", data.lol ? 1 : 0);
                refreshAllDisplays();
            }
            break;

    }
};

api.onStatusChange = (isConnected) => {
    if (isConnected) {
        gameState.serverConnected = true;
        updateContexts("com.laoy.streamdock.crimson.infoboard", 1);
        refreshAllDisplays();
    } else {
        gameState.serverConnected = false;
        gameState.lolConnected = false;
        updateContexts("com.laoy.streamdock.crimson.infoboard", 0);
        updateContexts("com.laoy.streamdock.crimson.infoboard_lol", 0);
        refreshAllDisplays();
    }
};

setInterval(() => {
    if (gameState.serverConnected) {
        refreshAllDisplays();
    }
}, 3 * 60 * 1000);

function updateContexts(action, stateId) {
    const contexts = actionContexts[action] || [];
    contexts.forEach(context => ui.setState(context, stateId));
}

function refreshAllDisplays() {
    Object.keys(actionContexts).forEach(action => {
        actionContexts[action].forEach(context => updateDisplayLogic(context, action));
    });
}

function updateDisplayLogic(context, action, controller = "Keypad") {
    let title = "";
    
    switch (action) {
        case "com.laoy.streamdock.crimson.autoaccept":
            title = gameState.autoAccept ? "ON" : "OFF";
            break;
        case "com.laoy.streamdock.crimson.display":
            if (gameState.phase === "ChampSelect") {
                title = gameState.championName || "DRAFT";
            } else {
                title = gameState.rank.tier !== "UNRANKED" ? `${gameState.rank.tier}\n${gameState.rank.lp}LP` : "RANK";
            }
            break;
        case "com.laoy.streamdock.crimson.dodge":
            if (gameState.phase === "ChampSelect" || gameState.phase === "Lobby") {
                title = "DODGE";
            }
            break;
        case "com.laoy.streamdock.crimson.autoban":
            title = gameState.autoBan ? "ON" : "OFF";
            break;
        case "com.laoy.streamdock.crimson.autopick":
            title = gameState.autoPick ? "ON" : "OFF";
            break;
        case "com.laoy.streamdock.crimson.inject":
            let idx = injectContextIndexes[context] || 1;
            title = "RUNES " + idx;
            if (gameState.runesData && gameState.runesData.length >= idx) {
                let b = gameState.runesData[idx - 1];
                if (b && b.name) {
                    title = b.name.replace(/\n| /g, "\n");
                    if (b.pIcon && b.sIcon) {
                        composeRuneImage(context, b.pIcon, b.sIcon);
                    }
                }
            }
            break;
        case "com.laoy.streamdock.crimson.infoboard":
            title = gameState.serverConnected ? "CONNECTED" : "OFFLINE";
            break;
        case "com.laoy.streamdock.crimson.infoboard_lol":
            title = gameState.lolConnected ? "CONNECTED" : "WAITING";
            break;

    }
    
    ui.setTitle(context, title);
}


// ==========================================
// 3. ELGATO PLUGIN REGISTRATION
// ==========================================
window.connectElgatoStreamDeckSocket = function(inPort, inPluginUUID, inRegisterEvent, inInfo) {
    const streamDeckSocket = new WebSocket("ws://127.0.0.1:" + inPort);
    ui.setSocket(streamDeckSocket);

    streamDeckSocket.onopen = function () {
        console.log("StreamDock: Connected to hardware software.");
        streamDeckSocket.send(JSON.stringify({ "event": inRegisterEvent, "uuid": inPluginUUID }));

        // Crimson Handover: Tell backend to take over hardware for rich rendering & button control
        api.send({
            type: 'REGISTER_STREAMDOCK',
            port: inPort,
            uuid: inPluginUUID,
            register_event: inRegisterEvent
        });
    };

    streamDeckSocket.onmessage = function (evt) {
        const jsonObj = JSON.parse(evt.data);
        const event = jsonObj['event'];
        const action = jsonObj['action'];
        const context = jsonObj['context'];
        const controller = jsonObj['controller'];

        if (event === "willAppear") {
            if (actionContexts[action] && !actionContexts[action].includes(context)) {
                actionContexts[action].push(context);
            }
            
            // Auto index inject buttons
            if (action === "com.laoy.streamdock.crimson.inject") {
                if (!injectContextIndexes[context]) {
                    injectContextIndexes[context] = injectCounter;
                    injectCounter = injectCounter >= 3 ? 1 : injectCounter + 1;
                }
            }
            
            // Set initial state for toggles
            if (action === "com.laoy.streamdock.crimson.autoaccept") {
                ui.setState(context, gameState.autoAccept ? 1 : 0);
            } else if (action === "com.laoy.streamdock.crimson.infoboard") {
                ui.setState(context, gameState.serverConnected ? 1 : 0);
            } else if (action === "com.laoy.streamdock.crimson.infoboard_lol") {
                ui.setState(context, gameState.lolConnected ? 1 : 0);
            }
            
            updateDisplayLogic(context, action, controller);
        }

        if (event === "willDisappear") {
            if (actionContexts[action]) {
                actionContexts[action] = actionContexts[action].filter(c => c !== context);
            }
            if (action === "com.laoy.streamdock.crimson.inject") {
                delete injectContextIndexes[context];
                injectCounter = 1; // Reset when plugin restarts
            }
        }

        if (event === "keyDown" || event === "dialPress") {
            handleActionClick(action, context);
        }

        if (event === "dialRotate") {
            const ticks = jsonObj['payload']['ticks'];
            handleDialRotate(action, ticks);
        }
    };
};


// ==========================================
// 4. ELGATO INPUT ROUTER
// ==========================================
function handleActionClick(action, context) {
    switch (action) {
        case "com.laoy.streamdock.crimson.autoaccept":
            api.send({ type: 'TOGGLE_AUTO_ACCEPT' });
            break;
        case "com.laoy.streamdock.crimson.dodge":
            api.send({ type: 'DODGE_GAME' });
            break;
        case "com.laoy.streamdock.crimson.autoban":
            api.send({ type: 'TOGGLE_AUTO_BAN', championId: 0 });
            break;
        case "com.laoy.streamdock.crimson.autopick":
            api.send({ type: 'TOGGLE_AUTO_PICK', championId: 0 });
            break;
        case "com.laoy.streamdock.crimson.inject":
            let idx = injectContextIndexes[context] || 1;
            api.send({ 
                type: 'INJECT_BUILD', 
                index: idx,
                championId: gameState.champion,
                championName: gameState.championName
            });
            break;
        case "com.laoy.streamdock.crimson.infoboard":
        case "com.laoy.streamdock.crimson.infoboard_lol":
            if (!api.isConnected) api.forceReconnect();
            break;
    }
}

function handleDialRotate(action, ticks) {
    // Currently no LoL actions use dial rotation
}

