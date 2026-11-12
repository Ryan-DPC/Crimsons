import { createClient } from '@supabase/supabase-js'
import { DEFAULT_HARDWARE } from '../lib/labels'
import type {
  CatalogPlugin,
  CatalogResponse,
  PluginCategory,
  PluginHardware,
  PluginPricing,
  PluginStatus,
} from '../types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

function normalizeHardware(raw: unknown, surfaces?: string[]): PluginHardware {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>
    return {
      streamdock: Boolean(obj.streamdock ?? obj.ajazz ?? DEFAULT_HARDWARE.streamdock),
      elgato: Boolean(obj.elgato ?? false),
    }
  }
  if (Array.isArray(raw)) {
    const ids = raw.map((v) => String(v).toLowerCase())
    return {
      streamdock: ids.some((id) => id === 'streamdock' || id === 'ajazz'),
      elgato: ids.includes('elgato'),
    }
  }
  // Legacy rows: surfaces often list "streamdock".
  if (surfaces?.some((s) => s.toLowerCase() === 'streamdock')) {
    return { ...DEFAULT_HARDWARE }
  }
  return { ...DEFAULT_HARDWARE }
}

function mapRow(row: Record<string, unknown>): CatalogPlugin {
  const surfaces = (row.surfaces as string[]) ?? []
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
    surfaces,
    hardware: normalizeHardware(row.hardware ?? row.compatibility, surfaces),
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
    plugins: pluginsRaw.map((row) => {
      if ('package_id' in row || 'requires_premium' in row) return mapRow(row)
      const surfaces = (row.surfaces as string[]) ?? []
      return {
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
        surfaces,
        hardware: normalizeHardware(row.hardware ?? row.compatibility, surfaces),
        requiresPremium: Boolean(row.requiresPremium),
        requiresCrimsons: Boolean(row.requiresCrimsons ?? true),
        icon: (row.icon as string | null | undefined) ?? null,
        targetApp: row.targetApp ? String(row.targetApp) : undefined,
      }
    }),
    source,
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function fromSupabase(): Promise<CatalogResponse | null> {
  if (!supabaseUrl || !supabaseAnonKey) return null
  const supabase = createClient(supabaseUrl, supabaseAnonKey)
  const query = Promise.all([
    supabase.from('plugin_categories').select('id,label,description').order('id'),
    supabase
      .from('plugin_catalog')
      .select(
        'id,slug,name,summary,description,package_id,version,status,pricing,categories,surfaces,requires_premium,requires_crimsons,icon_url,sort_order',
      )
      .order('sort_order'),
  ]).then(([cats, plugs]) => {
    if (cats.error || plugs.error) {
      console.warn('[catalog] Supabase unavailable', cats.error ?? plugs.error)
      return null
    }
    return {
      version: 1,
      updatedAt: new Date().toISOString().slice(0, 10),
      categories: (cats.data ?? []) as PluginCategory[],
      plugins: (plugs.data ?? []).map((row) => mapRow(row as Record<string, unknown>)),
      source: 'supabase' as const,
    }
  })

  // Projet pause / réseau lent : ne bloque pas le store local.
  return withTimeout(query, 2000)
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

/**
 * Liste catalogue.
 * En dev : API Vite d’abord (source de vérité repo), puis Supabase, puis /catalog.json.
 * En prod : Supabase d’abord, puis /catalog.json embarqué.
 */
export async function fetchCatalog(): Promise<CatalogResponse> {
  if (import.meta.env.DEV) {
    const local = await fromUrl('/api/catalog', 'api')
    if (local) return local
  }

  const remote = await fromSupabase()
  if (remote) return remote

  if (!import.meta.env.DEV) {
    const local = await fromUrl('/api/catalog', 'api')
    if (local) return local
  }

  const file = await fromUrl('/catalog.json', 'static')
  if (file) return file
  throw new Error('Catalogue introuvable (API, Supabase et /catalog.json).')
}

export async function listPlugins(categoryId?: string): Promise<CatalogPlugin[]> {
  const catalog = await fetchCatalog()
  if (!categoryId || categoryId === 'all') return catalog.plugins
  return catalog.plugins.filter((p) => p.categories.includes(categoryId))
}

/** Resolve a plugin by URL slug (or id fallback). Returns null if missing. */
export async function fetchPluginBySlug(
  slug: string,
): Promise<{ plugin: CatalogPlugin; catalog: CatalogResponse } | null> {
  const catalog = await fetchCatalog()
  const key = slug.trim().toLowerCase()
  const plugin =
    catalog.plugins.find((p) => p.slug.toLowerCase() === key) ??
    catalog.plugins.find((p) => p.id.toLowerCase() === key) ??
    null
  if (!plugin) return null
  return { plugin, catalog }
}
