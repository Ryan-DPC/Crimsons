# Valorant (Info) — StreamDock plugin

UUID / dossier : `com.laoy.streamdock.valorant.sdPlugin`

Plugin **info-only** : rang compétitif + historique de parties via le sidecar Crimsons (`ws://127.0.0.1:40510`).  
**Aucun** contrôle client Valorant (pas d’auto-accept, instalock, injection) — Vanguard interdit ce genre d’intégration.

## Actions MVP

| Action | UUID | Comportement |
| --- | --- | --- |
| Rank | `…valorant.rank` | Affiche tier + RR |
| Last Match | `…valorant.lastmatch` | W/L · KDA · agent (+ index) |
| Match Prev | `…valorant.match_prev` | Scroll historique `match_prev` |
| Match Next | `…valorant.match_next` | Scroll historique `match_next` |
| Refresh | `…valorant.refresh` | `VALORANT_COMMAND` / `refresh` |
| Open Hub / Store | `…valorant.openhub` | Ouvre `/plugins/valorant` |

## Protocol WS

- État : `{ "type": "VALORANT_STATE", "data": { … } }`
- Commandes : `{ "type": "VALORANT_COMMAND", "endpoint": "refresh" | "match_next" | "match_prev" }`

Prefs Hub : clé `plugins.valorant` (premium / future licence solo). Catalogue : `requiresPremium: true`, pricing **5.99 CHF/mois**.

## Tester

1. Sidecar : `CRIMSON_DEV=1 ./target/debug/crimsons-server` (depuis la racine du repo).
2. **Sans** `RIOT_API_KEY` → données **mock** (rang + 5 matchs) pour peindre les touches.
3. **Avec** `RIOT_API_KEY` → le module tente un fetch Riot cloud (RSO complet **hors MVP** ; fallback mock si échec).
4. Inject StreamDock (Windows) :
   ```powershell
   .\scripts\inject_plugins.ps1 -Extra com.laoy.streamdock.valorant.sdPlugin
   ```
   (ou copie manuelle vers `%APPDATA%\HotSpot\StreamDock\plugins\`).
5. Hub Crimsons → activer **Valorant** (compte Premium requis pour les commandes, comme Spotify/Discord).

## Limites MVP

- Pas de RSO / login Riot bout-en-bout.
- Mock si pas de clé / fetch KO.
- Icônes géométriques placeholders (pas d’assets Riot copyrightés).
- Store web : entrée catalogue ; page `/plugins/valorant` quand le routing store est présent.
