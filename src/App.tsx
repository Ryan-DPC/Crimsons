import CatalogPage from './pages/CatalogPage'
import PluginPage from './pages/PluginPage'
import { matchPluginPath, usePathname, useScrollToTop } from './lib/routing'

export default function App() {
  const pathname = usePathname()
  useScrollToTop(pathname)
  const slug = matchPluginPath(pathname)

  if (slug) {
    return <PluginPage slug={slug} />
  }

  return <CatalogPage />
}
