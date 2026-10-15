import { createClient } from '@supabase/supabase-js'
import type { CatalogPlugin, CatalogResponse, PluginCategory, PluginPricing, PluginStatus } from '../types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

function mapRow(row: Record<string, unknown>): CatalogPlugin {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    summary: String(row.summary ?? ''),
    description: String(row.description ?? ''),
    packageId: String(row.package_id ?? row.packageId ?? ''),
    version: String(row.version ?? '0.0.0'),
    status: (row.status as PluginStatus) ?? 'coming_soon',
    pricing: (row.pricing as PluginPricing) ?? 'tbd',
    categories: (row.categories as string[]) ?? [],
    surfaces: (row.surfaces as string[]) ?? [],
    requiresPremium: Boolean(row.requires_premium ?? row.requiresPremium),
    requiresCrimsons: Boolean(row.requires_crimsons ?? row.requiresCrimsons ?? true),
    icon: (row.icon_url as string | null | undefined) ?? (row.icon as string | null | undefined) ?? null,
  }
}

function normalizeCatalog(data: Record<string, unknown>, source: CatalogResponse['source']): CatalogResponse {
  const pluginsRaw = (data.plugins as Record<string, unknown>[] | undefined) ?? []
  return {
    version: Number(data.version ?? 1),
    updatedAt: String(data.updatedAt ?? data.updated_at ?? ''),
    categories: (data.categories as PluginCategory[]) ?? [],
    plugins: pluginsRaw.map((row) =>
      'package_id' in row || 'requires_premium' in row
        ? mapRow(row)
        : {
            id: String(row.id),
            slug: String(row.slug),
            name: String(row.name),
            summary: String(row.summary ?? ''),
            description: String(row.description ?? ''),
            packageId: String(row.packageId ?? ''),
            packagePath: row.packagePath ? String(row.packagePath) : undefined,
            version: String(row.version ?? '0.0.0'),
            status: (row.status as PluginStatus) ?? 'coming_soon',
            pricing: (row.pricing as PluginPricing) ?? 'tbd',
            categories: (row.categories as string[]) ?? [],
            surfaces: (row.surfaces as string[]) ?? [],
            requiresPremium: Boolean(row.requiresPremium),
            requiresCrimsons: Boolean(row.requiresCrimsons ?? true),
            icon: (row.icon as string | null | undefined) ?? null,
          },
    ),
    source,
  }
}

async function fromSupabase(): Promise<CatalogResponse | null> {
  if (!supabaseUrl || !supabaseAnonKey) return null
  const supabase = createClient(supabaseUrl, supabaseAnonKey)
  const [cats, plugs] = await Promise.all([
    supabase.from('plugin_categories').select('id,label,description').order('id'),
    supabase
      .from('plugin_catalog')
      .select(
        'id,slug,name,summary,description,package_id,version,status,pricing,categories,surfaces,requires_premium,requires_crimsons,icon_url,sort_order',
      )
      .order('sort_order'),
  ])
  if (cats.error || plugs.error) {
    console.warn('[catalog] Supabase unavailable', cats.error ?? plugs.error)
    return null
  }
  return {
    version: 1,
    updatedAt: new Date().toISOString().slice(0, 10),
    categories: (cats.data ?? []) as PluginCategory[],
    plugins: (plugs.data ?? []).map((row) => mapRow(row as Record<string, unknown>)),
    source: 'supabase',
  }
}

async function fromUrl(url: string, source: CatalogResponse['source']): Promise<CatalogResponse | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data = (await res.json()) as Record<string, unknown>
    return normalizeCatalog(data, source)
  } catch {
    return null
  }
}

/** Liste catalogue : Supabase → API locale Vite → /catalog.json public. */
export async function fetchCatalog(): Promise<CatalogResponse> {
  const remote = await fromSupabase()
  if (remote) return remote
  const local = await fromUrl('/api/catalog', 'api')
  if (local) return local
  const file = await fromUrl('/catalog.json', 'static')
  if (file) return file
  throw new Error('Catalogue introuvable (API, Supabase et /catalog.json).')
}

export async function listPlugins(categoryId?: string): Promise<CatalogPlugin[]> {
  const catalog = await fetchCatalog()
  if (!categoryId || categoryId === 'all') return catalog.plugins
  return catalog.plugins.filter((p) => p.categories.includes(categoryId))
}
