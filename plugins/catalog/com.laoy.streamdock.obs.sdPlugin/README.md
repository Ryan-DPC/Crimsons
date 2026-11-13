# OBS Studio — StreamDock plugin (HoopsLive)

UUID / dossier : `com.laoy.streamdock.obs.sdPlugin`

Contrôle **local** des scènes OBS via le sidecar Crimsons (`obs-websocket` v5).  
Le chrono et les overlays HTML HoopsLive restent sur l’**API VPS** — ce pack ne fait que basculer les scènes OBS.

## Actions

| Action | UUID | Comportement |
| --- | --- | --- |
| HL Start | `…obs.start` | `OBS_COMMAND` / `start` → scène Start (configurable) |
| HL Pause | `…obs.pause` | `pause` |
| HL Live | `…obs.live` | `live` |
| HL End | `…obs.end` | `end` |
| OBS Status | `…obs.status` | Affiche scène courante (MOCK si OBS absent) |
| Refresh | `…obs.refresh` | `refresh` |
| Open Hub | `…obs.openhub` | Ouvre `/plugins/obs` |

Property Inspector : `sceneName` optionnel pour surcharger le nom de scène de la touche.

## Protocol WS

- État : `{ "type": "OBS_STATE", "data": { … } }`
- Commandes : `{ "type": "OBS_COMMAND", "endpoint": "start"|"pause"|"live"|"end"|"refresh"|"set_scene", "payload": { "sceneName"?: "…" } }`

Prefs Hub : clé `plugins.obs` (premium). Catalogue : **5.99 CHF/mois**. Hardware : StreamDock ✓, Elgato ✗.

## Env (sidecar)

| Variable | Rôle |
| --- | --- |
| `OBS_WEBSOCKET_URL` | Défaut `ws://127.0.0.1:4455` |
| `OBS_WEBSOCKET_PASSWORD` | Mot de passe WebSocket OBS |
| `OBS_SCENE_START` / `_PAUSE` / `_LIVE` / `_END` | Noms de scènes HL |
| `OBS_MOCK=1` | Forcer le mock |

Sans OBS joignable → **mock** (Start/Pause/Live/End) pour CI / Hub.

## Activer OBS WebSocket

1. OBS Studio → Outils → Paramètres WebSocket (plugin obs-websocket v5 intégré depuis OBS 28+).
2. Activer le serveur, noter le port (4455) et le mot de passe.
3. Créer les scènes **Start**, **Pause**, **Live**, **End** (ou mapper via env / PI).
4. Browser Sources VPS pour les overlays (chrono) — **indépendants** du switch de scène local.

## HoopsLive `obs_scene` (pack chrono)

Le pack `com.laoy.streamdock.hoopslive-obs` (branche `feat/hoopslive-obs-deck-20a4`) a un stub `obs_scene` qui tente `POST http://127.0.0.1:40510/local/obs/scene`.  
Le sidecar expose maintenant cet endpoint **et** `OBS_COMMAND` / `set_scene`. Préférer :

```json
{ "type": "OBS_COMMAND", "endpoint": "set_scene", "payload": { "sceneName": "Live" } }
```

## Injecter

```powershell
.\scripts\inject_plugins.ps1 -Extra com.laoy.streamdock.obs.sdPlugin
```

Hub Crimsons → activer **OBS** (Premium requis).

## Limites

- Pas de démarrage/arrêt de stream/recording dans ce MVP (scènes HL seulement).
- Auth obs-websocket = mot de passe env (pas d’UI OAuth).
- Overlays / countdown = VPS ; scène = OBS local.
