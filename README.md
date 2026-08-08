# CRIMSONS

Assistant de bureau pour joueurs : League of Legends (draft / auto-accept / pick-ban), Spotify, et contrôle Stream Deck / StreamDock — le tout dans une app Windows native. Discord et d’autres intégrations arrivent en plugins optionnels / externes.

Version actuelle : **3.1.4**.

## Architecture

```
┌─────────────────────────┐     WebSocket local      ┌──────────────────────┐
│  crimson/ (Tauri + UI)  │ ◄──────────────────────► │  crimson-server      │
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
| `server/` (`crimson-server`) | Sidecar : WebSocket local, intégrations, bridge StreamDock |
| `crimson/src-tauri/crates/lcu_commands` | Logique LCU / draft partagée |
| `plugins/streamdeck/` | **Base :** Crimsons (LoL) + Spotify. Discord optionnel. |
| `plugins/streamdeck/optional/` | Stubs / futurs plugins externes (Hue, Twitch, …) |

Auth / droits premium : Supabase (client + vérif côté serveur).

## Plugins StreamDock

| Pack | Contenu |
| --- | --- |
| **Base** (injecté par défaut) | LoL + Spotify |
| **Optionnel** | Discord — `.\scripts\inject_plugins.ps1 -IncludeDiscord` (Premium) |
| **Externes (plus tard)** | Hue, Twitch, … téléchargeables ; gratuits ou payants selon le catalogue / la communauté |

## Développement

Prérequis : **Windows**, Node 20+, Rust stable, [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```powershell
# Frontend seul (hot reload Vite)
cd crimson
npm ci
npm run dev

# App complète (Tauri + sidecar)
cd crimson
npm run tauri dev
```

Build release local (sidecar + bundle Tauri) :

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

- PRs / push `main` : [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — ESLint + `tsc`, Clippy + tests Rust (`crimson-server`, `lcu_commands`) sur Windows. **Pas** de bundle Tauri.
- Tags `v*` / `main` : [`.github/workflows/release.yml`](.github/workflows/release.yml) — build + publication.

## Suivi des bugs

Voir [`ETAT_DES_LIEUX.md`](ETAT_DES_LIEUX.md) (tracker des problèmes connus). Vision produit : [`crimson/PROJECT_CRIMSONS.md`](crimson/PROJECT_CRIMSONS.md).
