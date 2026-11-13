# OBS Studio (Crimsons sidecar)

Local scene switching via **obs-websocket v5**. HoopsLive countdown / HTML overlays remain on the **VPS API** (store branch) — this module only changes the OBS program scene on the stream PC.

## Enable OBS WebSocket

1. OBS Studio 28+ → **Tools → WebSocket Server Settings** (built-in obs-websocket v5).
2. Enable the server. Default port **4455**. Set a password.
3. Create scenes used by HoopsLive (defaults): **Start**, **Pause**, **Live**, **End** — or remap with env / Property Inspector.
4. Point Browser Sources at the VPS overlay URLs for chrono/graphics (see `docs/HOOPSLIVE_OBS_CHRONO.md` on the hoopslive deck branch). Scene *content* is remote; scene *selection* is local.

## Sidecar env

| Variable | Default | Role |
| --- | --- | --- |
| `OBS_WEBSOCKET_URL` | `ws://127.0.0.1:4455` | OBS WebSocket endpoint |
| `OBS_WEBSOCKET_PASSWORD` | _(empty)_ | Required if OBS auth is on |
| `OBS_SCENE_START` | `Start` | HL Start mapping |
| `OBS_SCENE_PAUSE` | `Pause` | HL Pause mapping |
| `OBS_SCENE_LIVE` | `Live` | HL Live mapping |
| `OBS_SCENE_END` | `End` | HL End mapping |
| `OBS_MOCK` | unset | `1` forces mock (CI) |

Without a reachable OBS, the sidecar serves **mock** state (Linux CI safe).

## WS protocol

```json
{ "type": "OBS_STATE", "data": { "connected": true, "mock": true, "current_scene": "Start", "scenes": ["Start","Pause","Live","End"], "…" } }
```

```json
{ "type": "OBS_COMMAND", "endpoint": "start|pause|live|end|refresh|set_scene", "payload": { "sceneName": "Live" } }
```

HTTP bridge (HoopsLive chrono pack stub):

```http
POST /local/obs/scene
Content-Type: application/json

{ "scene": "Live" }
```

## StreamDock pack

`plugins/catalog/com.laoy.streamdock.obs.sdPlugin/` — inject with:

```powershell
.\scripts\inject_plugins.ps1 -Extra com.laoy.streamdock.obs.sdPlugin
```

Hub key: `plugins.obs` (Premium). Catalog slug **`obs`**, **5.99 CHF/mois**, hardware StreamDock.

## HoopsLive `obs_scene` stub

On `feat/hoopslive-obs-deck-20a4`, action `com.laoy.streamdock.hoopslive-obs.obs_scene` currently POSTs `/local/obs/scene`. That endpoint is now implemented. Prefer wiring the stub to:

```js
crimsonAPI.send({ type: "OBS_COMMAND", endpoint: "set_scene", payload: { sceneName } });
```

(or keep the HTTP POST — both hit the same sidecar path).

## Limits

- MVP = program scene switch + status/refresh only (no start/stop streaming/recording).
- Overlays / countdown source of truth = VPS; scene switch = local OBS.
- Password via env only (no interactive OBS auth UI).

## Patch note for `feat/hoopslive-obs-deck-20a4`

Update `stubObsScene` in `plugins/streamdeck/com.laoy.streamdock.hoopslive-obs.sdPlugin/plugin/app.js` to prefer WS:

```js
// Prefer Crimsons sidecar OBS_COMMAND (obs-websocket v5 bridge).
try {
  const ws = new WebSocket('ws://127.0.0.1:40510/?token=' + encodeURIComponent(token || ''));
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'OBS_COMMAND', endpoint: 'set_scene', payload: { sceneName } }));
    ws.close();
    showOk(context);
  };
} catch (_) { /* fall through to HTTP */ }
// Existing POST /local/obs/scene remains valid.
```
