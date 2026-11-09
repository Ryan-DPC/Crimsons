import { useEffect, useState, useTransition } from 'react'
import { fetchCatalog } from './api/catalog'
import type { CatalogPlugin, CatalogResponse } from './types'

const PRICING_LABEL: Record<string, string> = {
  free: 'Gratuit',
  premium: 'Premium',
  paid: 'Payant',
  tbd: 'Tarif à définir',
}

const STATUS_LABEL: Record<string, string> = {
  published: 'Disponible',
  coming_soon: 'Bientôt',
  deprecated: 'Déprécié',
}

export default function App() {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [category, setCategory] = useState('all')
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    let cancelled = false
    fetchCatalog()
      .then((data) => {
        if (!cancelled) setCatalog(data)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const categoryLabel = (id: string) =>
    catalog?.categories.find((c) => c.id === id)?.label ?? id

  const plugins: CatalogPlugin[] =
    !catalog
      ? []
      : category === 'all'
        ? catalog.plugins
        : catalog.plugins.filter((p) => p.categories.includes(category))

  return (
    <div className="page">
      <header className="hero">
        <p className="brand">CRIMSONS</p>
        <h1>Catalogue plugins</h1>
        <p className="lede">
          Tous les packs StreamDock, jeu et utilitaires — hors de l’app Crimsons. Installez ce dont vous avez besoin.
        </p>
        {catalog && (
          <p className="meta">
            Source : {catalog.source} · maj {catalog.updatedAt}
            {pending ? ' · filtrage…' : ''}
          </p>
        )}
      </header>

      {error && <p className="error">{error}</p>}
      {!catalog && !error && <p className="meta">Chargement du catalogue…</p>}

      {catalog && (
        <>
          <nav className="filters" aria-label="Catégories">
            <button
              type="button"
              className={category === 'all' ? 'active' : ''}
              onClick={() => startTransition(() => setCategory('all'))}
            >
              Tous
            </button>
            {catalog.categories.map((c) => (
              <button
                key={c.id}
                type="button"
                title={c.description}
                className={category === c.id ? 'active' : ''}
                onClick={() => startTransition(() => setCategory(c.id))}
              >
                {c.label}
              </button>
            ))}
          </nav>

          <section className="list" aria-live="polite">
            {plugins.length === 0 && <p className="meta">Aucun plugin dans cette catégorie.</p>}
            {plugins.map((plugin) => (
              <article key={plugin.id} className="plugin">
                <div className="plugin-top">
                  <h2>{plugin.name}</h2>
                  <span className={`pill status-${plugin.status}`}>{STATUS_LABEL[plugin.status]}</span>
                </div>
                <p className="summary">{plugin.summary}</p>
                <dl className="facts">
                  <div>
                    <dt>Utilisation</dt>
                    <dd>{plugin.categories.map(categoryLabel).join(' · ')}</dd>
                  </div>
                  <div>
                    <dt>Surfaces</dt>
                    <dd>{plugin.surfaces.join(' · ')}</dd>
                  </div>
                  <div>
                    <dt>Tarif</dt>
                    <dd>{PRICING_LABEL[plugin.pricing] ?? plugin.pricing}</dd>
                  </div>
                  <div>
                    <dt>Package</dt>
                    <dd>
                      <code>{plugin.packageId}</code> · v{plugin.version}
                    </dd>
                  </div>
                </dl>
                <p className="desc">{plugin.description}</p>
              </article>
            ))}
          </section>
        </>
      )}

      <footer className="footer">
        API locale : <code>/api/catalog</code>, <code>/api/plugins</code>, <code>/api/categories</code>
        {' · '}
        Schéma Supabase : <code>plugin_catalog</code> / <code>plugin_categories</code>
      </footer>
    </div>
  )
}
