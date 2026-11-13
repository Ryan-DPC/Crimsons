# Catalogue plugins Crimsons

Tous les packs StreamDock vivent **ici**, hors de l’app Crimsons. Aucun plugin n’est livré avec l’installeur.

| Package | Catégories | Statut | Prix | Hardware |
| --- | --- | --- | --- | --- |
| `com.laoy.streamdock.crimson.sdPlugin` | StreamDock, Jeu | Bientôt | Inclus | StreamDock |
| `com.laoy.streamdock.spotify.sdPlugin` | StreamDock, Médias, Utilitaire | Bientôt | 5.99 CHF/mois | StreamDock |
| `com.laoy.streamdock.applemusic.sdPlugin` | StreamDock, Médias, Utilitaire | Publié | 5.99 CHF/mois | StreamDock |
| `com.laoy.streamdock.discord.sdPlugin` | StreamDock, Communication, Utilitaire | Bientôt | 5.99 CHF/mois | StreamDock |
| `com.laoy.streamdock.hue.sdPlugin` | StreamDock, Maison connectée, Utilitaire | Bientôt | 5.99 CHF/mois | StreamDock |
| `com.laoy.streamdock.twitch.sdPlugin` | StreamDock, Streaming, Communication | Bientôt | 5.99 CHF/mois | StreamDock |

Source de vérité listée : [`catalog.json`](catalog.json) (consommée par le store web + seed Supabase).

Prix plugin de base gelé à **5.99 CHF/mois** (annuel 59.90 = 5.99×10) — voir `feat/pricing-5-99-20a4` / `docs/PAYMENTS.md`.

Architecture : [`docs/ADR_PLUGIN_STORE.md`](../../docs/ADR_PLUGIN_STORE.md).

## Helpers JS partagés (anti-divergence)

Chaque pack recopie aujourd’hui les mêmes fichiers :

- `plugin/crimson_ws.js` — client WS sidecar (hash stable entre Spotify / Hue / Twitch / Valorant / Volume)
- `plugin/streamdeck_ui.js` — helpers UI StreamDock
- `plugin/crimson_auth_token.js` — lecture jeton local

**Canonical** : `com.laoy.streamdock.spotify.sdPlugin/plugin/crimson_ws.js` (et jumeaux Spotify pour `streamdeck_ui.js`).
Avant merge d’un nouveau plugin, vérifier que ces fichiers restent **byte-identiques** au canonical (pas de forks silencieux). Un dossier `_shared/` + script de sync est le backlog recommandé.

## Dev — inject manuel

Plus de pack de base. Il faut lister explicitement les plugins :

```powershell
.\scripts\inject_plugins.ps1 -Plugins com.laoy.streamdock.crimson.sdPlugin,com.laoy.streamdock.spotify.sdPlugin
.\scripts\inject_plugins.ps1 -Plugins com.laoy.streamdock.discord.sdPlugin
```
