import type { ReactNode } from 'react'
import { navigate } from '../lib/routing'

export function StoreHeader({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`hero-topbar${compact ? ' hero-topbar-compact' : ''}`}>
      <button type="button" className="brand-group brand-link" onClick={() => navigate('/')}>
        <img
          className="brand-mark"
          src="/favicon.svg"
          width={28}
          height={28}
          alt=""
          aria-hidden="true"
        />
        <span className="brand">CRIMSONS</span>
        <span className="brand-tag">STORE</span>
      </button>
      <span className="author-badge">Par Chin0Studio</span>
    </div>
  )
}

export function StoreFooter({ version }: { version?: number }) {
  return (
    <footer className="footer">
      <div className="footer-content">
        <div className="footer-brand">
          <strong>CRIMSONS STORE</strong> · Conçu par Chin0Studio
        </div>
        <div className="footer-links">
          <a href="https://github.com/Ryan-DPC/Crimsons/releases/download/v3.1.6/CRIMSONS_3.1.6_x64-setup.exe" className="footer-link">
            Télécharger Crimsons
          </a>
          <span className="footer-sep">·</span>
          <span className="footer-meta">v{version ?? 2}</span>
        </div>
      </div>
    </footer>
  )
}

export function PageShell({ children }: { children: ReactNode }) {
  return <div className="page">{children}</div>
}
