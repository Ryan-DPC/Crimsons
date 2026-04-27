/**
 * core/logger.js
 * Shared logging utility for the plugin core system.
 * Writes timestamped entries to core/core.log and to stdout.
 */

const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, 'core.log');

function log(module, msg) {
    try {
        const timestamp = new Date().toISOString();
        const line = `[${timestamp}] [${module}] ${msg}\n`;
        fs.appendFileSync(LOG_PATH, line);
        console.log(`CORE LOG: ${line.trim()}`);
    } catch (e) {
        // Fail silently to never break plugin execution
    }
}

function logError(module, msg, err) {
    const detail = err ? ` | ERROR: ${err.message || err}` : '';
    log(module, `❌ ${msg}${detail}`);
}

function logSuccess(module, msg) {
    log(module, `✅ ${msg}`);
}

module.exports = { log, logError, logSuccess };
