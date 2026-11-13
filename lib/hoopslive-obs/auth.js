import { getHoopsLiveObsConfig } from './config.js';

/**
 * Extract token from Authorization Bearer, X-HoopsLive-Token, cookie, or ?k=.
 *
 * Security note on ?k=:
 *   Query tokens leak via Referer, access logs, and Browser Source UI history.
 *   Allowed ONLY for GET overlay pages and GET SSE/stream (read-only display).
 *   Prefer HttpOnly cookie set by /hl-obs/<secret>/auth?k=… redirect.
 *   Mutating POST /api/... NEVER accepts ?k=.
 */

export function parseCookies(header) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {URL} url
 * @param {{ allowQuery?: boolean, allowCookie?: boolean }} [opts]
 */
export function extractToken(req, url, opts = {}) {
  const allowQuery = opts.allowQuery === true;
  const allowCookie = opts.allowCookie !== false;
  const cfg = getHoopsLiveObsConfig();

  const auth = req.headers.authorization;
  if (auth && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, '').trim();
  }

  const headerTok = req.headers['x-hoopslive-token'];
  if (headerTok) {
    return String(Array.isArray(headerTok) ? headerTok[0] : headerTok).trim();
  }

  if (allowCookie) {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies[cfg.cookieName]) return cookies[cfg.cookieName];
  }

  if (allowQuery) {
    const k = url.searchParams.get('k');
    if (k) return k.trim();
  }

  return '';
}

/**
 * Constant-time-ish compare for equal-length secrets.
 * @param {string} a
 * @param {string} b
 */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {URL} url
 * @param {{ allowQuery?: boolean }} [opts]
 */
export function isAuthorized(req, url, opts = {}) {
  const cfg = getHoopsLiveObsConfig();
  if (!cfg.token) {
    // Misconfigured: refuse all (fail closed)
    return false;
  }
  const provided = extractToken(req, url, opts);
  return safeEqual(provided, cfg.token);
}

/**
 * Optional IP allowlist. Empty allowlist = allow all.
 * @param {import('node:http').IncomingMessage} req
 */
export function isIpAllowed(req) {
  const cfg = getHoopsLiveObsConfig();
  if (!cfg.ipAllowlist.length) return true;
  const xf = req.headers['x-forwarded-for'];
  const forwarded = xf ? String(Array.isArray(xf) ? xf[0] : xf).split(',')[0].trim() : '';
  const ip = forwarded || req.socket?.remoteAddress || '';
  // Strip IPv6-mapped IPv4 prefix
  const normalized = ip.replace(/^::ffff:/, '');
  return cfg.ipAllowlist.some((allowed) => allowed === normalized || allowed === ip);
}
