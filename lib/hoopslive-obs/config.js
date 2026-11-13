/**
 * HoopsLive OBS Chrono env config.
 *
 * HOOPSLIVE_OBS_PUBLIC_BASE — public HTTPS origin (no trailing slash), e.g.
 *   https://store.hoopslive.ch  or  https://hoopslive.ch
 *   Do NOT hardcode a fake domain; set this in deploy env.
 * HOOPSLIVE_OBS_PUBLIC_PATH_SECRET — path segment after /hl-obs/ (required for overlays)
 * HOOPSLIVE_OBS_TOKEN — API bearer token (never commit)
 * HOOPSLIVE_OBS_IP_ALLOWLIST — optional CSV of client IPs
 * HOOPSLIVE_OBS_CORS_ORIGIN — optional restricted CORS origin (default: none / same-origin)
 * HOOPSLIVE_OBS_COOKIE_NAME — overlay session cookie (default: hl_obs_k)
 */

function env(name, fallback = '') {
  const v = process.env[name];
  return v == null || v === '' ? fallback : String(v);
}

export function getHoopsLiveObsConfig() {
  const token = env('HOOPSLIVE_OBS_TOKEN');
  const pathSecret = env('HOOPSLIVE_OBS_PUBLIC_PATH_SECRET');
  const publicBase = env('HOOPSLIVE_OBS_PUBLIC_BASE').replace(/\/$/, '');
  const corsOrigin = env('HOOPSLIVE_OBS_CORS_ORIGIN');
  const cookieName = env('HOOPSLIVE_OBS_COOKIE_NAME', 'hl_obs_k');
  const allowlistRaw = env('HOOPSLIVE_OBS_IP_ALLOWLIST');
  const ipAllowlist = allowlistRaw
    ? allowlistRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  return {
    token,
    pathSecret,
    publicBase,
    corsOrigin,
    cookieName,
    ipAllowlist,
    /** Max requests per IP per window for mutating API */
    rateLimitMax: parseInt(env('HOOPSLIVE_OBS_RATE_LIMIT_MAX', '60'), 10) || 60,
    rateLimitWindowMs: parseInt(env('HOOPSLIVE_OBS_RATE_LIMIT_WINDOW_MS', '60000'), 10) || 60_000,
  };
}
