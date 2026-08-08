# État des lieux — tracker des problèmes connus (Crimsons v3.1.4)

| | |
| --- | --- |
| **Version suivie** | 3.1.4 |
| **Identifiant canonique** | `com.laoy.crimsons` (AppData + `tauri.conf.json`) |
| **Dernier audit doc** | 2026-08-07 (plugins de base + Discord) |
| **Rôle de ce fichier** | Liste honnête des bugs / dettes encore ouverts. Ne pas marquer « corrigé » sans vérification dans le code ou un test manuel. |

Les chemins monorepo ci-dessous remplacent l’ancienne référence au lecteur `F:`.

---

## Pack plugins (produit)

| Niveau | Plugins StreamDock |
| --- | --- |
| **Base (injectés par défaut)** | LoL (`crimson`) + Spotify |
| **Optionnel maintenu** | Discord (`-IncludeDiscord`) — Premium |
| **Externes futurs** | Hue, Twitch, etc. sous `plugins/streamdeck/optional/` — téléchargeables plus tard (gratuits ou payants, communauté) |

---

## Corrigé / validé

### Auth WebSocket + CSP
* **Strict auth ON par défaut** (`server/src/auth.rs`) — `CRIMSON_STRICT_AUTH=0` / `false` / `off` pour désactiver.
* Plugins StreamDock lisent `%APPDATA%\com.laoy.crimsons\auth.token` et passent `?token=`.
* Property Inspectors HTML **ne** ouvrent plus de WS non authentifié vers `:40510`.
* CSP Tauri non-null ; capability sidecar `bin/crimson-server`.

### LCU auto-accept / pick-ban
* Ready-check sur état LCU **`InProgress`** ; sync `AtomicBool` ↔ `data.json` ; boucle automation côté sidecar uniquement.
* **Statut produit :** **validé en conditions réelles** (auto-accept + pick/ban) — 2026-08-07.

### Spotify
* Secrets hors `localStorage` / query d’authorization.
* Cycle shuffle Off → Standard → Smart (flag local) → Off ; **Smart Shuffle API impossible** (limitation amont).
* Déduplication d’images StreamDock.

### Discord (soigné 2026-08-07, statut vocal 2026-08-07)
* Actions livrées : mute, deafen, camera, join voice (PI `channelId`).
* Soundboard / screenshare retirés du manifeste et de l’UI Home (fragiles / non branchés).
* KeyDown Discord géré côté bridge serveur (comme Spotify) + fallback plugin.
* Code mort `core/` retiré du plugin Discord.
* **IPC :** handshake attend `READY`, frames lues correctement, subscribe `VOICE_SETTINGS_UPDATE_2` (format `evt` racine), mute/deaf via `SET_VOICE_SETTINGS_2`, broadcast `DISCORD_STATE` immédiat + heartbeat UI.
* Hub Settings : bandeau « Détection Automatique (IPC) » retiré.
* **Non injecté par défaut** — `.\scripts\inject_plugins.ps1 -IncludeDiscord`.
* **Limite :** savoir si on est « en vocal » (`in_voice` / salon) peut exiger le scope OAuth `rpc` côté app Discord ; mute/deaf locaux marchent en IPC (`rpc.local`).

### Identité AppData
* Canonique : **`com.laoy.crimsons`** (+ migration au démarrage).

### Hue / Twitch
* Plus dans le hub Settings ni dans l’injection de base.
* Stubs déplacés vers `plugins/streamdeck/optional/` pour un futur catalogue externe (Premium / communauté).
* Serveur : stubs `FEATURE_UNAVAILABLE` conservés pour un éventuel branchement API.

### CI + doc
* `.github/workflows/ci.yml` : ESLint (`continue-on-error`), `tsc -b`, Clippy + `cargo test` (Windows).
* README racine présent.

---

## Problèmes / limitations encore ouverts

### 1. Smart Shuffle — limitation API Spotify (pas un bug Crimson)
* Le 3ᵉ état « Smart » est un flag UX local ; l’API Spotify ne propose que on/off.

### 2. Sécurité locale résiduelle — vol de jeton AppData
* Tout process du même user Windows peut lire `auth.token` / session Supabase sur disque.
* Attendu pour un serveur local ; le mode strict bloque les clients **sans** jeton.

### 3. Frontend — interface et CSS
* Superpositions / manque d’air (ex. Auto Selection vs grille de champions).
* **Statut :** Ouvert.

### 4. Catalogue plugins externes
* Pas encore de store / download in-app pour Hue, Twitch, etc.
* Décisions freemium vs payant à trancher avec la communauté.

---

## Dette outillage (hors produit)

* ESLint frontend : ~100 erreurs historiques — job CI **visible** mais `continue-on-error: true`.
* Clippy sans `-D warnings`.
* Couverture tests encore faible hors Origin WS / automation ready-check / entitlements ponctuels.
