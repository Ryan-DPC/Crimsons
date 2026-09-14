import { createClient, type SupportedStorage } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

/** False si la build a été produite sans secrets Vite (écran noir / Failed to fetch). */
export function isSupabaseConfigured(): boolean {
    return Boolean(supabaseUrl && supabaseAnonKey && /^https?:\/\//i.test(supabaseUrl));
}

const memory = new Map<string, string>();

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<null>((resolve) => {
                timer = setTimeout(() => resolve(null), ms);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function isTauriRuntime(): boolean {
    return typeof window !== 'undefined' && !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

async function readSharedSession(): Promise<string | null> {
    if (!isTauriRuntime()) return null;
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await withTimeout(invoke<string | null>('crimson_read_supabase_session'), 1500);
    } catch {
        return null;
    }
}

async function writeSharedSession(value: string): Promise<void> {
    if (!isTauriRuntime()) return;
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        await withTimeout(invoke('crimson_write_supabase_session', { json: value }), 1500);
    } catch {
        /* sidecar absent */
    }
}

/**
 * Stockage partage UI + sidecar. localStorage de la webview Tauri se perd
 * parfois (maj, origine dev vs prod) ; le sidecar, lui, fait tourner le
 * refresh token tout seul. Si supabase-js n'en a pas connaissance, GoTrue
 * considere un rejeu et deconnecte l'utilisateur.
 *
 * removeItem ne touche PAS le fichier sidecar : supabase-js vide le stockage
 * apres un refresh rate, exactement le moment ou le sidecar detient encore
 * les jetons valides. La deconnexion explicite passe par AUTH_LOGOUT.
 */
const crimsonAuthStorage: SupportedStorage = {
    getItem: async (key: string) => {
        const shared = await readSharedSession();
        if (shared) {
            memory.set(key, shared);
            try { localStorage.setItem(key, shared); } catch { /* ignore */ }
            return shared;
        }
        try {
            const local = localStorage.getItem(key);
            if (local) return local;
        } catch { /* ignore */ }
        return memory.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => {
        memory.set(key, value);
        try { localStorage.setItem(key, value); } catch { /* ignore */ }
        await writeSharedSession(value);
    },
    removeItem: async (key: string) => {
        memory.delete(key);
        try { localStorage.removeItem(key); } catch { /* ignore */ }
    },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storage: crimsonAuthStorage,
    },
});
