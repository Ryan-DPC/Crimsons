# Crimsons Store (Web & API)

Catalogue autonome des plugins Crimsons (StreamDock, League of Legends, Spotify, Apple Music, Discord, Hue, Twitch).

## Structure
- `src/` : Application React 19 + Tailwind CSS v4.
- `data/catalog.json` : Source locale des plugins et catégories.
- `public/` : Assets statiques et manifest.
- `server.js` : Serveur de production Node.js (sert la SPA et l'API).

## API Endpoints
| Méthode | Route | Description |
| --- | --- | --- |
| `GET` | `/api/catalog` | Catalogue complet (catégories + plugins) |
| `GET` | `/api/plugins` | Liste des plugins |
| `GET` | `/api/categories` | Catégories d'usage |
| `GET` | `/api/health` | Vérification de santé du service |

## Développement local
```bash
npm install
npm run dev
```

## Production / Docker
```bash
docker compose up -d --build
```
Le service s'exécute sur le port interne `3000` (exposé localement sur `127.0.0.1:5174`).
