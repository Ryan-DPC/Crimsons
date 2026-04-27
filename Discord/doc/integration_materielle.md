# Intégration Matérielle : Architecture Ajazz AKP153 <> CRIMSON

Ce document explique l'architecture technique permettant aux plugins et outils externes (comme ton Stream Deck Ajazz AKP153) de communiquer de façon transparente avec l'application CRIMSON.

## Le Modèle Backend/Frontend Local
L'application CRIMSON est construite sur **Tauri** (Rust + React). Cela signifie que ce n'est pas qu'une simple page web, mais un véritable binaire système qui possède un Backend local caché.

### Architecture d'Écoute (Proposée)
Pour interfacer le Stream Deck et CRIMSON :
1. **CRIMSON Server (Rust)** : Le backend de CRIMSON ouvre un mini serveur HTTP ou WebSocket en tâche de fond sur l'ordinateur de l'utilisateur (par exemple `http://127.0.0.1:1420`).
2. **Endpoint Actions** : Le mini-serveur écoute des macros de commandes. Exemples :
   - `POST /api/macro/dodge` -> Déclenche l'abandon du lobby en cours
   - `POST /api/macro/auto-accept/toggle` -> Inverse l'Auto-Accept
   - `POST /api/macro/inject-build` -> Force l'injection des runes du champion ciblé
3. **Plugin Stream Deck (JS/C#)** : Ton plugin Ajazz est configuré pour faire un simple "Fetch" via Javascript HTTP.
   ```javascript
   // Pseudo-code Plugin Ajazz Stream Deck
   fetch('http://127.0.0.1:1420/api/macro/auto-accept/toggle', { method: 'POST' })
     .then(res => res.json())
     .then(data => updateButtonStatus(data.auto_accept));
   ```

### Avantages de l'Interfaçage RPC Local
- **Sécurité et Anti-Cheat** : Vu qu'on ne touche pas aux fichiers du jeu, ni à la surcouche en ligne, le risque de ban est quasiment nul. On utilise la même API interne que les logiciels LCU légaux, et le Deck interagit indirectement via Tauri.
- **Réversibilité et Flexibilité** : Pas besoin de coder le système d'authentification ou les tokens Riot dans le plugin Ajazz ! Le backend Tauri s'en charge. Le plugin n'a plus qu'à envoyer des ordres simples.
- **État en Temps Réel** : Un flux WebSocket local (`ws://127.0.0.1:1420/stream`) peut être ajouté pour allumer/éteindre les LEDs de ton StreamDeck en fonction des données de CRIMSON (ex: le bouton "Pick" s'allume en vert vif uniquement quant c'est le moment de jouer en lobby).

### Déploiement Logiciel
Pour intégrer cela à la prochaine phase, CRIMSON exposera un module "Stream Deck Bridge" dans ses préférences, activant ce serveur local !
