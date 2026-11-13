# Twitch — StreamDock plugin

UUID / dossier : `com.laoy.streamdock.twitch.sdPlugin`

Outils streamer via le sidecar Crimsons (`ws://127.0.0.1:40510`) et l’API **Helix**.  
Sans `TWITCH_CLIENT_ID` + token → données **mock** pour peindre les touches / le Hub.

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

## Protocol WS

- État : `{ "type": "TWITCH_STATE", "data": { … } }`
- Commandes : `{ "type": "TWITCH_COMMAND", "endpoint": "refresh" \| "create_clip" \| "create_marker" \| … }`

Prefs Hub : clé `plugins.twitch` (premium). Catalogue : `requiresPremium: true`, pricing **5.99 CHF/mois**. Hardware : StreamDock ✓, Elgato ✗.

## Env / OAuth (stub)

| Variable | Rôle |
| --- | --- |
| `TWITCH_CLIENT_ID` | Client-Id Helix |
| `TWITCH_ACCESS_TOKEN` ou `TWITCH_OAUTH_TOKEN` | Bearer user access token |
| `TWITCH_BROADCASTER_ID` | Optionnel (sinon `GET /users`) |
| `TWITCH_USER_LOGIN` | Optionnel (streams by login) |

Pas de flow OAuth bout-en-bout dans le MVP : coller un token d’app Twitch / Dev Console.

## Tester

1. Sidecar : `CRIMSON_DEV=1 ./target/debug/crimsons-server`
2. Sans credentials → mock (42 viewers, live).
3. Inject StreamDock (Windows) :
   ```powershell
   .\scripts\inject_plugins.ps1 -Extra com.laoy.streamdock.twitch.sdPlugin
   ```
4. Hub Crimsons → activer **Twitch** (Premium requis).

## Limites MVP

- OAuth interactif non branché (env token only).
- Mute alerts / follower goal / clear chat = stubs.
- Clear chat réel nécessiterait IRC + scopes mod.
- Icônes géométriques placeholders.
