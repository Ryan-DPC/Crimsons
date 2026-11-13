import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'

const repoCatalogPath = path.resolve(import.meta.dirname, '../plugins/catalog/catalog.json')
const publicCatalogPath = path.resolve(import.meta.dirname, 'public/catalog.json')

function resolveCatalogPath(): string {
  if (fs.existsSync(repoCatalogPath)) return repoCatalogPath
  return publicCatalogPath
}

function syncPublicCatalog() {
  const src = resolveCatalogPath()
  if (src === publicCatalogPath || !fs.existsSync(src)) return
  fs.mkdirSync(path.dirname(publicCatalogPath), { recursive: true })
  fs.copyFileSync(src, publicCatalogPath)
}

function readCatalogJson(): string {
  syncPublicCatalog()
  return fs.readFileSync(resolveCatalogPath(), 'utf8')
}

const DEV_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
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
        for (const [k, v] of Object.entries(DEV_SECURITY_HEADERS)) {
          res.setHeader(k, v)
        }
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
          } catch {
            res.statusCode = 500
            res.end(JSON.stringify({ error: 'catalog_unavailable' }))
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
