import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHoopsLiveObsConfig } from './config.js';
import { isAuthorized, isIpAllowed, safeEqual } from './auth.js';
import { createRateLimiter } from './rate-limit.js';
import { createCountdownStore } from './countdown.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OVERLAY_ROOT = path.resolve(__dirname, '../../hoopslive-obs/overlays');

const OVERLAY_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * @param {{ store?: ReturnType<typeof createCountdownStore> }} [opts]
 */
export function createHoopsLiveObsHandler(opts = {}) {
  const store = opts.store || createCountdownStore(300);
  const cfg0 = getHoopsLiveObsConfig();
  const limiter = createRateLimiter({
    max: cfg0.rateLimitMax,
    windowMs: cfg0.rateLimitWindowMs,
  });

  /** @type {Set<import('node:http').ServerResponse>} */
  const sseClients = new Set();

  store.subscribe((snap) => {
    const payload = `event: countdown\ndata: ${JSON.stringify(snap)}\n\n`;
    for (const res of sseClients) {
      try {
        res.write(payload);
      } catch {
        sseClients.delete(res);
      }
    }
  });

  // Tick running countdown every 250ms so SSE/overlays stay fresh without clients polling.
  setInterval(() => {
    const snap = store.snapshot();
    if (snap.running || snap.remainingSec === 0) {
      const payload = `event: countdown\ndata: ${JSON.stringify(snap)}\n\n`;
      for (const res of sseClients) {
        try {
          res.write(payload);
        } catch {
          sseClients.delete(res);
        }
      }
    }
  }, 250).unref?.();

  function json(res, status, body, extraHeaders = {}) {
    const cfg = getHoopsLiveObsConfig();
    /** @type {Record<string, string>} */
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    };
    if (cfg.corsOrigin) {
      headers['Access-Control-Allow-Origin'] = cfg.corsOrigin;
      headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type, X-HoopsLive-Token';
      headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
      headers.Vary = 'Origin';
    }
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
  }

  function clientKey(req) {
    const xf = req.headers['x-forwarded-for'];
    const forwarded = xf ? String(Array.isArray(xf) ? xf[0] : xf).split(',')[0].trim() : '';
    return (forwarded || req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
  }

  function requireAuth(req, res, url, { allowQuery = false } = {}) {
    if (!isIpAllowed(req)) {
      json(res, 403, { error: 'Forbidden' });
      return false;
    }
    if (!isAuthorized(req, url, { allowQuery })) {
      json(res, 401, { error: 'Unauthorized' });
      return false;
    }
    return true;
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > 64 * 1024) {
          reject(Object.assign(new Error('Body too large'), { statusCode: 413 }));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(Object.assign(new Error('Invalid JSON'), { statusCode: 400 }));
        }
      });
      req.on('error', reject);
    });
  }

  /**
   * Resolve a file under OVERLAY_ROOT without path traversal.
   * @param {string} rel
   */
  function safeOverlayFile(rel) {
    const cleaned = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
    const full = path.resolve(OVERLAY_ROOT, cleaned);
    if (!full.startsWith(OVERLAY_ROOT + path.sep) && full !== OVERLAY_ROOT) {
      return null;
    }
    return full;
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {URL} url
   * @returns {Promise<boolean>} true if handled
   */
  async function handle(req, res, url) {
    const pathname = url.pathname;
    const cfg = getHoopsLiveObsConfig();
    const method = (req.method || 'GET').toUpperCase();

    // CORS preflight for API
    if (method === 'OPTIONS' && pathname.startsWith('/api/hoopslive/obs/')) {
      if (cfg.corsOrigin) {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': cfg.corsOrigin,
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-HoopsLive-Token',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        });
      } else {
        res.writeHead(204);
      }
      res.end();
      return true;
    }

    // --- API: GET countdown ---
    if (pathname === '/api/hoopslive/obs/countdown' && method === 'GET') {
      // Prefer header/cookie; ?k= allowed for Browser Source overlays (documented risk).
      if (!requireAuth(req, res, url, { allowQuery: true })) return true;
      json(res, 200, store.snapshot());
      return true;
    }

    // --- API: POST countdown actions ---
    if (pathname === '/api/hoopslive/obs/countdown' && method === 'POST') {
      // Never accept ?k= for mutations
      if (!requireAuth(req, res, url, { allowQuery: false })) return true;
      const rl = limiter.check(`post:${clientKey(req)}`);
      if (!rl.ok) {
        json(res, 429, { error: 'Too Many Requests' }, { 'Retry-After': String(rl.retryAfterSec) });
        return true;
      }
      try {
        const body = await readBody(req);
        const action = String(body.action || '').toLowerCase();
        if (!action) {
          json(res, 400, { error: 'Missing action' });
          return true;
        }
        const snap = store.applyAction(/** @type {any} */ (action), body);
        json(res, 200, snap);
      } catch (err) {
        const status = /** @type {any} */ (err).statusCode || 500;
        json(res, status, { error: String(/** @type {Error} */ (err).message || err) });
      }
      return true;
    }

    // --- API: SSE stream ---
    if (pathname === '/api/hoopslive/obs/countdown/stream' && method === 'GET') {
      if (!requireAuth(req, res, url, { allowQuery: true })) return true;
      const headers = {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      };
      if (cfg.corsOrigin) {
        headers['Access-Control-Allow-Origin'] = cfg.corsOrigin;
        headers.Vary = 'Origin';
      }
      res.writeHead(200, headers);
      res.write(`event: countdown\ndata: ${JSON.stringify(store.snapshot())}\n\n`);
      sseClients.add(res);
      const keepAlive = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          clearInterval(keepAlive);
        }
      }, 15000);
      keepAlive.unref?.();
      req.on('close', () => {
        clearInterval(keepAlive);
        sseClients.delete(res);
      });
      return true;
    }

    // --- Overlay path: /hl-obs/<secret>/... ---
    const overlayPrefix = '/hl-obs/';
    if (pathname.startsWith(overlayPrefix)) {
      if (!cfg.pathSecret) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return true;
      }
      const rest = pathname.slice(overlayPrefix.length);
      const slash = rest.indexOf('/');
      const secretPart = slash === -1 ? rest : rest.slice(0, slash);
      const fileRel = slash === -1 ? '' : rest.slice(slash + 1);

      if (!safeEqual(secretPart, cfg.pathSecret)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return true;
      }

      // Cookie mint redirect: /hl-obs/<secret>/auth?k=TOKEN → Set-Cookie + redirect to scenes/start.html
      if (fileRel === 'auth' || fileRel === 'auth/') {
        const k = url.searchParams.get('k') || '';
        if (!cfg.token || !safeEqual(k, cfg.token)) {
          res.writeHead(401, { 'Content-Type': 'text/plain' });
          res.end('Unauthorized');
          return true;
        }
        const next = url.searchParams.get('next') || 'scenes/start.html';
        const safeNext = next.replace(/^\/+/, '').replace(/\.\./g, '');
        const cookie = `${cfg.cookieName}=${encodeURIComponent(k)}; Path=/hl-obs/${cfg.pathSecret}; HttpOnly; SameSite=Lax; Secure`;
        res.writeHead(302, {
          Location: `/hl-obs/${cfg.pathSecret}/${safeNext}`,
          'Set-Cookie': cookie,
          'Cache-Control': 'no-store',
        });
        res.end();
        return true;
      }

      // No directory listing — require an explicit file
      let rel = fileRel;
      if (!rel || rel.endsWith('/')) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return true;
      }

      const full = safeOverlayFile(rel);
      if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return true;
      }

      // Overlays themselves are "security through obscurity" of the path secret.
      // API calls from the page still need token via cookie / ?k= / header.
      const ext = path.extname(full).toLowerCase();
      const contentType = OVERLAY_MIME[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      fs.createReadStream(full).pipe(res);
      return true;
    }

    return false;
  }

  return {
    handle,
    store,
    /** exposed for tests */
    _sseClients: sseClients,
  };
}
