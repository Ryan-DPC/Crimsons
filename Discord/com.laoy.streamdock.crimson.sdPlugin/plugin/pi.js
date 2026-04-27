let websocket = null;
let uuid = null;
let actionInfo = null;
let settings = {};

function connectElgatoStreamDeckSocket(inPort, inUUID, inRegisterEvent, inInfo, inActionInfo) {
    uuid = inUUID;
    actionInfo = JSON.parse(inActionInfo);
    settings = actionInfo.payload.settings;

    websocket = new WebSocket('ws://127.0.0.1:' + inPort);

    websocket.onopen = function () {
        websocket.send(JSON.stringify({
            event: inRegisterEvent,
            uuid: inUUID
        }));
        
        // Request initial data from plugin
        sendToPlugin({ type: 'GET_PI_DATA' });
    };

    websocket.onmessage = function (evt) {
        let j = JSON.parse(evt.data);
        if (j.event === 'didReceiveSettings') {
            settings = j.payload.settings;
            refreshUI();
        } else if (j.event === 'sendToPropertyInspector') {
            handlePluginMessage(j.payload);
        }
    };

    refreshUI();
}

function sendToPlugin(payload) {
    websocket.send(JSON.stringify({
        event: 'sendToPlugin',
        action: actionInfo.action,
        context: uuid,
        payload: payload
    }));
}

function saveSettings() {
    websocket.send(JSON.stringify({
        event: 'setSettings',
        context: uuid,
        payload: settings
    }));
}

function refreshUI() {
    const content = document.getElementById('pi-content');
    const action = actionInfo.action;

    if (action.includes('inject')) {
        renderInjectBuildUI(content);
    } else if (action.includes('display')) {
        renderDisplayUI(content);
    } else {
        content.innerHTML = '<div class="sdpi-item">Aucun paramètre pour cette action.</div>';
    }
}

function renderInjectBuildUI(container) {
    let html = `
        <div class="sdpi-item">
            <label>SÉLECTION DU BUILD (PROS)</label>
            <div id="builds-list">
                ${settings.proBuilds ? settings.proBuilds.map((b, i) => `
                    <div class="build-card ${settings.selectedIndex === i ? 'selected' : ''}" onclick="selectBuild(${i})">
                        <div class="build-name">${b.name}</div>
                        <div class="build-perks">${b.role} - Perks: ${b.perk_ids.slice(0, 4).join(', ')}...</div>
                    </div>
                `).join('') : '<div class="loading">En attente de builds du jeu...</div>'}
            </div>
            <button class="sdpi-item-value" onclick="sendToPlugin({type: 'REFRESH_BUILDS'})">Actualiser</button>
        </div>
    `;
    container.innerHTML = html;
}

function selectBuild(index) {
    settings.selectedIndex = index;
    saveSettings();
    refreshUI();
}

function renderDisplayUI(container) {
    let html = `
        <div class="sdpi-item">
            <div class="sdpi-item-label">Affichage</div>
            <select class="sdpi-item-value" onchange="updateDisplayMode(this.value)">
                <option value="RANK" ${settings.displayMode === 'RANK' ? 'selected' : ''}>Rang (Rank)</option>
                <option value="CHAMPION" ${settings.displayMode === 'CHAMPION' ? 'selected' : ''}>Champion Actuel</option>
                <option value="LP" ${settings.displayMode === 'LP' ? 'selected' : ''}>LP / Delta</option>
                <option value="WINS" ${settings.displayMode === 'WINS' ? 'selected' : ''}>Victoires / Défaites</option>
            </select>
        </div>
    `;
    container.innerHTML = html;
}

function updateDisplayMode(val) {
    settings.displayMode = val;
    saveSettings();
}

function handlePluginMessage(payload) {
    if (payload.type === 'REFRESH_BUILDS_LIST') {
        settings.proBuilds = payload.builds;
        refreshUI();
    }
}

// Global function for SD software
window.connectElgatoStreamDeckSocket = connectElgatoStreamDeckSocket;
