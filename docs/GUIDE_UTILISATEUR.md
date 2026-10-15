# Guide utilisateur Crimsons

Parcours type : installer → se connecter → LoL automatique → Spotify une fois → Discord une fois (Premium).

## Compte

- Créer un compte ou se connecter : **Premium n’est pas requis** pour entrer dans l’app.
- **Gratuit :** League of Legends (auto-accept, pick/ban, draft) dès que le client LoL est ouvert.
- **Premium :** Spotify + Discord (app + StreamDock).
- Après un achat Premium : **Paramètres → Compte → Actualiser** — pas de réinstallation.

## League of Legends (automatique)

1. Lancer Crimsons et se connecter.
2. Ouvrir le client League of Legends.
3. Aucune association manuelle : Crimsons détecte le client tout seul.

## Spotify (une seule fois)

1. Aller sur [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) et créer une application.
2. Dans l’app Spotify, ajouter l’URL de redirection exacte :

   `http://127.0.0.1:40510/callback`

3. Copier le **Client ID** et le **Client Secret**.
4. Dans Crimsons : tutoriel de bienvenue **ou** Paramètres → App → Spotify.
5. Coller les identifiants → **Sauver** → **Associer Spotify** → autoriser dans le navigateur.
6. Avec Premium : dans **Crimsons** → Paramètres → Plugins → activer Spotify, puis utiliser les touches StreamDock Spotify.

Les identifiants restent sur votre PC (`%APPDATA%\com.laoy.crimsons\`).

## Discord (une seule fois, Premium)

Tout se fait dans **Crimsons** + l’app Discord ouverte. Il n’y a **pas** de menu « Plugin » à chercher dans les réglages Discord.

1. Avoir un compte Premium (sinon le bascule reste verrouillé dans Crimsons).
2. Ouvre l’**app Discord** sur le PC (pas besoin de menu Plugin dans Discord).
3. **Dans Crimsons** : Paramètres → Plugins → activer **Discord**.
4. Mute / deafen / caméra fonctionnent via Discord IPC — **pas d’OAuth** ni de Client ID à coller.
5. (Optionnel) Installer le plugin **StreamDock** Discord depuis le catalogue, puis **redémarrer Stream Dock**.

## StreamDock

Crimsons ne livre **aucun** plugin. Catalogue : `plugins/catalog/` + store web (`store/`). Dev inject explicite :

```powershell
.\scripts\inject_plugins.ps1 -Plugins com.laoy.streamdock.crimson.sdPlugin,com.laoy.streamdock.spotify.sdPlugin
.\scripts\inject_plugins.ps1 -Plugins com.laoy.streamdock.discord.sdPlugin
```

Puis redémarrer Stream Dock. Les plugins récupèrent un jeton frais via `http://127.0.0.1:40510/local/ws-token` après un redémarrage du serveur Crimsons.
