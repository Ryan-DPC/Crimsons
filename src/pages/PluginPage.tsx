import { useEffect, useState } from 'react'
import { fetchPluginBySlug } from '../api/catalog'
import { StoreFooter, StoreHeader, PageShell } from '../components/StoreChrome'
import {
  DIRECT_DOWNLOAD_URL,
  HARDWARE_LABEL,
  HARDWARE_ORDER,
  PRICING_LABEL,
  STATUS_LABEL,
  hardwareCompatBlurb,
} from '../lib/labels'
import { navigate } from '../lib/routing'
import type { CatalogPlugin, CatalogResponse } from '../types'

export default function PluginPage({ slug }: { slug: string }) {
  const [plugin, setPlugin] = useState<CatalogPlugin | null>(null)
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let cancelled = false
    setPlugin(null)
    setError(null)
    setNotFound(false)

    fetchPluginBySlug(slug)
      .then((result) => {
        if (cancelled) return
        if (!result) {
          setNotFound(true)
          return
        }
        setPlugin(result.plugin)
        setCatalog(result.catalog)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
    }
  }, [slug])

  const categoryLabel = (catId: string) =>
    catalog?.categories.find((c) => c.id === catId)?.label ?? catId

  const isReady = plugin?.status === 'published'
  const statusClass = plugin ? `badge-status badge-${plugin.status}` : ''

  return (
    <PageShell>
      <header className="hero hero-detail">
        <StoreHeader compact />

        <nav className="breadcrumb" aria-label="Fil d’Ariane">
          <button type="button" className="breadcrumb-link" onClick={() => navigate('/')}>
            ← Catalogue
          </button>
          {plugin && (
            <>
              <span className="breadcrumb-sep" aria-hidden="true">
                /
              </span>
              <span className="breadcrumb-current">{plugin.name}</span>
            </>
          )}
        </nav>
      </header>

      {error && <p className="error">{error}</p>}
      {!plugin && !error && !notFound && (
        <p className="loading-state">Chargement du plugin…</p>
      )}

      {notFound && (
        <div className="detail-missing">
          <h1 className="detail-title">Plugin introuvable</h1>
          <p className="detail-summary">
            Aucun module ne correspond au slug <code>{slug}</code> dans le catalogue.
          </p>
          <button type="button" className="download-btn" onClick={() => navigate('/')}>
            Retour au catalogue
          </button>
        </div>
      )}

      {plugin && (
        <section className="detail">
          <div className="detail-hero">
            <div className="detail-identity">
              {plugin.icon ? (
                <img
                  src={plugin.icon}
                  alt=""
                  className="detail-icon"
                  width={72}
                  height={72}
                />
              ) : (
                <div className="detail-icon detail-icon-placeholder">
                  {plugin.name.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="detail-titles">
                <div className="detail-badges">
                  <span className={statusClass}>{STATUS_LABEL[plugin.status]}</span>
                  <span className="pricing-tag detail-pricing">
                    {PRICING_LABEL[plugin.pricing] ?? plugin.pricing}
                  </span>
                </div>
                <h1 className="detail-title">{plugin.name}</h1>
                <p className="detail-summary">{plugin.summary}</p>
              </div>
            </div>

            <div className="detail-cta">
              {isReady ? (
                <a href={DIRECT_DOWNLOAD_URL} className="download-btn">
                  Installer / Télécharger
                </a>
              ) : (
                <button type="button" className="btn-card-action detail-cta-disabled" disabled>
                  Bientôt disponible
                </button>
              )}
              <p className="detail-cta-hint">
                {isReady
                  ? 'Nécessite Crimsons installé sur Windows.'
                  : 'Ce module sera activable dès sa publication.'}
              </p>
            </div>
          </div>

          <p className="detail-description">{plugin.description}</p>

          <section className="detail-compat" aria-labelledby="compat-heading">
            <h2 id="compat-heading" className="detail-compat-title">
              Compatibilité
            </h2>
            <p className="detail-compat-blurb">{hardwareCompatBlurb(plugin.hardware)}</p>
            <ul className="hw-pills hw-pills-detail" aria-label="Hardware supporté">
              {HARDWARE_ORDER.map((id) => {
                const ok = plugin.hardware[id]
                return (
                  <li
                    key={id}
                    className={ok ? 'hw-pill hw-pill-ok' : 'hw-pill hw-pill-no'}
                  >
                    <span>
                      {HARDWARE_LABEL[id]}
                      {id === 'streamdock' ? ' / Ajazz' : ''}
                    </span>
                    <span aria-hidden="true">{ok ? '✓' : '—'}</span>
                    <span className="hw-pill-state">{ok ? 'Supporté' : 'Pas encore'}</span>
                  </li>
                )
              })}
            </ul>
          </section>

          <dl className="detail-meta">
            <div>
              <dt>Package ID</dt>
              <dd>
                <code>{plugin.packageId}</code>
              </dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>v{plugin.version}</dd>
            </div>
            <div>
              <dt>Catégories</dt>
              <dd>{plugin.categories.map(categoryLabel).join(' · ')}</dd>
            </div>
            <div>
              <dt>Surfaces</dt>
              <dd>{plugin.surfaces.join(' · ')}</dd>
            </div>
            {plugin.targetApp && (
              <div>
                <dt>Cible</dt>
                <dd>{plugin.targetApp}</dd>
              </div>
            )}
            <div>
              <dt>Accès</dt>
              <dd>
                {plugin.requiresPremium ? 'Premium requis' : 'Standard'}
                {plugin.requiresCrimsons ? ' · Crimsons requis' : ''}
              </dd>
            </div>
            <div>
              <dt>Slug</dt>
              <dd>
                <code>{plugin.slug}</code>
              </dd>
            </div>
          </dl>

          <div className="detail-back">
            <button type="button" className="breadcrumb-link" onClick={() => navigate('/')}>
              ← Retour au catalogue
            </button>
          </div>
        </section>
      )}

      <StoreFooter version={catalog?.version} />
    </PageShell>
  )
}
