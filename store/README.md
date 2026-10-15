# Crimsons Plugin Store (web)

Catalogue indépendant des plugins Crimsons (StreamDock / jeu / utilitaire / …).

## Lancer

```bash
cd store
npm install
npm run dev   # http://localhost:5174
```

API locale (middleware Vite) :

| Route | Contenu |
| --- | --- |
| `GET /api/catalog` | Catalogue complet |
| `GET /api/plugins` | Liste plugins |
| `GET /api/categories` | Catégories d’usage |

Source de vérité : [`../plugins/catalog/catalog.json`](../plugins/catalog/catalog.json).  
Schéma Supabase : [`../supabase/migrations/20261015060000_plugin_catalog.sql`](../supabase/migrations/20261015060000_plugin_catalog.sql).

Avec `VITE_SUPABASE_*` (voir `.env.example`), le client lit `plugin_catalog` / `plugin_categories` en priorité.
