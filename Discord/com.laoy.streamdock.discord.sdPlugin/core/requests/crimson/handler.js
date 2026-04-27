/**
 * core/requests/crimson/handler.js
 *
 * Centralised CRIMSON (League of Legends) action handler.
 * Manages the persistent WebSocket connection to the Tauri backend (port 40509)
 * and exposes every action as a named, documented function.
 *
 * Usage (from executor.js):
 *   const result = await execute(action, params, { ws });
 *
 * Note: The `ws` WebSocket instance is created and owned by the CRIMSON plugin
 * (com.laoy.streamdock.crimson.sdPlugin). The handler receives it as a context
 * argument so it never has to manage its lifecycle.
 */

'use strict';

const { log, logError, logSuccess } = require('../../logger');

const MODULE  = 'crimson/handler';
const WS_PORT = 40509;

// ─── Internal WebSocket management (for standalone / executor usage) ─────────

let _ws       = null;
let _ready    = false;
let _queue    = [];

/**
 * Get or create a WebSocket connection to the CRIMSON backend.
 * Returns a Promise that resolves once the socket is open.
 */
function getWs() {
    return new Promise((resolve, reject) => {
        if (_ws && _ws.readyState === 1 /* OPEN */) {
            return resolve(_ws);
        }

        log(MODULE, `Connecting to CRIMSON backend ws://127.0.0.1:${WS_PORT}`);
        // Node.js environment: use the 'ws' package if available, else WebSocket global
        const WS = (typeof WebSocket !== 'undefined') ? WebSocket : (() => {
            try { return require('ws'); } catch (e) { return null; }
        })();

        if (!WS) {
            return reject(new Error('No WebSocket implementation available'));
        }

        _ws = new WS(`ws://127.0.0.1:${WS_PORT}`);

        _ws.onopen = () => {
            _ready = true;
            log(MODULE, 'Connected to CRIMSON backend');
            resolve(_ws);
        };

        _ws.onerror = (err) => {
            logError(MODULE, 'WebSocket error', err);
            reject(new Error('WebSocket connection failed'));
        };

        _ws.onclose = () => {
            _ready = false;
            _ws    = null;
            log(MODULE, 'Disconnected from CRIMSON backend');
        };
    });
}

/**
 * Send a message to the CRIMSON backend.
 * @param {object} payload
 * @param {WebSocket} [wsOverride] - pass an existing socket (from plugin context)
 */
async function send(payload, wsOverride) {
    const ws = wsOverride || await getWs();
    if (!ws || ws.readyState !== 1) {
        return { success: false, error: 'CRIMSON WebSocket not open' };
    }
    ws.send(JSON.stringify(payload));
    return { success: true };
}

// ─── Action Router ───────────────────────────────────────────────────────────

/**
 * Main entry point called by executor.js.
 * @param {string} action
 * @param {object} params
 * @param {object} context - { ws } (plugin's existing WebSocket connection, optional)
 * @returns {{ success: boolean, result?: any, error?: string }}
 */
async function execute(action, params = {}, context = {}) {
    log(MODULE, `execute(${action}) params=${JSON.stringify(params)}`);

    const ws = context.ws || null;

    try {
        switch (action) {
            case 'toggleAutoAccept':
                return await toggleAutoAccept(ws);

            case 'dodgeGame':
                return await dodgeGame(ws);

            case 'toggleAutoBan':
                return await toggleAutoBan(ws, params.championId || 0);

            case 'toggleAutoPick':
                return await toggleAutoPick(ws, params.championId || 0);

            case 'toggleGlobalAutomation':
                return await toggleGlobalAutomation(ws);

            case 'injectBuild':
                return await injectBuild(ws, params);

            case 'getBuilds':
                return await getBuilds(ws, params);

            default:
                logError(MODULE, `Unknown action: ${action}`);
                return { success: false, error: `Unknown action: ${action}` };
        }
    } catch (err) {
        logError(MODULE, `execute(${action}) threw`, err);
        return { success: false, error: err.message };
    }
}

// ─── Individual Action Implementations ──────────────────────────────────────

/**
 * Toggle automatic match accept.
 */
async function toggleAutoAccept(ws) {
    const res = await send({ type: 'TOGGLE_AUTO_ACCEPT' }, ws);
    if (res.success) logSuccess(MODULE, 'toggleAutoAccept sent');
    return res;
}

/**
 * Dodge the current champion select / lobby via LCU API.
 */
async function dodgeGame(ws) {
    const res = await send({ type: 'DODGE_GAME' }, ws);
    if (res.success) logSuccess(MODULE, 'dodgeGame sent');
    return res;
}

/**
 * Toggle auto-ban for a champion.
 * @param {WebSocket} ws
 * @param {number} championId
 */
async function toggleAutoBan(ws, championId = 0) {
    const res = await send({ type: 'TOGGLE_AUTO_BAN', championId }, ws);
    if (res.success) logSuccess(MODULE, `toggleAutoBan championId=${championId}`);
    return res;
}

/**
 * Toggle auto-pick for a champion.
 * @param {WebSocket} ws
 * @param {number} championId
 */
async function toggleAutoPick(ws, championId = 0) {
    const res = await send({ type: 'TOGGLE_AUTO_PICK', championId }, ws);
    if (res.success) logSuccess(MODULE, `toggleAutoPick championId=${championId}`);
    return res;
}

/**
 * Toggle all automation (auto-ban + auto-pick) as a group.
 */
async function toggleGlobalAutomation(ws) {
    const res = await send({ type: 'TOGGLE_GLOBAL_AUTOMATION' }, ws);
    if (res.success) logSuccess(MODULE, 'toggleGlobalAutomation sent');
    return res;
}

/**
 * Fetch the best rune page for the current champion and inject it into the League client.
 * @param {WebSocket} ws
 * @param {object} params - { championId, championName, role, specificBuild }
 */
async function injectBuild(ws, params = {}) {
    const { championId, championName = '', role = 'mid', specificBuild = null } = params;

    if (!championId || championId === 0) {
        return { success: false, error: 'injectBuild: no valid championId' };
    }

    const payload = {
        type:        'INJECT_BUILD',
        championId,
        championName,
        role
    };

    // Pass along a specific build if the user selected one in the property inspector
    if (specificBuild) {
        payload.specificBuild = specificBuild;
    }

    const res = await send(payload, ws);
    if (res.success) logSuccess(MODULE, `injectBuild championId=${championId} role=${role}`);
    return res;
}

/**
 * Request the build list for a champion (used by property inspector).
 * @param {WebSocket} ws
 * @param {object} params - { championId, championName }
 */
async function getBuilds(ws, params = {}) {
    const { championId, championName = '' } = params;
    const res = await send({ type: 'GET_BUILDS', championId, championName }, ws);
    if (res.success) logSuccess(MODULE, `getBuilds championId=${championId}`);
    return res;
}

module.exports = {
    execute,
    toggleAutoAccept,
    dodgeGame,
    toggleAutoBan,
    toggleAutoPick,
    toggleGlobalAutomation,
    injectBuild,
    getBuilds,
    getWs   // exposed for advanced use
};
