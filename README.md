# CRIMSONS

Assistant de bureau pour joueurs : League of Legends (draft / auto-accept / pick-ban), Spotify, et contrôle Stream Deck / StreamDock — le tout dans une app Windows native. Les plugins StreamDock sont **hors** de Crimsons : catalogue web + API.

Version actuelle : **3.1.4**.

## Architecture

```
┌─────────────────────────┐     WebSocket local      ┌──────────────────────┐
│  crimson/ (Tauri + UI)  │ ◄──────────────────────► │  crimsons-server     │
│  React (Vite) + Rust    │                          │  (sidecar Rust)      │
└─────────────────────────┘                          └──────────┬───────────┘
                                                                │
                     ┌──────────────────────────────────────────┼──────────┐
                     ▼                                          ▼          ▼
              LCU (LoL client)                              Spotify     StreamDock plugins
                                                                          (catalogue)
┌─────────────────────────┐     HTTPS /api ou Supabase   ┌──────────────────┐
│  store/ (web catalogue) │ ◄───────────────────────────► │  plugin_catalog  │
└─────────────────────────┘                               └──────────────────┘
```

| Pièce | Rôle |
| --- | --- |
| `crimson/` | App Tauri 2 : UI React, commandes natives, lance le sidecar — **aucun** `.sdPlugin` embarqué |
| `server/` (crate `crimson-server`, binary `crimsons-server`) | Sidecar : WebSocket local, intégrations, bridge StreamDock |
| `crimson/src-tauri/crates/lcu_commands` | Logique LCU / draft partagée |
| `plugins/catalog/` | Tous les packs StreamDock + `catalog.json` (catégories d’usage) |
| `store/` | App web catalogue — listing + API locale `/api/catalog` |
| Supabase | Auth / premium + tables `plugin_catalog` / `plugin_categories` ([migration](supabase/migrations/20261015060000_plugin_catalog.sql)) |

Décision architecture : [`docs/ADR_PLUGIN_STORE.md`](docs/ADR_PLUGIN_STORE.md).

Auth / droits premium : Supabase (client + vérif côté serveur).

## Canonical names

These are the names that must stay aligned. Do **not** “fix” frozen IDs.

| Surface | Canonical value | Notes |
| --- | --- | --- |
| Brand | **CRIMSONS** / Crimsons | User-facing copy, window titles, installer, shortcuts |
| Tauri identifier / AppData | `com.laoy.crimsons` | Keep. Legacy folders `com.laoy.crimson` and `com.laoy.crimons` are migration **sources** only |
| Install folder | `C:\Program Files\CRIMSONS\` | From `productName` |
| UI executable | **`Crimsons.exe`** | `mainBinaryName` + Cargo package `crimsons`. Not `Crimson.exe` |
| Sidecar executable | **`crimsons-server.exe`** | Task Manager / autostart. Crate name stays `crimson-server` (Rust `use crimson_server::`) |
| Sidecar ProductName | Crimsons / Crimsons Server | winres FileDescription |
| GitHub | `Ryan-DPC/Crimsons` | Frozen (renaming the remote would break updater + clones) |
| StreamDock plugin UUIDs | `com.laoy.streamdock.crimson.*`, `com.laoy.streamdock.spotify.*`, `com.laoy.streamdock.discord.*` | **Frozen** — changing them breaks existing decks |
| Env vars / mutex | `CRIMSON_DEV`, `CRIMSON_STRICT_AUTH`, `Global\crimson_server_v2_lock` | Internal; keep |
| Tauri invoke names | `crimson_quit_app`, `crimson_start_server`, … | Internal IPC; keep |

The frontend folder `crimson/` and the Rust crate `crimson-server` stay as-is to avoid a repo-wide rename. The **shipped** binaries are Crimsons / crimsons-server.

## Utilisateur final

Voir [`docs/GUIDE_UTILISATEUR.md`](docs/GUIDE_UTILISATEUR.md) : connexion sans Premium, LoL automatique, setup unique Spotify / Discord, Actualiser après achat Premium, installation plugins via catalogue.

## Plugins (catalogue)

Aucun pack de base dans Crimsons. Listing : [`plugins/catalog/catalog.json`](plugins/catalog/catalog.json) + store web.

| Plugin | Catégories | Statut | Tarif |
| --- | --- | --- | --- |
| League of Legends | StreamDock, Jeu | Publié | Gratuit |
| Spotify | StreamDock, Médias, Utilitaire | Publié | Premium |
| Discord | StreamDock, Communication, Utilitaire | Publié | Premium |
| Philips Hue | StreamDock, Maison connectée, Utilitaire | Bientôt | TBD |
| Twitch | StreamDock, Streaming, Communication | Bientôt | TBD |

```powershell
# Dev seulement — pas de défaut : lister les packages
.\scripts\inject_plugins.ps1 -Plugins com.laoy.streamdock.crimson.sdPlugin,com.laoy.streamdock.spotify.sdPlugin
```

```bash
cd store && npm install && npm run dev   # http://localhost:5174 — GET /api/catalog
```

## App native vs localhost (important)

| Mode | Comment lancer | UI |
| --- | --- | --- |
| **Installé (utilisateur)** | `C:\Program Files\CRIMSONS\Crimsons.exe` (copie de transition : `crimson.exe`) | Frontend **embarqué** dans l’exe — pas de Vite, pas de `localhost:5173`, pas de barre d’URL navigateur |
| **Dev seulement** | `npm run tauri dev` (ou `npm run dev` dans le navigateur) | Vite sert `http://localhost:5173` — normal en développement uniquement |

L’autostart Windows (`HKCU\...\Run\CrimsonsServer`) lance le sidecar natif `crimsons-server.exe` (jamais un serveur Vite). Le WebSocket local `127.0.0.1:40510` est le moteur en arrière-plan, pas l’UI.

Ne pas ouvrir Crimsons dans Chrome/Edge via localhost : ce n’est pas l’app de bureau.

## Développement

Prérequis : **Windows**, Node 20+, Rust stable, [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```powershell
# Frontend seul (hot reload Vite) — localhost:5173, DEV ONLY
cd crimson
npm ci
npm run dev

# App complète fenêtre native + Vite (toujours DEV : l’UI passe par localhost:5173)
cd crimson
npm run tauri dev

# Catalogue web
cd store
npm install
npm run dev
```

Build release local (sidecar + bundle Tauri) — produit l’exe avec UI embarquée :

```powershell
.\scripts\build_release.ps1
```

## Variables d'environnement

Créer `crimson/.env` (non versionné) :

| Variable | Usage |
| --- | --- |
| `VITE_SUPABASE_URL` | URL projet Supabase (inlinée par Vite ; aussi lue par `server/build.rs`) |
| `VITE_SUPABASE_ANON_KEY` | Clé anon Supabase |
| `CRIMSON_STRICT_AUTH` | Si `1`, le sidecar refuse les connexions WS sans jeton local (sinon log seulement) |

Sans `VITE_SUPABASE_*`, le client peut afficher un écran noir (voir le workflow Release).

`store/.env` (optionnel) : mêmes clés pour lire `plugin_catalog` une fois la migration appliquée.

## CI & release

- PRs / push `main` : [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — ESLint + `tsc`, Clippy + tests Rust (`crimson-server` crate, `lcu_commands`) sur Windows. **Pas** de bundle Tauri.
- Tags `v*` / `main` : [`.github/workflows/release.yml`](.github/workflows/release.yml) — build + publication.

## Suivi des bugs

Voir [`ETAT_DES_LIEUX.md`](ETAT_DES_LIEUX.md) (tracker des problèmes connus). Vision produit : [`crimson/PROJECT_CRIMSONS.md`](crimson/PROJECT_CRIMSONS.md).
