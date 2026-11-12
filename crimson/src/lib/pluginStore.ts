/**
 * Base URL for the Crimsons plugin Store.
 * Prod: https://store.hoopslive.ch — Vite/Tauri DEV: local store (port 5174).
 */
export const PLUGIN_STORE_BASE_URL: string =
  (import.meta.env.VITE_PLUGIN_STORE_URL as string | undefined)?.replace(/\/$/, '') ||
  (import.meta.env.DEV ? 'http://localhost:5174' : 'https://store.hoopslive.ch');

/** Deep link to a dedicated plugin page on the Store (`/plugins/:slug`). */
export function pluginStoreUrl(slug: string): string {
  const clean = slug.replace(/^\/+|\/+$/g, '');
  return `${PLUGIN_STORE_BASE_URL}/plugins/${encodeURIComponent(clean)}`;
}
