import { invoke } from '@tauri-apps/api/core';

/**
 * Jeton WS local du sidecar.
 * Tauri lit le fichier AppData ; en navigateur (dev Linux / store) on tombe
 * sur GET /local/ws-token (même chemin que les plugins StreamDock).
 */
export async function getLocalAuthToken(): Promise<string> {
  try {
    const fromTauri = await invoke<string | null>('crimson_get_auth_token');
    if (fromTauri) return fromTauri;
  } catch {
    // Pas de runtime Tauri — fallback HTTP local.
  }

  try {
    const res = await fetch('http://127.0.0.1:40510/local/ws-token', {
      cache: 'no-store',
    });
    if (!res.ok) return '';
    return (await res.text()).trim();
  } catch {
    return '';
  }
}
