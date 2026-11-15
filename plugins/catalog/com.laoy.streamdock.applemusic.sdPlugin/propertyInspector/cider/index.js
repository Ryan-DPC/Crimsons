function crimsonAuthToken() {
  try {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'http://127.0.0.1:40510/local/ws-token', false);
    xhr.send(null);
    if (xhr.status === 200 && xhr.responseText) return String(xhr.responseText).trim();
  } catch (e) {}
  try {
    if (window.__CRIMSON_AUTH_TOKEN__) return String(window.__CRIMSON_AUTH_TOKEN__).trim();
  } catch (e2) {}
  return '';
}

function ciderCachePath() {
  try {
    var path = require('path');
    return path.join(process.env.APPDATA || '', 'com.laoy.crimsons', 'cider_cache.json');
  } catch (e) {
    return '';
  }
}

function readCache() {
  try {
    var fs = require('fs');
    var p = ciderCachePath();
    if (!p || !fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

function writeCache(appToken, cleared) {
  try {
    var fs = require('fs');
    var path = require('path');
    var p = ciderCachePath();
    if (!p) return;
    var parent = path.dirname(p);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    fs.writeFileSync(
      p,
      JSON.stringify({ appToken: appToken || '', cleared: !!cleared }, null, 2),
      'utf8'
    );
  } catch (e) {}
}

function discoverSpaConfigToken() {
  try {
    var fs = require('fs');
    var path = require('path');
    var cfgPath = path.join(process.env.APPDATA || '', 'sh.cider.dotnet', 'spa-config.yml');
    if (!fs.existsSync(cfgPath)) return '';
    var content = fs.readFileSync(cfgPath, 'utf8');
    var m = content.match(/token:\s*([^\r\n]+)/);
    if (m && m[1]) {
      var tok = m[1].trim().replace(/^['"]|['"]$/g, '');
      if (tok) return tok;
    }
  } catch (e) {}
  return '';
}

function getStoredToken() {
  var cache = readCache();
  if (cache && cache.cleared === true) return '';
  if (cache && cache.appToken && String(cache.appToken).trim()) {
    return String(cache.appToken).trim();
  }
  try {
    var ls = localStorage.getItem('cider_token');
    if (ls && ls.trim()) return ls.trim();
  } catch (e1) {}
  try {
    if (window.__CIDER_APP_TOKEN__) return String(window.__CIDER_APP_TOKEN__).trim();
  } catch (e2) {}
  return discoverSpaConfigToken();
}

function sendCredentials(token) {
  var wsToken = crimsonAuthToken();
  var url = wsToken
    ? 'ws://127.0.0.1:40510/?token=' + encodeURIComponent(wsToken)
    : 'ws://127.0.0.1:40510';
  return new Promise(function (resolve, reject) {
    try {
      var ws = new WebSocket(url);
      var done = false;
      ws.onopen = function () {
        ws.send(JSON.stringify({
          type: 'APPLE_MUSIC_CREDENTIALS',
          appToken: token || ''
        }));
        setTimeout(function () {
          try { ws.close(); } catch (e) {}
          if (!done) { done = true; resolve(true); }
        }, 400);
      };
      ws.onerror = function () {
        if (!done) { done = true; reject(new Error('ws')); }
      };
    } catch (e) {
      reject(e);
    }
  });
}

function setStatus(text, kind) {
  var status = document.getElementById('status');
  status.textContent = text || '';
  status.className = kind || '';
}

function showTokenEntry(show) {
  var el = document.getElementById('tokenEntry');
  if (show) el.classList.add('visible');
  else el.classList.remove('visible');
}

function updateUi(connected) {
  var badge = document.getElementById('badge');
  var connectedView = document.getElementById('connectedView');
  var disconnectedView = document.getElementById('disconnectedView');
  if (connected) {
    badge.className = 'badge badge-connected';
    badge.textContent = 'Connecté';
    connectedView.classList.remove('hidden');
    disconnectedView.classList.add('hidden');
    showTokenEntry(false);
  } else {
    badge.className = 'badge badge-disconnected';
    badge.textContent = 'Non connecté';
    connectedView.classList.add('hidden');
    disconnectedView.classList.remove('hidden');
  }
}

function persistConnected(token) {
  writeCache(token, false);
  try { localStorage.setItem('cider_token', token); } catch (e) {}
  try { window.__CIDER_APP_TOKEN__ = token; } catch (e2) {}
  return sendCredentials(token).then(function () {
    updateUi(true);
    setStatus('Connecté à Cider via Crimsons.', 'ok');
  }).catch(function () {
    // Local cache still updated — plugin reads disk even if sidecar is down.
    updateUi(true);
    setStatus('Jeton enregistré localement (crimson-server injoignable).', 'ok');
  });
}

function persistDisconnected() {
  writeCache('', true);
  try { localStorage.removeItem('cider_token'); } catch (e) {}
  try { window.__CIDER_APP_TOKEN__ = ''; } catch (e2) {}
  return sendCredentials('').then(function () {
    updateUi(false);
    showTokenEntry(false);
    setStatus('Déconnecté. Clique Connecter pour réassocier Cider.', '');
  }).catch(function () {
    updateUi(false);
    showTokenEntry(false);
    setStatus('Déconnecté localement (crimson-server injoignable).', '');
  });
}

document.getElementById('connect').addEventListener('click', function () {
  setStatus('Recherche du jeton Cider…', '');
  var discovered = discoverSpaConfigToken();
  if (discovered) {
    persistConnected(discovered);
    return;
  }
  var existing = '';
  try { existing = (localStorage.getItem('cider_token') || '').trim(); } catch (e) {}
  if (existing) {
    persistConnected(existing);
    return;
  }
  showTokenEntry(true);
  setStatus('Aucun jeton auto-détecté — colle un apptoken Cider ci-dessous.', 'err');
});

document.getElementById('save').addEventListener('click', function () {
  var token = (document.getElementById('token').value || '').trim();
  if (!token) {
    setStatus('Colle un jeton avant d’enregistrer.', 'err');
    return;
  }
  persistConnected(token);
});

document.getElementById('disconnect').addEventListener('click', function () {
  persistDisconnected();
});

(function boot() {
  var cache = readCache();
  if (cache && cache.cleared === true) {
    updateUi(false);
    setStatus('');
    return;
  }
  var tok = getStoredToken();
  if (tok) {
    updateUi(true);
    setStatus('Jeton Cider déjà présent.', 'ok');
  } else {
    updateUi(false);
    setStatus('');
  }
})();
