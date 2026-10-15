import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'

const catalogPath = path.resolve(import.meta.dirname, '../plugins/catalog/catalog.json')
const publicCatalogPath = path.resolve(import.meta.dirname, 'public/catalog.json')

function syncPublicCatalog() {
  fs.mkdirSync(path.dirname(publicCatalogPath), { recursive: true })
  fs.copyFileSync(catalogPath, publicCatalogPath)
}

function readCatalogJson(): string {
  syncPublicCatalog()
  return fs.readFileSync(catalogPath, 'utf8')
}

/** Local API + keep public/catalog.json in sync with the repo catalogue. */
function catalogApiPlugin(): Plugin {
  return {
    name: 'crimsons-catalog-api',
    buildStart() {
      syncPublicCatalog()
    },
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url?.split('?')[0]
        if (url === '/api/plugins' || url === '/api/categories' || url === '/api/catalog') {
          try {
            const catalog = JSON.parse(readCatalogJson()) as {
              categories: unknown[]
              plugins: unknown[]
            }
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.setHeader('Cache-Control', 'no-store')
            if (url === '/api/categories') {
              res.end(JSON.stringify({ categories: catalog.categories }))
              return
            }
            if (url === '/api/plugins') {
              res.end(JSON.stringify({ plugins: catalog.plugins }))
              return
            }
            res.end(JSON.stringify(catalog))
          } catch (err) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: String(err) }))
          }
          return
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), catalogApiPlugin()],
  server: {
    port: 5174,
    strictPort: true,
  },
})
