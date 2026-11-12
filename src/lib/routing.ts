import { useEffect, useState, useSyncExternalStore } from 'react'

/** Match `/plugins/:slug` or legacy `/p/:slug`. */
export function matchPluginPath(pathname: string): string | null {
  const match = pathname.match(/^\/(?:plugins|p)\/([^/]+)\/?$/)
  return match ? decodeURIComponent(match[1]) : null
}

export function pluginPath(slug: string): string {
  return `/plugins/${encodeURIComponent(slug)}`
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener('popstate', onStoreChange)
  return () => window.removeEventListener('popstate', onStoreChange)
}

function getPathname() {
  return window.location.pathname
}

/** Current pathname, updates on popstate / programmatic navigate. */
export function usePathname(): string {
  return useSyncExternalStore(subscribe, getPathname, () => '/')
}

export function navigate(to: string, { replace = false }: { replace?: boolean } = {}) {
  if (replace) {
    window.history.replaceState(null, '', to)
  } else {
    window.history.pushState(null, '', to)
  }
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/** Scroll to top when the path changes. */
export function useScrollToTop(pathname: string) {
  const [last, setLast] = useState(pathname)
  useEffect(() => {
    if (pathname !== last) {
      window.scrollTo(0, 0)
      setLast(pathname)
    }
  }, [pathname, last])
}
