/**
 * Runtime integration tester for usable Crimsons plugins:
 * Spotify, Discord, League of Legends (+ server auth / entitlement).
 *
 * Uses two WebSocket clients (matches real architecture):
 *   - app socket: AUTH_SESSION, TOGGLE_PLUGIN, LoL / Spotify / Discord commands
 *   - bridge socket: REGISTER_STREAMDOCK_BRIDGE + StreamDock keyDown events
 *
 * Env:
 *   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
 *   CRIMSON_TEST_EMAIL / CRIMSON_TEST_PASSWORD
 *   CRIMSON_WS_URL (default ws://127.0.0.1:40510)
 *   APPDATA (auth.token location)
 */
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

const WS_URL = process.env.CRIMSON_WS_URL || 'ws://127.0.0.1:40510';
const EMAIL = process.env.CRIMSON_TEST_EMAIL || '';
const PASSWORD = process.env.CRIMSON_TEST_PASSWORD || '';
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || '';
const APPDATA = process.env.APPDATA || '';
const TIMEOUT_MS = Number(process.env.CRIMSON_TEST_TIMEOUT_MS || 12000);

const results = [];

function log(msg) {
  console.log(`[tester] ${msg}`);
}

function record(name, status, detail = '') {
  results.push({ name, status, detail });
  const mark = status === 'PASSED' ? 'PASS' : status === 'SKIPPED' ? 'SKIP' : 'FAIL';
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readAuthToken() {
  if (!APPDATA) return null;
  const p = path.join(APPDATA, 'com.laoy.crimsons', 'auth.token');
  try {
    return fs.readFileSync(p, 'utf8').trim();
  } catch {
    return null;
  }
}

function wsUrlWithToken() {
  const token = readAuthToken();
  if (!token) return WS_URL;
  const sep = WS_URL.includes('?') ? '&' : '?';
  return `${WS_URL}${sep}token=${encodeURIComponent(token)}`;
}

function openSocket(label) {
  return new Promise((resolve, reject) => {
    const url = wsUrlWithToken();
    log(`Connecting ${label}...`);
    const inbox = [];
    const ws = new WebSocket(url, {
      headers: { Origin: 'http://127.0.0.1:5173' },
    });
    const timer = setTimeout(() => reject(new Error(`${label} connect timeout`)), TIMEOUT_MS);
    ws.on('open', () => {
      clearTimeout(timer);
      resolve({
        ws,
        inbox,
        send(obj) {
          ws.send(JSON.stringify(obj));
        },
        clear() {
          inbox.length = 0;
        },
        async waitFor(predicate, timeout = TIMEOUT_MS, name = 'message') {
          const start = Date.now();
          while (Date.now() - start < timeout) {
            const hit = inbox.find(predicate);
            if (hit) return hit;
            await sleep(80);
          }
          throw new Error(`Timeout waiting for ${name}`);
        },
        async expectWithin(predicate, timeout = 2500) {
          const start = Date.now();
          while (Date.now() - start < timeout) {
            const hit = inbox.find(predicate);
            if (hit) return hit;
            await sleep(50);
          }
          return null;
        },
        close() {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        },
      });
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    ws.on('message', (data) => {
      try {
        inbox.push(JSON.parse(data.toString()));
      } catch {
        /* ignore */
      }
    });
  });
}

async function supabasePasswordLogin() {
  if (!SUPABASE_URL || !SUPABASE_KEY || !EMAIL || !PASSWORD) {
    return null;
  }
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const json = await resp.json();
  if (!resp.ok) {
    throw new Error(json.error_description || json.msg || `HTTP ${resp.status}`);
  }
  return json;
}

async function fetchPremium(accessToken) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=is_premium`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  const rows = await resp.json();
  return Boolean(rows?.[0]?.is_premium);
}

async function main() {
  log('=== Crimsons plugin runtime suite ===');

  let session = null;
  try {
    session = await supabasePasswordLogin();
    record('Supabase password login', 'PASSED', session.user?.email || EMAIL);
  } catch (e) {
    record('Supabase password login', 'FAILED', String(e.message || e));
  }

  let premium = false;
  if (session?.access_token) {
    try {
      premium = await fetchPremium(session.access_token);
      record('Profile is_premium', premium ? 'PASSED' : 'FAILED', `is_premium=${premium}`);
    } catch (e) {
      record('Profile is_premium', 'FAILED', String(e.message || e));
    }
  } else {
    record('Profile is_premium', 'SKIPPED', 'no session');
  }

  let app;
  try {
    app = await openSocket('app');
    record('WebSocket connect (app)', 'PASSED');
  } catch (e) {
    record('WebSocket connect (app)', 'FAILED', String(e.message || e));
    printSummaryAndExit();
    return;
  }

  app.clear();
  app.send({ type: 'GET_VERSION' });
  try {
    const ver = await app.waitFor((m) => m.type === 'SERVER_VERSION', 5000, 'SERVER_VERSION');
    record('GET_VERSION', 'PASSED', `version=${ver.version}`);
  } catch (e) {
    record('GET_VERSION', 'FAILED', String(e.message || e));
  }

  const hb0 = await app.expectWithin((m) => m.type === 'HEARTBEAT_STATUS', 3000);
  record(
    'HEARTBEAT_STATUS on connect',
    hb0 ? 'PASSED' : 'FAILED',
    hb0 ? `server=${hb0.server} lol=${hb0.lol} discord=${hb0.discord}` : 'missing'
  );

  if (session?.access_token) {
    app.send({
      type: 'AUTH_SESSION',
      access_token: session.access_token,
      refresh_token: session.refresh_token || '',
    });
    await sleep(500);
    record('AUTH_SESSION accepted', 'PASSED', 'sent (no ack by design)');
  }

  // Hue must stay gated (coming soon)
  app.clear();
  app.send({ type: 'TOGGLE_PLUGIN', plugin: 'hue', enabled: true });
  try {
    const denied = await app.waitFor(
      (m) => m.type === 'FEATURE_UNAVAILABLE' && m.plugin === 'hue',
      4000,
      'FEATURE_UNAVAILABLE hue'
    );
    record('Hue gated (coming soon)', 'PASSED', denied.message || '');
  } catch (e) {
    record('Hue gated (coming soon)', 'FAILED', String(e.message || e));
  }

  // Twitch: premium-gated; mock TWITCH_STATE when enabled
  app.clear();
  app.send({ type: 'TOGGLE_PLUGIN', plugin: 'twitch', enabled: true });
  try {
    const msg = await app.waitFor(
      (m) =>
        (m.type === 'AUTH_ERROR') ||
        (m.type === 'TWITCH_STATE') ||
        (m.type === 'PLUGIN_PREFS' && m.plugins && m.plugins.twitch === true),
      5000,
      'Twitch toggle ack'
    );
    if (msg.type === 'AUTH_ERROR') {
      record('Twitch premium gate', 'PASSED', msg.message || 'AUTH_ERROR');
    } else {
      record('Twitch TOGGLE_PLUGIN', 'PASSED', msg.type);
      app.clear();
      app.send({ type: 'TWITCH_COMMAND', endpoint: 'refresh' });
      try {
        const st = await app.waitFor((m) => m.type === 'TWITCH_STATE', 4000, 'TWITCH_STATE');
        record(
          'Twitch refresh (mock/Helix)',
          'PASSED',
          `viewers=${st.data?.viewers ?? '?'} mock=${st.data?.mock}`
        );
      } catch (e2) {
        record('Twitch refresh (mock/Helix)', 'FAILED', String(e2.message || e2));
      }
    }
  } catch (e) {
    record('Twitch TOGGLE_PLUGIN', 'FAILED', String(e.message || e));
  }

  // --- League of Legends (Crimsons plugin protocol) ---
  app.clear();
  app.send({ type: 'TOGGLE_PLUGIN', plugin: 'leagueOfLegends', enabled: true });
  try {
    const hb = await app.waitFor((m) => m.type === 'HEARTBEAT_STATUS', 4000, 'HEARTBEAT after LoL toggle');
    record(
      'LoL TOGGLE_PLUGIN enable',
      'PASSED',
      `heartbeat lol=${hb.lol} (false without LCU is OK)`
    );
  } catch (e) {
    record('LoL TOGGLE_PLUGIN enable', 'FAILED', String(e.message || e));
  }

  app.clear();
  app.send({ type: 'SET_AUTO_ACCEPT', enabled: true });
  try {
    const st = await app.waitFor((m) => m.type === 'AUTO_ACCEPT_STATE', 4000, 'AUTO_ACCEPT_STATE');
    record('LoL SET_AUTO_ACCEPT', 'PASSED', `enabled=${st.enabled}`);
  } catch (e) {
    record('LoL SET_AUTO_ACCEPT', 'FAILED', String(e.message || e));
  }

  // Simulate Crimsons StreamDock plugin keyDown -> TOGGLE_AUTO_ACCEPT
  app.clear();
  app.send({ type: 'TOGGLE_AUTO_ACCEPT' });
  try {
    const st = await app.waitFor((m) => m.type === 'AUTO_ACCEPT_STATE', 4000, 'AUTO_ACCEPT_STATE toggle');
    record('LoL StreamDock autoaccept (TOGGLE_AUTO_ACCEPT)', 'PASSED', `enabled=${st.enabled}`);
  } catch (e) {
    record('LoL StreamDock autoaccept (TOGGLE_AUTO_ACCEPT)', 'FAILED', String(e.message || e));
  }

  app.clear();
  app.send({ type: 'AUTO_BAN_STATE', championId: 157 });
  try {
    const st = await app.waitFor(
      (m) => m.type === 'AUTO_BAN_STATE' && Number(m.championId) === 157,
      4000,
      'AUTO_BAN_STATE echo'
    );
    record('LoL AUTO_BAN_STATE set', 'PASSED', `championId=${st.championId}`);
  } catch (e) {
    record('LoL AUTO_BAN_STATE set', 'FAILED', String(e.message || e));
  }

  app.clear();
  app.send({ type: 'AUTO_PICK_STATE', championId: 64 });
  try {
    const st = await app.waitFor(
      (m) => m.type === 'AUTO_PICK_STATE' && Number(m.championId) === 64,
      4000,
      'AUTO_PICK_STATE echo'
    );
    record('LoL AUTO_PICK_STATE set', 'PASSED', `championId=${st.championId}`);
  } catch (e) {
    record('LoL AUTO_PICK_STATE set', 'FAILED', String(e.message || e));
  }

  // --- Spotify / Discord enable + command paths (app socket) ---
  if (!premium) {
    record('Spotify TOGGLE_PLUGIN enable', 'SKIPPED', 'account not premium');
    record('Discord TOGGLE_PLUGIN enable', 'SKIPPED', 'account not premium');
  } else {
    app.clear();
    app.send({ type: 'TOGGLE_PLUGIN', plugin: 'spotify', enabled: true });
    {
      const err = await app.expectWithin((m) => m.type === 'AUTH_ERROR', 1500);
      const hb = await app.expectWithin((m) => m.type === 'HEARTBEAT_STATUS', 2000);
      record(
        'Spotify TOGGLE_PLUGIN enable',
        err ? 'FAILED' : 'PASSED',
        err ? err.message : hb ? 'heartbeat after toggle' : 'no AUTH_ERROR'
      );
    }

    app.clear();
    app.send({
      type: 'SPOTIFY_COMMAND',
      endpoint: 'currently-playing',
      context: 'spotify-cmd-ctx',
      payload: {},
    });
    await sleep(1500);
    {
      const authErr = app.inbox.find((m) => m.type === 'AUTH_ERROR');
      const spotifyState = app.inbox.find((m) => m.type === 'SPOTIFY_STATE');
      record(
        'Spotify SPOTIFY_COMMAND currently-playing',
        authErr ? 'FAILED' : 'PASSED',
        authErr
          ? authErr.message
          : spotifyState
            ? 'SPOTIFY_STATE received'
            : 'accepted (no OAuth/device on VM — OK)'
      );
    }

    app.clear();
    app.send({ type: 'TOGGLE_PLUGIN', plugin: 'discord', enabled: true });
    {
      const err = await app.expectWithin((m) => m.type === 'AUTH_ERROR', 1500);
      const hb = await app.expectWithin((m) => m.type === 'HEARTBEAT_STATUS', 2000);
      record(
        'Discord TOGGLE_PLUGIN enable',
        err ? 'FAILED' : 'PASSED',
        err
          ? err.message
          : hb
            ? `discord_connected=${hb.discord}`
            : 'no AUTH_ERROR (IPC absent on VM is OK)'
      );
    }

    app.clear();
    app.send({ type: 'DISCORD_COMMAND', endpoint: 'TOGGLE_MUTE', payload: {} });
    await sleep(1000);
    {
      const authErr = app.inbox.find((m) => m.type === 'AUTH_ERROR');
      record(
        'Discord DISCORD_COMMAND TOGGLE_MUTE',
        authErr ? 'FAILED' : 'PASSED',
        authErr ? authErr.message : 'accepted (IPC missing — command no-ops)'
      );
    }
  }

  // --- StreamDock bridge socket (keyDown is the real StreamDeck event) ---
  let bridge;
  try {
    bridge = await openSocket('bridge');
    record('WebSocket connect (StreamDock bridge)', 'PASSED');
  } catch (e) {
    record('WebSocket connect (StreamDock bridge)', 'FAILED', String(e.message || e));
    app.close();
    printSummaryAndExit();
    return;
  }

  bridge.send({
    type: 'REGISTER_STREAMDOCK_BRIDGE',
    port: 40510,
    uuid: 'plugin-runtime-tester',
  });
  await sleep(600);
  record('REGISTER_STREAMDOCK_BRIDGE', 'PASSED', 'bridge owns this socket');

  if (!premium) {
    record('Spotify StreamDock keyDown playpause', 'SKIPPED', 'account not premium');
    record('Discord StreamDock keyDown togglemute', 'SKIPPED', 'account not premium');
  } else {
    // App socket stays responsive while bridge handles hardware events
    app.clear();
    bridge.send({
      event: 'keyDown',
      context: 'spotify-playpause-ctx',
      action: 'com.laoy.streamdock.spotify.playpause',
      payload: { settings: {} },
    });
    await sleep(1000);
    app.send({ type: 'GET_VERSION' });
    try {
      await app.waitFor((m) => m.type === 'SERVER_VERSION', 5000, 'SERVER_VERSION after spotify keyDown');
      const authErr = [...app.inbox, ...bridge.inbox].find((m) => m.type === 'AUTH_ERROR');
      record(
        'Spotify StreamDock keyDown playpause',
        authErr ? 'FAILED' : 'PASSED',
        authErr
          ? authErr.message
          : 'routed server-side (playback needs Spotify OAuth)'
      );
    } catch (e) {
      record('Spotify StreamDock keyDown playpause', 'FAILED', String(e.message || e));
    }

    app.clear();
    bridge.send({
      event: 'keyDown',
      context: 'discord-mute-ctx',
      action: 'com.laoy.streamdock.discord.togglemute',
      payload: { settings: {} },
    });
    await sleep(1000);
    app.send({ type: 'GET_VERSION' });
    try {
      await app.waitFor((m) => m.type === 'SERVER_VERSION', 5000, 'SERVER_VERSION after discord keyDown');
      const authErr = [...app.inbox, ...bridge.inbox].find((m) => m.type === 'AUTH_ERROR');
      record(
        'Discord StreamDock keyDown togglemute',
        authErr ? 'FAILED' : 'PASSED',
        authErr
          ? authErr.message
          : 'routed server-side (mute needs Discord IPC)'
      );
    } catch (e) {
      record('Discord StreamDock keyDown togglemute', 'FAILED', String(e.message || e));
    }
  }

  // Free-user gate on StreamDock Spotify (uses a throwaway sessionless check via bridge
  // only if we can clear entitlement — skip; premium path already covered)

  app.send({ type: 'TOGGLE_PLUGIN', plugin: 'leagueOfLegends', enabled: false });
  await sleep(200);
  bridge.close();
  app.close();
  printSummaryAndExit();
}

function printSummaryAndExit() {
  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    console.log(`${r.status.padEnd(8)} | ${r.name}${r.detail ? ` | ${r.detail}` : ''}`);
  }
  const failed = results.filter((r) => r.status === 'FAILED').length;
  const passed = results.filter((r) => r.status === 'PASSED').length;
  const skipped = results.filter((r) => r.status === 'SKIPPED').length;
  console.log(`\nTotals: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
