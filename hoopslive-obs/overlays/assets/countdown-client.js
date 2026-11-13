/**
 * Minimal countdown consumer for OBS Browser Sources.
 *
 * Auth (prefer in this order):
 *   1. HttpOnly cookie from /hl-obs/<secret>/auth?k=TOKEN
 *   2. ?k=TOKEN query (leaks in logs/Referer — documented risk; OK for local OBS)
 *   3. Fallback poll every 250–500 ms if EventSource fails
 *
 * SSE: GET /api/hoopslive/obs/countdown/stream  (event: countdown)
 * Poll: GET /api/hoopslive/obs/countdown
 */
(function () {
  const params = new URLSearchParams(location.search);
  const panel = params.get('panel') === '1';
  const k = params.get('k') || '';
  const pollMs = Math.min(2000, Math.max(250, parseInt(params.get('pollMs') || '400', 10) || 400));

  const elTime = document.getElementById('time');
  const elState = document.getElementById('state');
  const elPanel = document.getElementById('panel');

  function fmt(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
  }

  function render(snap) {
    if (!snap) return;
    if (elTime) elTime.textContent = fmt(snap.remainingSec);
    if (elState) {
      elState.textContent = snap.running ? 'LIVE' : snap.remainingSec <= 0 ? 'END' : 'PAUSE';
      elState.dataset.running = snap.running ? '1' : '0';
    }
    document.documentElement.dataset.running = snap.running ? '1' : '0';
    document.documentElement.dataset.ended = snap.remainingSec <= 0 ? '1' : '0';
  }

  function apiUrl(path) {
    const u = new URL(path, location.origin);
    if (k) u.searchParams.set('k', k);
    return u.toString();
  }

  function headers() {
    const h = { Accept: 'application/json' };
    if (k) h['X-HoopsLive-Token'] = k;
    return h;
  }

  async function fetchOnce() {
    const res = await fetch(apiUrl('/api/hoopslive/obs/countdown'), {
      credentials: 'include',
      headers: headers(),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  let usingSse = false;

  function startSse() {
    try {
      const es = new EventSource(apiUrl('/api/hoopslive/obs/countdown/stream'), {
        withCredentials: true,
      });
      es.addEventListener('countdown', (ev) => {
        usingSse = true;
        try {
          render(JSON.parse(ev.data));
        } catch (_) {}
      });
      es.onerror = () => {
        usingSse = false;
        es.close();
        startPoll();
      };
    } catch (_) {
      startPoll();
    }
  }

  let pollTimer = null;
  function startPoll() {
    if (pollTimer) return;
    const tick = async () => {
      if (usingSse) return;
      try {
        render(await fetchOnce());
      } catch (_) {}
    };
    tick();
    pollTimer = setInterval(tick, pollMs);
  }

  async function postAction(action, extra) {
    const body = Object.assign({ action }, extra || {});
    const res = await fetch(apiUrl('/api/hoopslive/obs/countdown'), {
      method: 'POST',
      credentials: 'include',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers()),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    render(await res.json());
  }

  if (panel && elPanel) {
    elPanel.hidden = false;
    elPanel.innerHTML = [
      '<button data-a="toggle">Toggle</button>',
      '<button data-a="pause">Pause</button>',
      '<button data-a="resume">Resume</button>',
      '<button data-a="reset">Reset</button>',
      '<button data-a="stop">Stop</button>',
      '<button data-a="add" data-s="-10">-10s</button>',
      '<button data-a="add" data-s="10">+10s</button>',
      '<button data-a="add" data-s="60">+1m</button>',
    ].join('');
    elPanel.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-a]');
      if (!btn) return;
      const action = btn.getAttribute('data-a');
      const extra = action === 'add' ? { seconds: Number(btn.getAttribute('data-s') || 0) } : {};
      postAction(action, extra).catch(() => {});
    });
  }

  startSse();
})();
