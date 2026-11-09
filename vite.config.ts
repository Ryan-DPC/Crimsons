import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'

const dataCatalogPath = path.resolve(import.meta.dirname, 'data/catalog.json')
const publicCatalogPath = path.resolve(import.meta.dirname, 'public/catalog.json')

function syncPublicCatalog() {
  if (fs.existsSync(dataCatalogPath)) {
    fs.mkdirSync(path.dirname(publicCatalogPath), { recursive: true })
    fs.copyFileSync(dataCatalogPath, publicCatalogPath)
  }
}

function readCatalogJson(): string {
  if (fs.existsSync(dataCatalogPath)) {
    syncPublicCatalog()
    return fs.readFileSync(dataCatalogPath, 'utf8')
  }
  return fs.readFileSync(publicCatalogPath, 'utf8')
}

/** Local API + keep public/catalog.json in sync with data/catalog.json. */
function catalogApiPlugin(): Plugin {
  return {
    name: 'crimsons-catalog-api',
    buildStart() {
      syncPublicCatalog()
    },
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url?.split('?')[0]
        if (url === '/api/plugins' || url === '/api/categories' || url === '/api/catalog' || url === '/api/health') {
          try {
            if (url === '/api/health') {
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.end(JSON.stringify({ status: 'ok', service: 'crimsons-store' }))
              return
            }
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
