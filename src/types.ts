export type PluginStatus = 'published' | 'coming_soon' | 'deprecated'
export type PluginPricing = 'free' | 'premium' | 'paid' | 'tbd'

/** Known hardware families. Ajazz decks are aliased under streamdock. */
export type HardwareId = 'streamdock' | 'elgato'

export interface PluginHardware {
  streamdock: boolean
  elgato: boolean
}

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
  /** Deck compatibility. Defaults to StreamDock-only when omitted. */
  hardware: PluginHardware
  requiresPremium: boolean
  requiresCrimsons: boolean
  icon?: string | null
  targetApp?: string
}

export interface CatalogResponse {
  version: number
  updatedAt: string
  categories: PluginCategory[]
  plugins: CatalogPlugin[]
  source: 'api' | 'supabase' | 'static'
}
