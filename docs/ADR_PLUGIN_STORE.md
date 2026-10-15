# ADR — Catalogue / store de plugins (hors Crimsons)

**Statut :** Accepté  
**Date :** 2026-10-15  
**Contexte :** Crimsons ne doit plus embarquer de plugins StreamDock. Tous les packs (LoL, Spotify, Discord, Hue, Twitch, communauté…) vivent dans un catalogue indépendant, téléchargeable.

---

## Décision

| Couche | Choix | Pourquoi |
| --- | --- | --- |
| **Surface catalogue** | **App web** (site / PWA), pas une 2ᵉ app desktop | Découverte, SEO, paiements, versions — zéro install. Pas de second binaire Tauri à maintenir. |
| **Lien Crimsons ↔ store** | **API web HTTPS** (Supabase + Storage CDN) | Même auth que Crimsons ; catalogue versionné ; entitlements par plugin. |
| **Installation réelle** | **Sidecar Crimsons** (`crimsons-server`) | Seul un process natif peut écrire dans `%APPDATA%\HotSpot\StreamDock\plugins\`. Le navigateur ne peut pas. |
| **Contenu de Crimsons** | **Aucun `.sdPlugin` livré** | L’installeur / le bundle Tauri ne contient plus de pack de base. Premier lancement → store ou deep-link pour installer ce qu’il faut. |

Pas de 2ᵉ app desktop « Crimsons Store ». Une app native dédiée dupliquerait auth, updater, entitlements et n’apporterait que l’install FS — déjà du ressort du sidecar.

---

## Architecture cible

```
┌──────────────────────────┐         HTTPS API          ┌─────────────────────────┐
│  store.crimsons… (web)   │ ◄─────────────────────────► │  Supabase                │
│  catalogue, pages, pay   │         + Storage CDN       │  plugins / versions /    │
└────────────┬─────────────┘                             │  entitlements / zips     │
             │ deep-link                                 └────────────▲────────────┘
             │ crimsons://install?id=…                                  │
             ▼                                                          │ HTTPS
┌──────────────────────────┐     WS local :40510      ┌────────────────┴──────────┐
│  Crimsons.exe (UI)       │ ◄───────────────────────► │  crimsons-server          │
│  Hub : installés / on-off│                           │  download zip → extract   │
└──────────────────────────┘                           │  → StreamDock\plugins\    │
                                                       └──────────────────────────┘
```

### Flux install

1. User parcourt le **store web** (ou un onglet Hub qui consomme la même API).
2. Clic « Installer » → deep-link `crimsons://plugin/install?id=<uuid>&v=<semver>` **ou** bouton in-app qui appelle l’API.
3. Sidecar : vérifie entitlement → télécharge l’artefact signé → extrait vers `HotSpot\StreamDock\plugins\<id>.sdPlugin` → redémarre StreamDock si besoin → broadcast `PLUGIN_INSTALLED`.
4. Hub affiche présence + toggle (comme aujourd’hui) ; plus d’`inject_plugins.ps1` pour l’utilisateur final.

### Ce que Crimsons garde

- Runtime d’intégrations (LCU, Spotify OAuth, Discord IPC, bridge StreamDock).
- Toggles `TOGGLE_PLUGIN` / prefs `data.json`.
- Vérif présence FS (`check_plugin_presence`).
- **Nouveau :** client catalogue + commande d’install/uninstall via sidecar.

### Ce que le store web porte

- Listing public (nom, description, icônes, changelog, prix, tags).
- Pages plugin + compte / achat.
- Publication des releases (équipe + plus tard communauté).
- **Pas** l’écriture disque StreamDock.

---

## API web (contrat minimal)

Backend = Supabase (déjà utilisé pour auth / premium). Schéma indicatif :

| Ressource | Rôle |
| --- | --- |
| `plugin_catalog` | id, slug, name, summary, icons, visibility, pricing_model |
| `plugin_versions` | plugin_id, semver, download_path (Storage), sha256, min_crimsons_version, release_notes, published_at |
| `plugin_entitlements` | user_id, plugin_id, source (free / premium / purchase), expires_at |

Endpoints (REST Supabase ou Edge Functions) :

- `GET /plugins` — catalogue public (métadonnées, pas les zips privés).
- `GET /plugins/:id` — détail + versions.
- `GET /plugins/:id/download?version=` — URL signée Storage **si** entitlement OK (JWT user).
- `GET /me/entitlements` — plugins que l’user peut installer / mettre à jour.

Le sidecar appelle ces endpoints avec le JWT local (`auth.token`), jamais avec une clé service_role côté client.

Premium global (`profiles.is_premium`) peut mapper à un lot d’entitlements (ex. Spotify + Discord) ; les plugins communauté restent ligne à ligne.

---

## Pourquoi pas desktop-only / web-only

| Option | Verdict |
| --- | --- |
| **2ᵉ app desktop store** | Rejeté — coût double (Tauri, updater, auth), UX fragmentée. |
| **Store 100 % web sans sidecar** | Impossible pour l’install : le navigateur ne peut pas écrire dans le dossier StreamDock. |
| **Tout dans Crimsons sans site** | Possible techniquement, mais mauvais pour SEO, partage de liens, paiements web, et contredit « app complémentaire indépendante ». |
| **Web catalogue + install sidecar** | **Retenu** — une API, deux surfaces (site + Hub). |

---

## Migration depuis l’état actuel

**Fait (2026-10-15) :**

1. Tous les `.sdPlugin` sous `plugins/catalog/` (plus de pack de base / `optional/`).
2. `plugins/catalog/catalog.json` + catégories d’usage (streamdeck, jeu, utilitaire, …).
3. Store web `store/` avec API locale `/api/catalog` (+ client Supabase prêt).
4. Migration SQL `supabase/migrations/20261015060000_plugin_catalog.sql`.
5. `inject_plugins.ps1` exige `-Plugins` (plus de défaut LoL+Spotify).

**Reste :**

1. Restaurer le projet Supabase INACTIVE + appliquer la migration + Storage download signé.
2. Sidecar : `INSTALL_PLUGIN` / `UNINSTALL_PLUGIN` / `LIST_INSTALLED`.
3. Hub : boutons install (consomme l’API) + deep-links `crimsons://…`.
4. Guide utilisateur final sans PowerShell.

---

## Hors scope de cet ADR

- Modèle de prix exact par plugin (gratuit / premium bundle / à l’unité) — à trancher avec la communauté.
- Signature code-signing Windows des zips (prévu avant ouverture communauté).
- Marketplace contributeurs tiers (moderations, revenue share).

---

## Références

- Vision produit : [`crimson/PROJECT_CRIMSONS.md`](../crimson/PROJECT_CRIMSONS.md)
- Catalogue : [`plugins/catalog/README.md`](../plugins/catalog/README.md)
- Store web : [`store/README.md`](../store/README.md)
- Tracker : [`ETAT_DES_LIEUX.md`](../ETAT_DES_LIEUX.md) §4
