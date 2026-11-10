import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export type PluginKey = 'leagueOfLegends' | 'spotify' | 'discord';

const CATALOG: { key: PluginKey; id: string }[] = [
  { key: 'leagueOfLegends', id: 'com.laoy.streamdock.crimson' },
  { key: 'spotify', id: 'com.laoy.streamdock.spotify' },
  { key: 'discord', id: 'com.laoy.streamdock.discord' },
];

export type PluginPresence = Record<PluginKey, boolean>;

const EMPTY: PluginPresence = {
  leagueOfLegends: false,
  spotify: false,
  discord: false,
};

/** True only when the StreamDock pack is actually installed (not Hub toggles). */
export function usePluginPresence() {
  const [installed, setInstalled] = useState<PluginPresence>(EMPTY);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: PluginPresence = { ...EMPTY };
      for (const plugin of CATALOG) {
        try {
          next[plugin.key] = await invoke<boolean>('check_plugin_presence', {
            pluginId: plugin.id,
          });
        } catch {
          next[plugin.key] = false;
        }
      }
      if (!cancelled) {
        setInstalled(next);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { installed, ready };
}
