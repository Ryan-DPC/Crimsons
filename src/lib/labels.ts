import type { PluginPricing, PluginStatus } from '../types'

export const STATUS_LABEL: Record<PluginStatus, string> = {
  published: 'Disponible',
  coming_soon: 'Bientôt',
  deprecated: 'Déprécié',
}

export const PRICING_LABEL: Record<PluginPricing, string> = {
  free: 'Gratuit',
  premium: 'Premium',
  paid: 'Payant',
  tbd: 'Tarif à définir',
}

export const DIRECT_DOWNLOAD_URL =
  'https://github.com/Ryan-DPC/Crimsons/releases/download/v3.1.6/CRIMSONS_3.1.6_x64-setup.exe'
