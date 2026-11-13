# Twitch — StreamDock plugin

UUID / dossier : `com.laoy.streamdock.twitch.sdPlugin`

Outils streamer via le sidecar Crimsons (`ws://127.0.0.1:40510`) et l’API **Helix**.  
Sans credentials → données **mock** (42 viewers, LIVE) pour peindre les touches / le Hub.

## Actions MVP

| Action | UUID | Comportement |
| --- | --- | --- |
| Viewer Count | `…twitch.viewers` | Affiche LIVE/MOCK + viewers ; refresh au press |
| Create Clip | `…twitch.clip` | `TWITCH_COMMAND` / `create_clip` (Helix) |
| Stream Marker | `…twitch.marker` | `create_marker` (Helix) |
| Refresh | `…twitch.refresh` | `refresh` |
| Open Twitch | `…twitch.opentwitch` | Ouvre `twitch.tv/<user>` |
| Open Hub / Store | `…twitch.openhub` | Ouvre `/plugins/twitch` |
| Mute Alerts | `…twitch.mute_alerts` | **Stub** flag local |
| Follower Goal | `…twitch.follower_goal` | **Stub** compteur local |
| Clear Chat | `…twitch.clear_chat` | **Stub** (IRC/mod hors MVP) |

Feedback erreur : `showAlert` + titre `ERR` sur la touche concernée quand `TWITCH_STATE.error` est posé (`clip_failed`, `marker_failed`, `refresh_failed`, …).

## Protocol WS

- État : `{ "type": "TWITCH_STATE", "data": { … } }`
- Commandes : `{ "type": "TWITCH_COMMAND", "endpoint": "refresh" \| "create_clip" \| "create_marker" \| "set_credentials" \| … }`

Prefs Hub : clé `plugins.twitch` (premium). Catalogue : `requiresPremium: true`, pricing **5.99 CHF/mois**. Hardware : StreamDock ✓, Elgato ✗.

## OAuth / token — scopes requis

Token **utilisateur** (pas app-only) + Client-Id de votre app Twitch.

| Scope | Usage MVP |
| --- | --- |
| `clips:edit` | Create Clip |
| `channel:manage:broadcast` | Create Stream Marker |

Viewers / live (`GET /helix/streams`) : même user token, pas de scope supplémentaire pour un flux public.

### Où coller les credentials

1. **Hub → Paramètres → Plugins → Twitch** : Client ID + Access Token (persistés dans `data.json`).
2. **Env** (prioritaire sur le disque) :

| Variable | Rôle |
| --- | --- |
| `TWITCH_CLIENT_ID` | Client-Id Helix |
| `TWITCH_ACCESS_TOKEN` ou `TWITCH_OAUTH_TOKEN` | Bearer user access token (`oauth:` accepté) |
| `TWITCH_BROADCASTER_ID` | Optionnel (sinon `GET /users`) |
| `TWITCH_USER_LOGIN` | Optionnel (streams by login) |

Générer un token : [Twitch Console](https://dev.twitch.tv/console/apps) / Token Generator avec les scopes ci-dessus.  
Pas de flow OAuth interactif bout-en-bout dans le MVP.

## Tester

1. Sidecar : `CRIMSON_DEV=1 ./target/debug/crimsons-server`
2. Sans credentials → mock (42 viewers, live).
3. Inject StreamDock (Windows) :
   ```powershell
   .\scripts\inject_plugins.ps1 -Extra com.laoy.streamdock.twitch.sdPlugin
   ```
4. Hub Crimsons → activer **Twitch** (Premium requis) → coller Client ID + token.

## Limites MVP

- OAuth interactif non branché (token collé / env only).
- Mute alerts / follower goal / clear chat = stubs.
- Clear chat réel : IRC + scopes mod (hors ship).
- Clip / marker Helix exigent un **stream live**.
- Icônes géométriques placeholders.
- Hardware Elgato non supporté (catalogue).
