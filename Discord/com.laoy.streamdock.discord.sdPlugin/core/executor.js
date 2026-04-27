/**
 * core/executor.js
 *
 * Central action executor for the Stream Deck plugin ecosystem.
 *
 * Usage:
 *   const { executeAction } = require('./core/executor');
 *   const result = await executeAction('discord', 'toggleMute', { ... }, runtimeContext);
 *
 * The executor:
 *  1. Looks up the registered app from config/apps.json
 *  2. Dynamically loads the correct handler module
 *  3. Calls handler.execute(action, params, context)
 *  4. Logs every transformation with timing
 *  5. Returns a normalised { success, result?, error? } object
 *
 * This file is the ONLY coupling point between plugins and their handlers.
 * Plugins import only this file — they never import handlers directly.
 */

'use strict';

const path = require('path');
const { log, logError, logSuccess } = require('./logger');

const MODULE      = 'executor';
const CONFIG_PATH = path.join(__dirname, 'config', 'apps.json');

// Cache loaded handlers to avoid repeated require() calls
const _handlerCache = new Map();

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Execute an action for a given app.
 *
 * @param {string} app     - registered app name, e.g. "discord" | "crimson"
 * @param {string} action  - camelCase action name, e.g. "toggleMute"
 * @param {object} params  - action-specific parameters (from button settings / key event)
 * @param {object} context - live runtime objects (rpc, ws, voiceSettings, …)
 *
 * @returns {Promise<{ success: boolean, result?: any, error?: string }>}
 */
async function executeAction(app, action, params = {}, context = {}) {
    const start = Date.now();
    log(MODULE, `executeAction(${app}, ${action}) START`);

    // 1. Validate app is registered
    const appConfig = getAppConfig(app);
    if (!appConfig) {
        const msg = `App "${app}" is not registered in apps.json`;
        logError(MODULE, msg);
        return { success: false, error: msg };
    }

    // 2. Load handler (cached)
    let handler;
    try {
        handler = loadHandler(app, appConfig.handler);
    } catch (err) {
        logError(MODULE, `Failed to load handler for "${app}"`, err);
        return { success: false, error: `Handler load error: ${err.message}` };
    }

    // 3. Validate execute function exists
    if (typeof handler.execute !== 'function') {
        const msg = `Handler for "${app}" does not export an execute() function`;
        logError(MODULE, msg);
        return { success: false, error: msg };
    }

    // 4. Execute
    let result;
    try {
        result = await handler.execute(action, params, context);
    } catch (err) {
        logError(MODULE, `handler.execute(${action}) threw an unhandled error`, err);
        result = { success: false, error: err.message };
    }

    // 5. Log outcome
    const elapsed = Date.now() - start;
    if (result && result.success) {
        logSuccess(MODULE, `executeAction(${app}, ${action}) → success [${elapsed}ms]`);
    } else {
        logError(MODULE, `executeAction(${app}, ${action}) → FAILED [${elapsed}ms]: ${result?.error}`);
    }

    return result || { success: false, error: 'Handler returned no result' };
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/** Load apps.json and return the config entry for the given app, or null. */
function getAppConfig(app) {
    try {
        // Re-read every time so hot-patching apps.json works without restart
        const config = require(CONFIG_PATH);
        return config[app] || null;
    } catch (err) {
        logError(MODULE, 'Failed to read apps.json', err);
        return null;
    }
}

/** Dynamically require a handler, using a cache. */
function loadHandler(app, relativeHandlerPath) {
    if (_handlerCache.has(app)) {
        return _handlerCache.get(app);
    }

    // Handler paths in apps.json are relative to the config/ directory
    const absPath = path.resolve(path.join(__dirname, 'config'), relativeHandlerPath);
    log(MODULE, `Loading handler for "${app}" from ${absPath}`);

    const handler = require(absPath);
    _handlerCache.set(app, handler);
    return handler;
}

/**
 * Flush the handler cache.
 * Call this if you modify a handler at runtime and want it reloaded.
 */
function flushHandlerCache(app) {
    if (app) {
        _handlerCache.delete(app);
    } else {
        _handlerCache.clear();
    }
}

module.exports = { executeAction, flushHandlerCache };
