import type { HardwareId, PluginHardware, PluginPricing, PluginStatus } from '../types'

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

/** Display order for hardware pills / lines. */
export const HARDWARE_ORDER: HardwareId[] = ['streamdock', 'elgato']

export const HARDWARE_LABEL: Record<HardwareId, string> = {
  streamdock: 'StreamDock',
  elgato: 'Elgato',
}

/** Short card line, e.g. "StreamDock ✓ · Elgato —" */
export function hardwareCompactLine(hardware: PluginHardware): string {
  return HARDWARE_ORDER.map((id) => {
    const mark = hardware[id] ? '✓' : '—'
    return `${HARDWARE_LABEL[id]} ${mark}`
  }).join(' · ')
}

/** Calm FR blurb for the plugin detail page. */
export function hardwareCompatBlurb(hardware: PluginHardware): string {
  if (hardware.streamdock && !hardware.elgato) {
    return 'Compatible StreamDock (Ajazz, etc.). Elgato Stream Deck : pas encore.'
  }
  if (hardware.streamdock && hardware.elgato) {
    return 'Compatible StreamDock (Ajazz, etc.) et Elgato Stream Deck.'
  }
  if (!hardware.streamdock && hardware.elgato) {
    return 'Compatible Elgato Stream Deck. StreamDock : pas encore.'
  }
  return 'Compatibilité hardware non annoncée pour l’instant.'
}

export const DEFAULT_HARDWARE: PluginHardware = {
  streamdock: true,
  elgato: false,
}

export const DIRECT_DOWNLOAD_URL =
  'https://github.com/Ryan-DPC/Crimsons/releases/download/v3.1.6/CRIMSONS_3.1.6_x64-setup.exe'
