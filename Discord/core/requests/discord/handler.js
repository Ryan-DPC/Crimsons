/**
 * core/requests/discord/handler.js
 *
 * Centralised Discord action handler.
 * All Discord RPC calls and shortcut simulations previously inline in app.js
 * are now defined here as named, documented, and independently testable functions.
 *
 * Usage (from executor.js):
 *   const result = await execute(action, params, { rpc, currentVoiceSettings, currentVideoState, ... });
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { log, logError, logSuccess } = require('../../logger');

const MODULE = 'discord/handler';

// ─── Action Router ─────────────────────────────────────────────────────────

/**
 * Main entry point called by executor.js.
 * @param {string} action  - camelCase action name (e.g. "toggleMute")
 * @param {object} params  - action parameters from the button press
 * @param {object} context - live runtime objects { rpc, currentVoiceSettings, currentVideoState, currentVoiceChannelId, voiceChannelContexts }
 * @returns {{ success: boolean, result?: any, error?: string }}
 */
async function execute(action, params = {}, context = {}) {
    log(MODULE, `execute(${action}) params=${JSON.stringify(params)}`);

    const { rpc } = context;

    try {
        switch (action) {
            case 'toggleMute':
                return await toggleMute(rpc, context.currentVoiceSettings);

            case 'toggleDeafen':
                return await toggleDeafen(rpc, context.currentVoiceSettings);

            case 'joinVoiceChannel':
                return await joinVoiceChannel(rpc, params.channelId, context.currentVoiceChannelId);

            case 'toggleCamera':
                return await toggleCamera(rpc, context.currentVideoState);

            case 'toggleScreenshare':
                return await toggleScreenshare(params, context);

            case 'playSoundboardSound':
                return await playSoundboardSound(rpc, params.soundId, params.guildId);

            case 'connect':
                // Connection is managed by the plugin itself (OAuth flow);
                // this action is a no-op at the handler level.
                log(MODULE, 'connect: delegated to plugin connection manager');
                return { success: true, result: 'delegated' };

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
 * Toggle microphone mute.
 * @param {DiscordRPC.Client} rpc
 * @param {{ mute: boolean }} currentVoiceSettings
 */
async function toggleMute(rpc, currentVoiceSettings = {}) {
    if (!rpc) return { success: false, error: 'RPC not connected' };
    const nextMute = !currentVoiceSettings.mute;
    await rpc.setVoiceSettings({ mute: nextMute });
    logSuccess(MODULE, `toggleMute → mute=${nextMute}`);
    return { success: true, result: { mute: nextMute } };
}

/**
 * Toggle headset deafen.
 * @param {DiscordRPC.Client} rpc
 * @param {{ deaf: boolean }} currentVoiceSettings
 */
async function toggleDeafen(rpc, currentVoiceSettings = {}) {
    if (!rpc) return { success: false, error: 'RPC not connected' };
    const nextDeaf = !currentVoiceSettings.deaf;
    await rpc.setVoiceSettings({ deaf: nextDeaf });
    logSuccess(MODULE, `toggleDeafen → deaf=${nextDeaf}`);
    return { success: true, result: { deaf: nextDeaf } };
}

/**
 * Join or leave a Discord voice channel.
 * If already in the target channel → leave. Otherwise → join.
 * @param {DiscordRPC.Client} rpc
 * @param {string} channelId
 * @param {string|null} currentVoiceChannelId
 */
async function joinVoiceChannel(rpc, channelId, currentVoiceChannelId) {
    if (!rpc) return { success: false, error: 'RPC not connected' };
    if (!channelId) return { success: false, error: 'No channelId provided' };

    if (currentVoiceChannelId === channelId) {
        log(MODULE, `joinVoiceChannel: leaving channel ${channelId}`);
        await rpc.selectVoiceChannel(null);
        logSuccess(MODULE, `left voice channel ${channelId}`);
        return { success: true, result: { action: 'left', channelId } };
    } else {
        log(MODULE, `joinVoiceChannel: joining channel ${channelId}`);
        await rpc.selectVoiceChannel(channelId, { force: true });
        logSuccess(MODULE, `joined voice channel ${channelId}`);
        return { success: true, result: { action: 'joined', channelId } };
    }
}

/**
 * Toggle webcam video.
 * @param {DiscordRPC.Client} rpc
 * @param {{ cameraOn: boolean }} currentVideoState
 */
async function toggleCamera(rpc, currentVideoState = {}) {
    if (!rpc) return { success: false, error: 'RPC not connected' };
    const nextCamera = !currentVideoState.cameraOn;
    await rpc.setVoiceSettings({ video_enabled: nextCamera });
    logSuccess(MODULE, `toggleCamera → cameraOn=${nextCamera}`);
    return { success: true, result: { cameraOn: nextCamera } };
}

/**
 * Toggle screenshare via a Discord keybind (PowerShell sendkeys).
 * Discord RPC has no programmatic screenshare API — keybind simulation is the
 * only reliable mechanism.
 *
 * Strategy: Focus the Discord window BEFORE sending the keybind, then restore
 * the previous foreground window. Discord ignores synthetic keybd_event calls
 * from background processes — it needs to be the active window.
 *
 * The user must configure in Discord:
 *   Settings → Keybinds → Add Keybind → "Toggle Screen Share" → Ctrl+Shift+F9
 *
 * @param {object} params  - { keybind, sourceId, sourceType }
 * @param {object} context - { currentVoiceChannelId, ... }
 */
async function toggleScreenshare(params = {}, context = {}) {
    const keybind = params.keybind || 'ctrl+shift+F9';
    log(MODULE, `toggleScreenshare: focusing Discord then simulating keybind ${keybind}`);

    const keyMap  = buildKeyMap();
    const parts   = keybind.split('+').map(k => k.trim());
    const vkCodes = parts.map(k => keyMap[k]).filter(v => v !== undefined);

    if (vkCodes.length === 0) {
        return { success: false, error: `No valid virtual key codes for keybind: ${keybind}` };
    }

    const tmpPs1  = path.join(__dirname, '_screenshare_send.ps1');
    const success = await simulateKeybindWithFocus(vkCodes, tmpPs1);

    if (success) {
        logSuccess(MODULE, `toggleScreenshare: keybind ${keybind} sent`);
        return { success: true, result: { keybind } };
    } else {
        return { success: false, error: 'PowerShell keybind simulation failed' };
    }
}

/**
 * Play a sound from the Discord Soundboard.
 * @param {DiscordRPC.Client} rpc
 * @param {string} soundId
 * @param {string} guildId
 */
async function playSoundboardSound(rpc, soundId, guildId) {
    if (!rpc) return { success: false, error: 'RPC not connected' };
    if (!soundId || !guildId) return { success: false, error: 'soundId and guildId are required' };

    const channelData = await rpc.request('GET_SELECTED_VOICE_CHANNEL', {});
    if (!channelData || !channelData.id) {
        return { success: false, error: 'Not in a voice channel — cannot play soundboard' };
    }

    await rpc.request('PLAY_SOUNDBOARD_SOUND', {
        channel_id: channelData.id,
        sound_id:   String(soundId),
        guild_id:   String(guildId)
    });

    logSuccess(MODULE, `playSoundboardSound: sound ${soundId} in channel ${channelData.id}`);
    return { success: true, result: { soundId, channelId: channelData.id } };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildKeyMap() {
    const map = {
        'ctrl': 0x11, 'shift': 0x10, 'alt': 0x12,
        'F1':  0x70, 'F2':  0x71, 'F3':  0x72, 'F4':  0x73,
        'F5':  0x74, 'F6':  0x75, 'F7':  0x76, 'F8':  0x77,
        'F9':  0x78, 'F10': 0x79, 'F11': 0x7A, 'F12': 0x7B,
        '0': 0x30, '1': 0x31, '2': 0x32, '3': 0x33, '4': 0x34,
        '5': 0x35, '6': 0x36, '7': 0x37, '8': 0x38, '9': 0x39
    };
    for (let c = 65; c <= 90; c++) {
        map[String.fromCharCode(c)]      = c;  // A-Z
        map[String.fromCharCode(c + 32)] = c;  // a-z → same VK
    }
    return map;
}

/**
 * Focus Discord's window, send the keybind, then restore the previous window.
 * This is required because Discord ignores keybd_event from background processes.
 */
function simulateKeybindWithFocus(vkCodes, tmpPath) {
    return new Promise(resolve => {
        const downLines = vkCodes.map(vk => `[Win32]::keybd_event(${vk}, 0, 0, 0)`).join('\r\n');
        const upLines   = [...vkCodes].reverse().map(vk => `[Win32]::keybd_event(${vk}, 0, 2, 0)`).join('\r\n');

        const ps1 = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, int dwExtraInfo);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
}
"@

# 1. Save current foreground window
$prevHwnd = [Win32]::GetForegroundWindow()

# 2. Find Discord window (exact title match first, then process scan)
$discordHwnd = [Win32]::FindWindow($null, "Discord")

if ($discordHwnd -eq [IntPtr]::Zero) {
    $procs = Get-Process | Where-Object { $_.MainWindowTitle -match "Discord" -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($procs) { $discordHwnd = $procs.MainWindowHandle }
}

# 3. Focus Discord
if ($discordHwnd -ne [IntPtr]::Zero) {
    [Win32]::SetForegroundWindow($discordHwnd) | Out-Null
    Start-Sleep -Milliseconds 200
} else {
    Write-Host "WARN: Discord window not found, sending keys without focus change"
}

# 4. Send keybind
${downLines}
Start-Sleep -Milliseconds 80
${upLines}
Start-Sleep -Milliseconds 150

# 5. Restore previous window
if ($prevHwnd -ne [IntPtr]::Zero) {
    [Win32]::SetForegroundWindow($prevHwnd) | Out-Null
}
Write-Host "OK"
`;

        try {
            fs.writeFileSync(tmpPath, ps1, 'utf8');
            require('child_process').exec(
                `powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpPath}"`,
                (err, stdout, stderr) => {
                    try { fs.unlinkSync(tmpPath); } catch (_) {}
                    if (err) {
                        logError(MODULE, `simulateKeybind failed: ${stderr}`);
                        resolve(false);
                    } else {
                        log(MODULE, `simulateKeybind PS output: ${stdout.trim()}`);
                        resolve(true);
                    }
                }
            );
        } catch (e) {
            logError(MODULE, 'simulateKeybind write error', e);
            resolve(false);
        }
    });
}

module.exports = { execute, toggleMute, toggleDeafen, joinVoiceChannel, toggleCamera, toggleScreenshare, playSoundboardSound };
