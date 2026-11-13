# HoopsLive OBS Chrono

Split across two git histories (store-web ≠ main):

| Piece | Branch | Location |
| --- | --- | --- |
| VPS API + overlays + deploy docs | `feat/hoopslive-obs-chrono-20a4` (from store tip) | `lib/hoopslive-obs/`, `hoopslive-obs/overlays/`, `README-HOOPSLIVE-OBS.md` |
| Stream Deck / StreamDock plugin | `feat/hoopslive-obs-deck-20a4` (from main) | `plugins/streamdeck/com.laoy.streamdock.hoopslive-obs.sdPlugin/` |

The countdown **source of truth is the store Node process on the VPS**, not `crimson-server` localhost.

## Env (VPS / store)

See store branch `README-HOOPSLIVE-OBS.md`. Summary:

- `HOOPSLIVE_OBS_TOKEN` — API secret (never commit)
- `HOOPSLIVE_OBS_PUBLIC_PATH_SECRET` — overlay URL segment
- `HOOPSLIVE_OBS_PUBLIC_BASE` — public origin, e.g. `https://store.hoopslive.ch` (do not hardcode a fake domain)
- `HOOPSLIVE_OBS_CORS_ORIGIN`, `HOOPSLIVE_OBS_IP_ALLOWLIST` — optional

## OBS Browser Source URLs

```
$HOOPSLIVE_OBS_PUBLIC_BASE/hl-obs/$HOOPSLIVE_OBS_PUBLIC_PATH_SECRET/scenes/start.html
$HOOPSLIVE_OBS_PUBLIC_BASE/hl-obs/$HOOPSLIVE_OBS_PUBLIC_PATH_SECRET/scenes/pause.html
$HOOPSLIVE_OBS_PUBLIC_BASE/hl-obs/$HOOPSLIVE_OBS_PUBLIC_PATH_SECRET/scenes/live.html
$HOOPSLIVE_OBS_PUBLIC_BASE/hl-obs/$HOOPSLIVE_OBS_PUBLIC_PATH_SECRET/scenes/end.html
```

Auth for the page’s API calls: prefer `/hl-obs/<secret>/auth?k=<TOKEN>` (HttpOnly cookie) or `?k=` on the Browser Source URL (leaks in logs — documented risk). Overlay UI: SSE first, poll fallback 250–500 ms. Emergency controls: `?panel=1`.

## Stream Deck action mapping

Install pack: `plugins/streamdeck/com.laoy.streamdock.hoopslive-obs.sdPlugin/`

Property Inspector **global** settings: `baseUrl`, `token`, `pollMs`.

| Key | UUID suffix | API |
| --- | --- | --- |
| Chrono Display | `display` | GET poll → title `MM:SS` |
| Toggle | `toggle` | POST `toggle` |
| Pause | `pause` | POST `pause` |
| Resume | `resume` | POST `resume` |
| Reset | `reset` | POST `reset` |
| Stop | `stop` | POST `stop` |
| +10s | `add10` | POST `add` `{seconds:10}` |
| +1m | `add60` | POST `add` `{seconds:60}` |
| -10s | `sub10` | POST `add` `{seconds:-10}` |
| OBS Scene | `obs_scene` | **Stub** — see below |

## OBS scenes limit (stub)

There is **no** `obs-websocket` / OBS module in `server/` (crimson-server). The plugin’s `obs_scene` action:

1. Reads `sceneName` from action settings
2. Tries `POST http://127.0.0.1:40510/local/obs/scene` (optional future bridge)
3. Otherwise shows alert / logs — **chrono VPS remains priority**

To switch OBS scenes today: use OBS macros / Advanced Scene Switcher, or wire a local bridge later.

## Reverse-proxy

Caddy / Nginx snippets live on the store branch (`README-HOOPSLIVE-OBS.md`). Critical: disable buffering for SSE `/api/hoopslive/obs/countdown/stream`.

## Local test (plugin)

1. Run store API with token + path secret (store branch).
2. In Property Inspector set `baseUrl=http://127.0.0.1:3000` and the same token.
3. Place **Chrono Display** + **Toggle**; confirm title updates and actions mutate remaining time.

## Checklist

| Item | Status |
| --- | --- |
| VPS countdown API + SSE + auth | Store branch **done** |
| Secret overlays + placeholders | Store branch **done** |
| StreamDeck plugin → VPS HTTPS + MM:SS | **Done** (this branch) |
| OBS scene via sidecar | **Stub** (no obs-websocket in repo) |
| Redis | Structure ready on store; still in-memory v1 |
