export type PluginStatus = 'published' | 'coming_soon' | 'deprecated'
export type PluginPricing = 'free' | 'premium' | 'paid' | 'tbd'

export interface PluginCategory {
  id: string
  label: string
  description: string
}

export interface CatalogPlugin {
  id: string
  slug: string
  name: string
  summary: string
  description: string
  packageId: string
  packagePath?: string
  version: string
  status: PluginStatus
  pricing: PluginPricing
  categories: string[]
  surfaces: string[]
  requiresPremium: boolean
  requiresCrimsons: boolean
  icon?: string | null
}

export interface CatalogResponse {
  version: number
  updatedAt: string
  categories: PluginCategory[]
  plugins: CatalogPlugin[]
  source: 'api' | 'supabase' | 'static'
}
