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

function sendCredentials(token) {
  var wsToken = crimsonAuthToken();
  var url = wsToken
    ? 'ws://127.0.0.1:40510/?token=' + encodeURIComponent(wsToken)
    : 'ws://127.0.0.1:40510';
  var ws = new WebSocket(url);
  var status = document.getElementById('status');
  ws.onopen = function () {
    ws.send(JSON.stringify({
      type: 'APPLE_MUSIC_CREDENTIALS',
      appToken: token
    }));
    status.textContent = 'Jeton envoyé à Crimsons.';
    status.className = 'ok';
    setTimeout(function () { try { ws.close(); } catch (e) {} }, 400);
  };
  ws.onerror = function () {
    status.textContent = 'Impossible de joindre crimson-server (40510).';
    status.className = '';
  };
}

document.getElementById('save').addEventListener('click', function () {
  var token = (document.getElementById('token').value || '').trim();
  sendCredentials(token);
});
