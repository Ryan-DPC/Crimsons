# HoopsLive OBS Chrono (Store / VPS)

Compte à rebours **source de vérité serveur** (process Node du store), consommé par :

- Browser Sources OBS (overlays HTML sous path secret)
- Plugin StreamDeck (`com.laoy.streamdock.hoopslive-obs`) → branche monorepo `feat/hoopslive-obs-deck-20a4`

État v1 : **mémoire process** (structure prête Redis plus tard). Redémarrage du process = reset.

## Variables d’environnement

| Variable | Requis | Description |
| --- | --- | --- |
| `HOOPSLIVE_OBS_TOKEN` | **oui** | Secret API (Bearer / `X-HoopsLive-Token`). **Ne jamais committer.** |
| `OBS_PATH_SECRET` | **oui** (overlays) | Segment d’URL après `/hl-obs/`. 404 si faux. **Nom primaire.** |
| `HOOPSLIVE_OBS_PUBLIC_PATH_SECRET` | alias | Fallback si `OBS_PATH_SECRET` est vide. |
| `HOOPSLIVE_OBS_PUBLIC_BASE` | recommandé | Origine publique HTTPS **sans** slash final, ex. `https://store.hoopslive.ch` ou `https://hoopslive.ch`. **Ne pas hardcoder** un domaine inventé. |
| `HOOPSLIVE_OBS_CORS_ORIGIN` | optionnel | Origine CORS restreinte (sinon pas d’en-tête CORS). |
| `HOOPSLIVE_OBS_IP_ALLOWLIST` | optionnel | CSV d’IP clientes autorisées. |
| `HOOPSLIVE_OBS_COOKIE_NAME` | optionnel | Cookie HttpOnly (défaut `hl_obs_k`). |
| `HOOPSLIVE_OBS_RATE_LIMIT_MAX` | optionnel | Max POST / IP / fenêtre (défaut `60`). |
| `HOOPSLIVE_OBS_RATE_LIMIT_WINDOW_MS` | optionnel | Fenêtre rate-limit ms (défaut `60000`). |

Sans `HOOPSLIVE_OBS_TOKEN`, l’API refuse tout (fail-closed → 401).

## Endpoints

| Méthode | Route | Auth | Corps / notes |
| --- | --- | --- | --- |
| `GET` | `/api/hoopslive/obs/countdown` | Bearer, `X-HoopsLive-Token`, cookie, ou `?k=` | Snapshot `{ durationSec, remainingSec, running, endsAt, updatedAt }` |
| `POST` | `/api/hoopslive/obs/countdown` | Bearer / header / cookie (**pas** `?k=`) | `{ "action": "set\|add\|pause\|resume\|toggle\|reset\|stop", ... }` |
| `GET` | `/api/hoopslive/obs/countdown/stream` | idem GET | SSE `event: countdown` |

### Actions POST

```json
{ "action": "set", "durationSec": 300 }
{ "action": "add", "seconds": 30 }
{ "action": "add", "seconds": -10 }
{ "action": "pause" }
{ "action": "resume" }
{ "action": "toggle" }
{ "action": "reset" }
{ "action": "stop" }
```

### Auth & `?k=`

- **Mutations** : uniquement `Authorization: Bearer …` ou `X-HoopsLive-Token` (ou cookie).
- **`?k=`** : accepté **uniquement** sur GET overlay/SSE/countdown (Browser Source OBS). Risque : fuite via logs proxy, Referer, historique. Préférer le cookie HttpOnly :

```
GET /hl-obs/<PUBLIC_PATH_SECRET>/auth?k=<TOKEN>&next=scenes/start.html
→ 302 + Set-Cookie HttpOnly + redirect
```

## Overlays OBS (Browser Source)

Base : `$HOOPSLIVE_OBS_PUBLIC_BASE/hl-obs/$OBS_PATH_SECRET/`

| Scène | URL relative |
| --- | --- |
| Start | `scenes/start.html` |
| Pause | `scenes/pause.html` |
| Live | `scenes/live.html` |
| End | `scenes/end.html` |

Exemple (placeholders — remplacer base + secret) :

```
https://<HOOPSLIVE_OBS_PUBLIC_BASE>/hl-obs/<PUBLIC_PATH_SECRET>/scenes/start.html
```

- Pas de listing de répertoire (404).
- Pas de panneau contrôle par défaut ; ajouter `?panel=1` pour une mini UI de secours.
- Transport : **SSE** prioritaire ; fallback poll **250–500 ms** (`?pollMs=400`) documenté dans `assets/countdown-client.js`.

Packs visuels HoopsLive pourront remplacer les HTML plus tard sans changer l’API.

## Test local

```bash
export HOOPSLIVE_OBS_TOKEN=dev-token
export OBS_PATH_SECRET=dev-secret
# ou alias : export HOOPSLIVE_OBS_PUBLIC_PATH_SECRET=dev-secret
export HOOPSLIVE_OBS_PUBLIC_BASE=http://127.0.0.1:3000
# optionnel
export HOOPSLIVE_OBS_CORS_ORIGIN=http://127.0.0.1:3000

npm test
npm start   # après npm run build si tu veux la SPA ; l’API chrono n’a pas besoin de dist/
```

Smoke :

```bash
curl -s -H "Authorization: Bearer $HOOPSLIVE_OBS_TOKEN" \
  http://127.0.0.1:3000/api/hoopslive/obs/countdown

curl -s -X POST -H "X-HoopsLive-Token: $HOOPSLIVE_OBS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"set","durationSec":90}' \
  http://127.0.0.1:3000/api/hoopslive/obs/countdown

curl -s -N -H "Authorization: Bearer $HOOPSLIVE_OBS_TOKEN" \
  http://127.0.0.1:3000/api/hoopslive/obs/countdown/stream
```

## Reverse-proxy (Caddy)

```caddy
# Remplacer le domaine par HOOPSLIVE_OBS_PUBLIC_BASE
store.example.com {
  encode gzip
  reverse_proxy 127.0.0.1:3000
  # SSE : éviter buffer
  @sse path /api/hoopslive/obs/countdown/stream
  header @sse X-Accel-Buffering "no"
}
```

## Reverse-proxy (Nginx)

```nginx
location /api/hoopslive/obs/countdown/stream {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Connection "";
  proxy_buffering off;
  proxy_cache off;
  chunked_transfer_encoding off;
  proxy_read_timeout 3600s;
}

location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

## Mapping Stream Deck (branche deck)

| Action UUID (suffixe) | POST action | Notes |
| --- | --- | --- |
| `toggle` | `toggle` | Start/pause |
| `pause` | `pause` | |
| `resume` | `resume` | |
| `reset` | `reset` | Remet `durationSec` |
| `stop` | `stop` | `remainingSec = 0` |
| `add10` | `add` +10 | |
| `add60` | `add` +60 | |
| `sub10` | `add` −10 | |
| `display` | (poll GET) | Titre MM:SS |
| `obs_scene` | **stub** | Pas de module obs-websocket dans le sidecar CRIMSONS ; bonus documenté côté plugin deck |

## Checklist brief

| Item | Statut |
| --- | --- |
| GET/POST countdown + snapshot fields | **Fait** |
| SSE `/countdown/stream` + fallback poll overlays | **Fait** |
| Auth Bearer / `X-HoopsLive-Token` / 401 | **Fait** |
| `?k=` GET only + cookie auth redirect | **Fait** |
| Rate-limit + CORS restreint | **Fait** |
| Overlays `/hl-obs/<secret>/` 404 si faux, no listing | **Fait** |
| Placeholders start/pause/live/end + `?panel=1` | **Fait** |
| État mémoire + structure Redis-ready | **Fait** (interface store) |
| IP allowlist optionnelle | **Fait** |
| Tests unitaires état + auth 401 | **Fait** (`npm test`) |
| Plugin StreamDeck | Branche **`feat/hoopslive-obs-deck-20a4`** (main) |
| OBS scene switch via obs-websocket | **Stub** — aucun module OBS dans sidecar ; chrono VPS prioritaire |
| Domaine hardcodé | **Non** — `HOOPSLIVE_OBS_PUBLIC_BASE` |
