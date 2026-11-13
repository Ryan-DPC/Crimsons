/**
 * HoopsLive OBS Chrono — StreamDock / Stream Deck plugin.
 * Calls the VPS HTTPS countdown API (store branch). Does NOT use crimson-server
 * as source of truth for the timer.
 *
 * Global settings (Property Inspector / didReceiveGlobalSettings):
 *   baseUrl  — HOOPSLIVE_OBS_PUBLIC_BASE, e.g. https://store.hoopslive.ch
 *   token    — HOOPSLIVE_OBS_TOKEN
 *   pollMs   — display title poll interval (default 400)
 *
 * Action settings (obs_scene only):
 *   sceneName — target OBS scene (stub; logged / local bridge attempt)
 */

const UUID = {
  display: 'com.laoy.streamdock.hoopslive-obs.display',
  toggle: 'com.laoy.streamdock.hoopslive-obs.toggle',
  pause: 'com.laoy.streamdock.hoopslive-obs.pause',
  resume: 'com.laoy.streamdock.hoopslive-obs.resume',
  reset: 'com.laoy.streamdock.hoopslive-obs.reset',
  stop: 'com.laoy.streamdock.hoopslive-obs.stop',
  add10: 'com.laoy.streamdock.hoopslive-obs.add10',
  add60: 'com.laoy.streamdock.hoopslive-obs.add60',
  sub10: 'com.laoy.streamdock.hoopslive-obs.sub10',
  obsScene: 'com.laoy.streamdock.hoopslive-obs.obs_scene',
};

/** @type {WebSocket|null} */
let sdSocket = null;
let pluginUUID = '';
/** @type {{ baseUrl?: string, token?: string, pollMs?: number }} */
let globalSettings = {};
/** @type {Record<string, Record<string, unknown>>} */
let settingsByContext = {};
/** @type {string[]} */
let displayContexts = [];
let pollTimer = null;

function fmt(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
}

function baseUrl() {
  const u = String(globalSettings.baseUrl || '').replace(/\/$/, '');
  return u;
}

function token() {
  return String(globalSettings.token || '').trim();
}

function pollMs() {
  const n = parseInt(String(globalSettings.pollMs || '400'), 10);
  return Number.isFinite(n) ? Math.min(2000, Math.max(250, n)) : 400;
}

function sendToSd(obj) {
  if (sdSocket && sdSocket.readyState === WebSocket.OPEN) {
    sdSocket.send(JSON.stringify(obj));
  }
}

function setTitle(context, title) {
  sendToSd({ event: 'setTitle', context, payload: { title: String(title), target: 0 } });
}

function showAlert(context) {
  sendToSd({ event: 'showAlert', context });
}

function showOk(context) {
  sendToSd({ event: 'showOk', context });
}

async function apiGet() {
  const base = baseUrl();
  const tok = token();
  if (!base || !tok) throw new Error('Missing baseUrl/token in global settings');
  const res = await fetch(base + '/api/hoopslive/obs/countdown', {
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer ' + tok,
      'X-HoopsLive-Token': tok,
    },
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function apiPost(action, extra) {
  const base = baseUrl();
  const tok = token();
  if (!base || !tok) throw new Error('Missing baseUrl/token in global settings');
  const body = Object.assign({ action }, extra || {});
  const res = await fetch(base + '/api/hoopslive/obs/countdown', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + tok,
      'X-HoopsLive-Token': tok,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function refreshDisplays() {
  if (!displayContexts.length) return;
  try {
    const snap = await apiGet();
    const title = fmt(snap.remainingSec) + (snap.running ? '' : ' ‖');
    for (const ctx of displayContexts) setTitle(ctx, title);
  } catch (e) {
    for (const ctx of displayContexts) setTitle(ctx, '--:--');
  }
}

function ensurePoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(refreshDisplays, pollMs());
  refreshDisplays();
}

/**
 * Bonus stub: try local crimson-server OBS bridge if present; otherwise log.
 * CRIMSONS sidecar currently has no obs-websocket module — this is intentional.
 */
async function stubObsScene(context) {
  const settings = settingsByContext[context] || {};
  const sceneName = String(settings.sceneName || settings.scene || '').trim();
  if (!sceneName) {
    console.warn('[HoopsLive OBS] obs_scene stub: set sceneName in Property Inspector');
    showAlert(context);
    return;
  }
  // Attempt optional local bridge (documented; expected to fail until implemented)
  try {
    const res = await fetch('http://127.0.0.1:40510/local/obs/scene', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene: sceneName }),
    });
    if (res.ok) {
      showOk(context);
      return;
    }
  } catch (_) {
    /* expected: no bridge */
  }
  console.warn('[HoopsLive OBS] obs_scene stub — no local OBS bridge. scene=', sceneName);
  setTitle(context, sceneName.slice(0, 8));
  showAlert(context);
}

async function handleKeyDown(action, context) {
  try {
    if (action === UUID.display) {
      await refreshDisplays();
      return;
    }
    if (action === UUID.obsScene) {
      await stubObsScene(context);
      return;
    }

    /** @type {Record<string, { action: string, extra?: object }>} */
    const map = {
      [UUID.toggle]: { action: 'toggle' },
      [UUID.pause]: { action: 'pause' },
      [UUID.resume]: { action: 'resume' },
      [UUID.reset]: { action: 'reset' },
      [UUID.stop]: { action: 'stop' },
      [UUID.add10]: { action: 'add', extra: { seconds: 10 } },
      [UUID.add60]: { action: 'add', extra: { seconds: 60 } },
      [UUID.sub10]: { action: 'add', extra: { seconds: -10 } },
    };
    const spec = map[action];
    if (!spec) return;
    const snap = await apiPost(spec.action, spec.extra);
    showOk(context);
    if (action === UUID.display || displayContexts.length) {
      const title = fmt(snap.remainingSec) + (snap.running ? '' : ' ‖');
      for (const ctx of displayContexts) setTitle(ctx, title);
    }
  } catch (e) {
    console.error('[HoopsLive OBS]', e);
    showAlert(context);
  }
}

function handleHardwareEvent(jsonObj) {
  const event = jsonObj.event;
  const action = jsonObj.action;
  const context = jsonObj.context;
  const payload = jsonObj.payload || {};

  if (event === 'willAppear') {
    if (payload.settings) settingsByContext[context] = payload.settings;
    if (action === UUID.display && !displayContexts.includes(context)) {
      displayContexts.push(context);
      ensurePoll();
    }
  }
  if (event === 'willDisappear') {
    displayContexts = displayContexts.filter((c) => c !== context);
    delete settingsByContext[context];
  }
  if (event === 'didReceiveSettings') {
    settingsByContext[context] = payload.settings || {};
  }
  if (event === 'didReceiveGlobalSettings') {
    globalSettings = (payload.settings || {});
    ensurePoll();
  }
  if (event === 'keyDown') {
    handleKeyDown(action, context);
  }
}

/**
 * StreamDock / Elgato entry point
 */
function connectElgatoStreamDeckSocket(inPort, inPluginUUID, inRegisterEvent) {
  pluginUUID = inPluginUUID;
  sdSocket = new WebSocket('ws://127.0.0.1:' + inPort);
  sdSocket.onopen = () => {
    sendToSd({ event: inRegisterEvent, uuid: inPluginUUID });
    sendToSd({ event: 'getGlobalSettings', context: inPluginUUID });
  };
  sdSocket.onmessage = (evt) => {
    try {
      handleHardwareEvent(JSON.parse(evt.data));
    } catch (e) {
      console.error('[HoopsLive OBS] parse', e);
    }
  };
  sdSocket.onclose = () => {
    console.warn('[HoopsLive OBS] StreamDock socket closed');
  };
}

// Export for StreamDock host
window.connectElgatoStreamDeckSocket = connectElgatoStreamDeckSocket;
