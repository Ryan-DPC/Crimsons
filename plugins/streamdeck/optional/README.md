# Plugins optionnels / externes

Ces plugins **ne font pas partie du pack de base** (LoL + Spotify) en transition.

**Cible :** tous les plugins (y compris LoL / Spotify / Discord) vivent dans le catalogue web indépendant — voir [`docs/ADR_PLUGIN_STORE.md`](../../../docs/ADR_PLUGIN_STORE.md). Pas de 2ᵉ app desktop ; lien via API HTTPS + install sidecar.

| Plugin | Statut |
| --- | --- |
| `com.laoy.streamdock.hue.sdPlugin` | Stub — futur plugin téléchargeable (premium / communauté) |
| `com.laoy.streamdock.twitch.sdPlugin` | Stub — futur plugin téléchargeable (premium / communauté) |

Ils ne sont **pas** injectés par `scripts/inject_plugins.ps1` sans `-Extra`.

Le plugin Discord maintenu reste dans `plugins/streamdeck/` mais n’est injecté qu’avec `-IncludeDiscord`.
