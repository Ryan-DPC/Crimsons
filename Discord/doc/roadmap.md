# 🗺️ CRIMSON (V0.1.X) - Roadmap & Implémentations Actives

Ce document compile toutes les idées d'ajout pour l'application **CRIMSON** ainsi que les intégrations matérielles (Stream Deck Ajazz AKP153), logiques et visuelles.

---

## 🎹 Intégration Matérielle (Ajazz Stream Deck)
L'application tournant en local (Tauri/Rust), elle peut très facilement s'interfacer avec les plugins Javascript de ton Stream Deck pour déclencher des endpoints invisibles de l'ordinateur.

- [ ] **Touche "Auto-Accept" (Toggle)** : Switcher le statut d'auto-accept d'une simple pression sur le clavier sans avoir la fenêtre ouverte.
- [ ] **Bouton d'Urgence (Dodge)** : Un raccourci physique "Dodge" (fermez le client LoL proprement si tu détectes un troll en lobby).
- [ ] **HUD de Lobby LCD** : Les écrans de tes touches pourraient afficher les visages/icônes des champions sélectionnés par tes alliés ou le statut de la file d'attente.
- [ ] **Sélecteur de Rôle Instantané** : Dès l'entrée en Lobby, deux touches sur le deck s'allument à l'effigie de tes deux main champs, un appui "Pré-sélectionne" ou "Lock" direct ce champion.
- [x] **Injecteur de Build** : Déclencher le process d'injection des meilleurs paramètres (Runes & Sorts) du bout du doigt dès que t'es prêt.
- [ ] **Tracker de LP Physique** : Un bouton qui affiche ton LP actuel ou ton Delta de session (`+18` / `-15`) directement sur le bouton du deck.

---

## 🧠 Fonctionnalités Logiques (Système LCU & Data)
- [x] **Auto-Ban & Auto-Pick Intelligent** : Pouvoir définir une "Blacklist" et un "Snipe" de champions automatiques via l'interface.
- [ ] **Redirection Web Profils (OP.GG / U.GG)** : Afficher les Pseudos des alliés sous leurs portraits en pick phase. Au clic sur le pseudo, ouvrir directement leur profil sur un site de stats d'analyse externe (via navigateur web) pour garder l'interface CRIMSON épurée.
- [ ] **Radar à Trolls (Scout Anti-Smurf / Winrate)** : Dès que tu entres dans le lobby (ChampSelect), CRIMSON récupère l'historique de tes alliés, repère les win streaks, les picks exotiques (ex: Yuumi Jungle) ou les gros tilt (10 défaites de suite) et t'alerte avec une bordure rouge pour te conseiller de Dodge.
- [ ] **Dashboard MMR (Suivi de l'évolution des LPs)** : Garder en mémoire tous les +/- LP de la journée en traçant une courbe mathématique ("Aujourd'hui : +34 LP", "Winrate : 65%") pour faire de l'accueil un vrai tableau de bord.
- [ ] **Base de données SQLite (Archives Complètes)** : Au lieu d'avoir juste 10 matchs pour survivre offline, stocker TOUS les résultats de toutes les parties vues pour pouvoir établir tes propres graphes d'évolution des performances.
- [ ] **Gestion Multi-Comptes** : Basculer de profil et d'historique de matchs de façon parfaitement transparente lorsque tu te connectes sur ton smurf.
- [ ] **Tracker en Jeu (Timers/HUD caché)** : Exploitation de l'API In-Game (Live Client Data) pour capter si la partie est dominée en or ou non, avec mise à jour du deck ou de la fenêtre.

---

## 🎨 Implémentations Visuelles ("DA Crimson")
Le Front-End est flexible, on peut le rendre beaucoup plus interactif et organique tout en gardant l'esthétique rigide rouge/noire.

- [ ] **Animations de Parallaxe 3D** : Dans le profil principal, utiliser l'image d'accueil (ou l'arrière-plan hextech) pour qu'elle suive doucement les mouvements de ta souris.
- [ ] **Transitions de Phase Fluides** : Lors du passage entre l'accueil et le lobby (quand l'API t'annonce que ça passe de `None` à `ChampSelect`), la fenêtre pourrait avoir un flash ou un volet mécanique à la "Projet: Ashe" qui dévoile les données pour plus d'immersion.
- [ ] **Graphes "Sharp"** : Intégrer un graphique simple aux angles très pointus pour la courbe d'évolution des LP en cours de session.
- [ ] **Fonds de Cartes Animés** : Les cartes d'historique pourraient afficher occasionnellement une légère lumière dynamique "balayant" le bord des cartes victorieuses.
- [ ] **Glassmorphisme "Toxique"** : Rendre les écrans de pop-up d'informations plus nets avec de l'acrylique granuleux rouge foncé (filtre noise CSS + backdrop-blur profond).

---

> *"Moderne, Basique, Carré, mais extrêmement performant."*
