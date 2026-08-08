// App State
const actionContexts = {
    "com.laoy.streamdock.crimson.autoaccept": [],
    "com.laoy.streamdock.crimson.dodge": [],
    "com.laoy.streamdock.crimson.stats": [],
    "com.laoy.streamdock.crimson.champion": [],
    "com.laoy.streamdock.crimson.autoban": [],
    "com.laoy.streamdock.crimson.autopick": [],
    "com.laoy.streamdock.crimson.inject": [],
    "com.laoy.streamdock.crimson.infoboard": [],
    "com.laoy.streamdock.crimson.infoboard_lol": [],
    "com.laoy.streamdock.crimson.runeknob": [],
    "com.laoy.streamdock.crimson.volumeknob": [],
    "com.laoy.streamdock.crimson.account": []
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
    summoner: null,
};

let injectContextIndexes = {};
let injectCounter = 1;
let currentKnobRuneIndex = 1;

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

async function drawChampionIcon(context, championId) {
    try {
        ctx.clearRect(0, 0, 144, 144);
        const img = new Image();
        img.crossOrigin = "Anonymous";
        
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/${championId}.png`;
        });
        
        ctx.drawImage(img, 0, 0, 144, 144);
        const base64Img = canvas.toDataURL("image/jpeg", 0.9);
        ui.setImage(context, base64Img);
    } catch(e) {
        // Fallback to default
        ui.setImage(context, "static/icon/lol_champion.png");
    }
}

async function drawProfileIcon(context, profileIconId) {
    try {
        ctx.clearRect(0, 0, 144, 144);
        ctx.fillStyle = "#0a0a0c";
        ctx.fillRect(0, 0, 144, 144);
        const img = new Image();
        img.crossOrigin = "Anonymous";
        
        await new Promise((resolve) => {
            img.onload = resolve;
            img.onerror = resolve; // Fallback on error
            img.src = `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${profileIconId}.jpg`;
        });
        
        // Draw circular clipped profile icon
        ctx.save();
        ctx.beginPath();
        ctx.arc(72, 72, 68, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, 4, 4, 136, 136);
        ctx.restore();
        
        // Draw circle border
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(72, 72, 68, 0, Math.PI * 2);
        ctx.stroke();
        
        const base64Img = canvas.toDataURL("image/jpeg", 0.9);
        ui.setImage(context, base64Img);
    } catch(e) {
        ui.setImage(context, "static/icon/lol_account.png");
    }
}

async function drawAutoAcceptIcon(context, isEnabled) {
    try {
        ctx.clearRect(0, 0, 144, 144);
        ctx.fillStyle = "#121212";
        ctx.fillRect(0, 0, 144, 144);
        
        const img = new Image();
        await new Promise((resolve) => {
            img.onload = resolve;
            img.onerror = resolve;
            img.src = "static/icon/lol_autoaccept.png";
        });
        
        // Draw the shield icon in the center-top
        ctx.drawImage(img, 0, 0, 144, 144);
        
        // Draw text at the bottom
        ctx.fillStyle = isEnabled ? "#1db954" : "#ffffff"; // Spotify green or white
        ctx.font = "bold 28px 'Segoe UI', Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(isEnabled ? "ON" : "OFF", 72, 120);
        
        const base64Img = canvas.toDataURL("image/jpeg", 0.9);
        ui.setImage(context, base64Img);
    } catch(e) {
        // Fallback if canvas is tainted or fails
        ui.setImage(context, "static/icon/lol_autoaccept.png");
        ui.setTitle(context, isEnabled ? "ON" : "OFF");
    }
}

api.onMessage = (data) => {
    switch (data.type) {
        case 'AUTO_ACCEPT_STATE':
            gameState.autoAccept = data.enabled;
            refreshAllDisplays(); 
            break;
        case 'GAME_PHASE':
            gameState.phase = data.phase;
            if (data.phase === "None") {
                gameState.champion = 0;
                gameState.championName = "";
            }
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
        case 'SUMMONER_INFO':
            gameState.summoner = data;
            // Draw profile icon for account buttons
            actionContexts["com.laoy.streamdock.crimson.account"].forEach(ctx => {
                drawProfileIcon(ctx, data.profileIconId);
            });
            refreshAllDisplays();
            break;
        case 'HEARTBEAT_STATUS':
            if (gameState.serverConnected !== data.server || gameState.lolConnected !== data.lol || gameState.discordConnected !== data.discord) {
                gameState.serverConnected = data.server;
                gameState.lolConnected = data.lol;
                gameState.discordConnected = data.discord;
                updateContexts("com.laoy.streamdock.crimson.infoboard", data.server ? 1 : 0);
                updateContexts("com.laoy.streamdock.crimson.infoboard_lol", data.lol ? 1 : 0);
                refreshAllDisplays();
            }
            break;

    }
};

// ==========================================
// MODULAR SPOTIFY STATE SYNC
// ==========================================

spotifyApi.onMessage = (data) => {
    if (data.event === "setImageBroadcast" && data.payload) {
        const img = data.payload.image;
        Object.keys(actionContexts).forEach(action => {
            // Update Spotify buttons that are NOT playlists (they handle their own covers)
            if (action.includes("spotify") && !action.includes("playlist")) {
                actionContexts[action].forEach(ctx => {
                    ui.setImage(ctx, img);
                });
            }
        });
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
            drawAutoAcceptIcon(context, gameState.autoAccept);
            break;
        case "com.laoy.streamdock.crimson.stats":
            if (gameState.rank && gameState.rank.tier && gameState.rank.tier !== "UNRANKED") {
                title = `${gameState.rank.tier}\n${gameState.rank.division} ${gameState.rank.lp} LP`;
            } else {
                title = "RANK\nN/A";
            }
            // Use title instead of image
            break;
        case "com.laoy.streamdock.crimson.champion":
            if (gameState.champion > 0) {
                title = gameState.championName || "";
                drawChampionIcon(context, gameState.champion);
            } else {
                title = "CHAMPION";
                ui.setImage(context, "static/icon/lol_champion.png");
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
        case "com.laoy.streamdock.crimson.runeknob":
            title = "RUNE\n" + currentKnobRuneIndex;
            break;
        case "com.laoy.streamdock.crimson.volumeknob":
            title = "DISCORD\nVOL";
            break;
        case "com.laoy.streamdock.crimson.account":
            if (gameState.summoner && gameState.summoner.gameName) {
                title = gameState.summoner.gameName.split('#')[0];
                if (gameState.summoner.profileIconId) {
                    drawProfileIcon(context, gameState.summoner.profileIconId);
                }
            } else {
                title = "ACCOUNT";
                ui.setImage(context, "static/icon/lol_account.png");
            }
            break;
        case "com.laoy.streamdock.crimson.infoboard":
            if (gameState.serverConnected) {
                const discMark = gameState.discordConnected ? "\u2714" : "\u2716";
                const lolMark = gameState.lolConnected ? "\u2714" : "\u2716";
                title = `DISC ${discMark}\nLOL ${lolMark}`;
            } else {
                title = "OFFLINE";
            }
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
    const register = () => {
        api.send({
            type: 'REGISTER_STREAMDOCK',
            port: inPort,
            uuid: inPluginUUID,
            register_event: inRegisterEvent
        });
    };

    api.onOpen = register;

    if (api.isConnected) {
        register();
    }

    let streamDeckSocket = null;
    const connectHw = () => {
        if (api.isConnected) {
            console.log("Crimson Plugin: Crimson Server is active. Skipping direct hardware connection.");
            return;
        }

        streamDeckSocket = new WebSocket("ws://127.0.0.1:" + inPort);
        ui.setSocket(streamDeckSocket);

        streamDeckSocket.onopen = function () {
            console.log("StreamDock: Connected to hardware software.");
            streamDeckSocket.send(JSON.stringify({ "event": inRegisterEvent, "uuid": inPluginUUID }));
        };

        streamDeckSocket.onclose = function () {
            console.warn("Crimson Plugin: Hardware socket closed.");
            setTimeout(() => {
                if (!api.isConnected) {
                    connectHw();
                }
            }, 3000);
        };

        streamDeckSocket.onerror = function () {
            streamDeckSocket.close();
        };

        let lastClickTime = 0;
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
                const settings = jsonObj.payload && jsonObj.payload.settings;
                if (settings && settings.buildIndex) {
                    injectContextIndexes[context] = parseInt(settings.buildIndex);
                } else if (!injectContextIndexes[context]) {
                    injectContextIndexes[context] = injectCounter;
                    injectCounter = injectCounter >= 3 ? 1 : injectCounter + 1;
                    ui.saveSettings(context, { buildIndex: injectContextIndexes[context] });
                }
            }
            
            // Set initial state for toggles
            if (action === "com.laoy.streamdock.crimson.infoboard") {
                ui.setState(context, gameState.serverConnected ? 1 : 0);
            } else if (action === "com.laoy.streamdock.crimson.infoboard_lol") {
                ui.setState(context, gameState.lolConnected ? 1 : 0);
            }
            
            setTimeout(() => {
                updateDisplayLogic(context, action, controller);
            }, 150);
        }

        if (event === "didReceiveSettings") {
            const settings = jsonObj.payload && jsonObj.payload.settings;
            if (action === "com.laoy.streamdock.crimson.inject" && settings && settings.buildIndex) {
                injectContextIndexes[context] = parseInt(settings.buildIndex);
                updateDisplayLogic(context, action, controller);
            }
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

        if (event === "keyDown" || (event === "dialPress" && jsonObj['payload']?.pressed)) {
            const now = Date.now();
            if (now - lastClickTime > 200) {
                lastClickTime = now;
                handleActionClick(action, context);
            }
        }

        if (event === "dialRotate") {
            const ticks = jsonObj['payload']['ticks'];
            handleDialRotate(action, ticks);
        }
    };
    };

    window.connectHw = connectHw;
    connectHw();
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
        case "com.laoy.streamdock.crimson.runeknob":
            api.send({ 
                type: 'INJECT_BUILD', 
                index: currentKnobRuneIndex,
                championId: gameState.champion,
                championName: gameState.championName
            });
            break;
        case "com.laoy.streamdock.crimson.volumeknob":
            api.send({ type: 'TOGGLE_AUDIO_MUTE', target: "aux" });
            break;
        case "com.laoy.streamdock.crimson.spotify.play":
            spotifyApi.send({ type: "SPOTIFY_COMMAND", endpoint: "playpause" });
            break;
        case "com.laoy.streamdock.crimson.spotify.next":
            spotifyApi.send({ type: "SPOTIFY_COMMAND", endpoint: "next" });
            break;
        case "com.laoy.streamdock.crimson.spotify.prev":
            spotifyApi.send({ type: "SPOTIFY_COMMAND", endpoint: "prev" });
            break;
        case "com.laoy.streamdock.crimson.spotify.shuffle":
            spotifyApi.send({ type: "SPOTIFY_COMMAND", endpoint: "shuffle" });
            break;
        case "com.laoy.streamdock.crimson.infoboard":
        case "com.laoy.streamdock.crimson.infoboard_lol":
            if (!api.isConnected) api.forceReconnect();
            break;
    }
}

function handleDialRotate(action, ticks) {
    if (action === "com.laoy.streamdock.crimson.volumeknob") {
        api.send({ type: 'ADJUST_AUDIO', target: "aux", ticks: ticks });
    } else if (action === "com.laoy.streamdock.crimson.runeknob") {
        if (ticks > 0) currentKnobRuneIndex = currentKnobRuneIndex >= 3 ? 1 : currentKnobRuneIndex + 1;
        if (ticks < 0) currentKnobRuneIndex = currentKnobRuneIndex <= 1 ? 3 : currentKnobRuneIndex - 1;
        
        const injectContexts = actionContexts["com.laoy.streamdock.crimson.inject"] || [];
        injectContexts.forEach(ctx => {
            injectContextIndexes[ctx] = currentKnobRuneIndex;
            updateDisplayLogic(ctx, "com.laoy.streamdock.crimson.inject");
            ui.saveSettings(ctx, { buildIndex: currentKnobRuneIndex });
        });
        
        const knobContexts = actionContexts["com.laoy.streamdock.crimson.runeknob"] || [];
        knobContexts.forEach(ctx => {
            updateDisplayLogic(ctx, "com.laoy.streamdock.crimson.runeknob");
        });
    }
}
