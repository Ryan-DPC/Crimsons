# Catalogue plugins Crimsons

Tous les packs StreamDock vivent **ici**, hors de l’app Crimsons. Aucun plugin n’est livré avec l’installeur.

| Package | Catégories | Statut | Prix |
| --- | --- | --- | --- |
| `com.laoy.streamdock.crimson.sdPlugin` | StreamDock, Jeu | Publié | Gratuit |
| `com.laoy.streamdock.spotify.sdPlugin` | StreamDock, Médias, Utilitaire | Publié | Premium |
| `com.laoy.streamdock.discord.sdPlugin` | StreamDock, Communication, Utilitaire | Publié | Premium |
| `com.laoy.streamdock.hue.sdPlugin` | StreamDock, Maison connectée, Utilitaire | Bientôt | TBD |
| `com.laoy.streamdock.twitch.sdPlugin` | StreamDock, Streaming, Communication | Bientôt | TBD |

Source de vérité listée : [`catalog.json`](catalog.json) (consommée par le store web + seed Supabase).

Architecture : [`docs/ADR_PLUGIN_STORE.md`](../../docs/ADR_PLUGIN_STORE.md).

## Dev — inject manuel

Plus de pack de base. Il faut lister explicitement les plugins :

```powershell
.\scripts\inject_plugins.ps1 -Plugins com.laoy.streamdock.crimson.sdPlugin,com.laoy.streamdock.spotify.sdPlugin
.\scripts\inject_plugins.ps1 -Plugins com.laoy.streamdock.discord.sdPlugin
```
