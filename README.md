# CRIMSONS

Assistant de bureau pour joueurs : League of Legends (draft / auto-accept / pick-ban), Spotify, et contrôle Stream Deck / StreamDock — le tout dans une app Windows native. Discord et d’autres intégrations arrivent en plugins optionnels / externes.

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
                                                                          (plugins/)
```

| Pièce | Rôle |
| --- | --- |
| `crimson/` | App Tauri 2 : UI React, commandes natives, lance le sidecar |
| `server/` (crate `crimson-server`, binary `crimsons-server`) | Sidecar : WebSocket local, intégrations, bridge StreamDock |
| `crimson/src-tauri/crates/lcu_commands` | Logique LCU / draft partagée |
| `plugins/streamdeck/` | Packs StreamDock (transition) — **cible : aucun plugin dans Crimsons** ; catalogue web + API ([`docs/ADR_PLUGIN_STORE.md`](docs/ADR_PLUGIN_STORE.md)). |
| `plugins/streamdeck/optional/` | Stubs / futurs plugins catalogue (Hue, Twitch, …) |

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

Voir [`docs/GUIDE_UTILISATEUR.md`](docs/GUIDE_UTILISATEUR.md) : connexion sans Premium, LoL automatique, setup unique Spotify / Discord, Actualiser après achat Premium, injection StreamDock.

## Plugins StreamDock

**Cible produit :** Crimsons sans plugins embarqués. Catalogue = **site web** + **API HTTPS** ; install = sidecar. Détail : [`docs/ADR_PLUGIN_STORE.md`](docs/ADR_PLUGIN_STORE.md).

| Pack (état actuel / transition) | Contenu |
| --- | --- |
| **Dev inject** (`inject_plugins.ps1`) | LoL + Spotify par défaut |
| **Optionnel** | Discord — `.\scripts\inject_plugins.ps1 -IncludeDiscord` (Premium) |
| **Catalogue** | Tous les packs (LoL, Spotify, Discord, Hue, Twitch, …) téléchargeables via API ; gratuits ou payants selon le store |

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
```

Build release local (sidecar + bundle Tauri) — produit l’exe avec UI embarquée :

```powershell
.\scripts\build_release.ps1
```

Injecter / synchroniser les plugins StreamDock après modification :

```powershell
.\scripts\inject_plugins.ps1                 # LoL + Spotify
.\scripts\inject_plugins.ps1 -IncludeDiscord # + Discord
```

## Variables d'environnement

Créer `crimson/.env` (non versionné) :

| Variable | Usage |
| --- | --- |
| `VITE_SUPABASE_URL` | URL projet Supabase (inlinée par Vite ; aussi lue par `server/build.rs`) |
| `VITE_SUPABASE_ANON_KEY` | Clé anon Supabase |
| `CRIMSON_STRICT_AUTH` | Si `1`, le sidecar refuse les connexions WS sans jeton local (sinon log seulement) |

Sans `VITE_SUPABASE_*`, le client peut afficher un écran noir (voir le workflow Release).

## CI & release

- PRs / push `main` : [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — ESLint + `tsc`, Clippy + tests Rust (`crimson-server` crate, `lcu_commands`) sur Windows. **Pas** de bundle Tauri.
- Tags `v*` / `main` : [`.github/workflows/release.yml`](.github/workflows/release.yml) — build + publication.

## Suivi des bugs

Voir [`ETAT_DES_LIEUX.md`](ETAT_DES_LIEUX.md) (tracker des problèmes connus). Vision produit : [`crimson/PROJECT_CRIMSONS.md`](crimson/PROJECT_CRIMSONS.md).
