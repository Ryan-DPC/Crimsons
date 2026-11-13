import type { LucideIcon } from 'lucide-react';
import {
  Crosshair,
  Disc3,
  Clapperboard,
  Gamepad2,
  Home,
  Lightbulb,
  Music,
  Tv,
  Volume2,
} from 'lucide-react';

/** Hub surface views (plugin pages + home). Settings/debug stay outside this set. */
export type HubView =
  | 'home'
  | 'lol'
  | 'valorant'
  | 'spotify'
  | 'apple_music'
  | 'volume'
  | 'hue'
  | 'twitch'
  | 'obs';

export const HUB_VIEWS: HubView[] = [
  'home',
  'lol',
  'valorant',
  'spotify',
  'apple_music',
  'volume',
  'hue',
  'twitch',
  'obs',
];

export type HubNavItem = {
  id: HubView;
  label: string;
  /** Plugin key in appData.plugins — null = always available (Home). */
  pluginKey: string | null;
  /** Premium entitlement required to show when plugin is on. */
  premium: boolean;
  icon: LucideIcon;
  group: 'home' | 'games' | 'audio' | 'utilities';
};

export const HUB_NAV_ITEMS: HubNavItem[] = [
  { id: 'home', label: 'Accueil', pluginKey: null, premium: false, icon: Home, group: 'home' },
  { id: 'lol', label: 'LoL', pluginKey: 'leagueOfLegends', premium: false, icon: Gamepad2, group: 'games' },
  { id: 'valorant', label: 'Valorant', pluginKey: 'valorant', premium: true, icon: Crosshair, group: 'games' },
  { id: 'spotify', label: 'Spotify', pluginKey: 'spotify', premium: true, icon: Disc3, group: 'audio' },
  { id: 'apple_music', label: 'Apple Music', pluginKey: 'apple_music', premium: true, icon: Music, group: 'audio' },
  { id: 'volume', label: 'Volume', pluginKey: 'volume', premium: true, icon: Volume2, group: 'audio' },
  { id: 'hue', label: 'Hue', pluginKey: 'hue', premium: true, icon: Lightbulb, group: 'utilities' },
  { id: 'twitch', label: 'Twitch', pluginKey: 'twitch', premium: true, icon: Tv, group: 'utilities' },
  { id: 'obs', label: 'OBS', pluginKey: 'obs', premium: true, icon: Clapperboard, group: 'utilities' },
];

export type PluginFlags = Record<string, boolean | undefined> | undefined | null;

/** True when the plugin toggle is on (and premium when required). */
export function isHubPluginEnabled(
  item: HubNavItem,
  plugins: PluginFlags,
  isPremium: boolean,
): boolean {
  if (!item.pluginKey) return true;
  if (item.premium && !isPremium) return false;
  if (item.pluginKey === 'apple_music') {
    return !!(plugins?.apple_music ?? plugins?.appleMusic);
  }
  return !!plugins?.[item.pluginKey];
}

/** Nav entries visible for the current entitlement + plugin toggles. */
export function getVisibleHubNav(
  plugins: PluginFlags,
  isPremium: boolean,
): HubNavItem[] {
  return HUB_NAV_ITEMS.filter((item) => isHubPluginEnabled(item, plugins, isPremium));
}

export function isHubView(value: string): value is HubView {
  return (HUB_VIEWS as string[]).includes(value);
}

/** Map legacy LoL tabs onto the dedicated LoL page. */
export function normalizeHubView(tab: string): string {
  if (tab === 'league' || tab === 'lobby' || tab === 'history' || tab === 'hist') {
    return 'lol';
  }
  return tab;
}
