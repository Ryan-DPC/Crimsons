import { useEffect, useState, useTransition } from 'react'
import { fetchCatalog } from './api/catalog'
import type { CatalogPlugin, CatalogResponse } from './types'

const DIRECT_DOWNLOAD_URL = 'https://github.com/Ryan-DPC/Crimsons/releases/download/v3.1.6/CRIMSONS_3.1.6_x64-setup.exe'

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

  const plugins: CatalogPlugin[] =
    !catalog
      ? []
      : category === 'all'
        ? catalog.plugins
        : catalog.plugins.filter((p) => p.categories.includes(category))

  const countForCategory = (catId: string) => {
    if (!catalog) return 0
    if (catId === 'all') return catalog.plugins.length
    return catalog.plugins.filter((p) => p.categories.includes(catId)).length
  }

  const categoryLabel = (catId: string) => {
    return catalog?.categories.find((c) => c.id === catId)?.label ?? catId
  }

  return (
    <div className="page">
      {/* HEADER / HERO */}
      <header className="hero">
        <div className="hero-topbar">
          <div className="brand-group">
            <span className="brand-dot"></span>
            <span className="brand">CRIMSONS</span>
            <span className="brand-tag">STORE</span>
          </div>
          <span className="author-badge">Par Chin0Studio</span>
        </div>

        <h1 className="hero-title">Extensions & Intégrations</h1>
        <p className="hero-subtitle">
          Le catalogue officiel des modules et packs Stream Deck. Découvrez, personnalisez et ajoutez vos
          fonctionnalités favorites directement pour l’application Crimsons.
        </p>

        {/* DIRECT DOWNLOAD CARD */}
        <div className="download-card">
          <div className="download-left">
            <div className="windows-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.949-1.801"/>
              </svg>
            </div>
            <div className="download-info">
              <div className="download-title">Télécharger Crimsons pour Windows</div>
              <div className="download-specs">
                Version 3.1.6 · Windows 10/11 (64-bit) · Installateur officiel
              </div>
            </div>
          </div>
          <a
            href={DIRECT_DOWNLOAD_URL}
            className="download-btn"
            title="Télécharger directement l'installateur Crimsons (.exe)"
          >
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 3v10m0 0l-4-4m4 4l4-4M3 17h14"/>
            </svg>
            <span>Télécharger (.exe)</span>
          </a>
        </div>
      </header>

      {error && <p className="error">{error}</p>}
      {!catalog && !error && <p className="loading-state">Chargement du catalogue…</p>}

      {catalog && (
        <>
          {/* CATEGORY FILTERS */}
          <div className="filters-container">
            <nav className="filters" aria-label="Catégories">
              <button
                type="button"
                className={category === 'all' ? 'active' : ''}
                onClick={() => startTransition(() => setCategory('all'))}
              >
                <span>Tous</span>
                <span className="count-pill">{countForCategory('all')}</span>
              </button>
              {catalog.categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  title={c.description}
                  className={category === c.id ? 'active' : ''}
                  onClick={() => startTransition(() => setCategory(c.id))}
                >
                  <span>{c.label}</span>
                  <span className="count-pill">{countForCategory(c.id)}</span>
                </button>
              ))}
            </nav>
            {pending && <span className="pending-indicator">Mise à jour…</span>}
          </div>

          {/* PLUGINS GRID */}
          <section className="plugin-grid" aria-live="polite">
            {plugins.length === 0 && (
              <p className="empty-state">Aucun plugin trouvé dans cette catégorie.</p>
            )}
            {plugins.map((plugin) => (
              <article key={plugin.id} className="plugin-card">
                <div className="card-header">
                  <div className="card-identity">
                    {plugin.icon ? (
                      <img
                        src={plugin.icon}
                        alt={`${plugin.name} logo`}
                        className="plugin-icon"
                        width="44"
                        height="44"
                        loading="lazy"
                      />
                    ) : (
                      <div className="plugin-icon-placeholder">
                        {plugin.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="plugin-titles">
                      <h2>{plugin.name}</h2>
                      <span className="plugin-compat-badge">
                        {categoryLabel(plugin.categories[1] || plugin.categories[0])} · Stream Deck
                      </span>
                    </div>
                  </div>
                  <div className="card-badges">
                    <span className="badge-coming-soon">Bientôt</span>
                  </div>
                </div>

                <div className="card-body">
                  <p className="plugin-description">{plugin.description}</p>
                </div>

                <div className="card-footer">
                  <span className="pricing-tag">Tarif à définir</span>
                  <button type="button" className="btn-card-action" disabled>
                    Bientôt disponible
                  </button>
                </div>
              </article>
            ))}
          </section>
        </>
      )}

      {/* FOOTER */}
      <footer className="footer">
        <div className="footer-content">
          <div className="footer-brand">
            <strong>CRIMSONS STORE</strong> · Conçu par Chin0Studio
          </div>
          <div className="footer-links">
            <a href={DIRECT_DOWNLOAD_URL} className="footer-link">
              Télécharger Crimsons
            </a>
            <span className="footer-sep">·</span>
            <span className="footer-meta">v{catalog?.version ?? 2}</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
