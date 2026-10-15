# Projet Crimsons

**Crimsons** est un assistant de bureau premium pensé pour les joueurs et les utilisateurs avancés. Son but est de centraliser toutes les informations et interactions importantes en une seule interface élégante, fluide et non-intrusive. Conçu avec une esthétique "Dark & Glassmorphism" avec des accents cramoisis (crimson red), il se veut être le hub ultime pour la session de jeu.

---

## Vision du Projet
Offrir un écosystème connecté qui permet au joueur de ne jamais avoir à quitter son jeu des yeux ou à faire des alt-tabs incessants. Crimsons s'occupe de la musique, des statistiques de jeu, et de la communication de manière unifiée.

---

## Modèle Économique & Plugins

Crimsons fonctionne sur un modèle **Freemium**. L'assistance de base pour League of Legends est accessible à tous, tandis que l'intégration des services tiers est réservée aux utilisateurs Premium.

### Accès Gratuit (Base)
**1. League of Legends**
- **Auto-Accept & Ready Check** : Accepte automatiquement les parties.
- **Pick / Ban** : automatisation de la sélection en draft.
- **Analyse de la Draft** : Statistiques en temps réel sur les alliés et les adversaires dans le lobby.
- **Live Game State** : Détection de la phase de jeu (Lobby, Champ Select, In-Game, Post-Game).
- **Suggestions de Builds** : Recommandation d'objets dynamiques selon la composition ennemie.

### Accès Premium — pack StreamDock de base
**2. Spotify Integration**
- **Contrôle de lecture** : Play/Pause, Next, Previous depuis l'application et StreamDock.
- **Affichage des Lyrics** : Fenêtre flottante pour afficher les paroles en temps réel.
- *(Roadmap)* Auto-DJ selon la phase de jeu.

### Plugins — hors de Crimsons (catalogue indépendant)

**Décision :** voir [`docs/ADR_PLUGIN_STORE.md`](../docs/ADR_PLUGIN_STORE.md).

- Crimsons **ne livre aucun** `.sdPlugin` de base.
- Catalogue = **app web** + **API HTTPS** (Supabase / Storage).
- Installation = **sidecar** Crimsons (écriture disque StreamDock) via Hub ou deep-link `crimsons://…`.
- Pas de 2ᵉ app desktop « store ».

| Plugin | Statut (transition) |
| --- | --- |
| **LoL, Spotify** | Encore dans le repo + `inject_plugins.ps1` (dev) ; cibles catalogue, plus pack installateur. |
| **Discord** | Optionnel maintenu (Premium) — même chemin catalogue. |
| **Twitch, Hue, …** | Stubs → fiches catalogue quand prêts (gratuits ou payants, communauté). |

---

## Direction Artistique & Design

- **Couleurs Principales** : Noir Profond (`#050505`), Gris Anthracite (`#111115`), et Rouge Cramoisi (`#DC2626` à `#991B1B`).
- **Typographie** : Moderne, sans-serif avec graisses prononcées pour les titres.
- **Effets** : Glassmorphism, micro-animations fluides.

---

## Prochaines Étapes
1. Implémenter le schéma / API catalogue (ADR) + install sidecar.
2. Site web catalogue public + deep-links ; vider le pack de base de l’installeur.
3. Trancher le modèle payant vs gratuit par plugin avec la communauté.
4. Continuer le polish UI et les intégrations optionnelles (Discord Rich Presence, etc.).
