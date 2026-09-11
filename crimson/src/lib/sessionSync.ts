import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

type TokenPair = {
    access_token: string;
    refresh_token: string;
};

function tokensFromUnknown(raw: unknown): TokenPair | null {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    const access = typeof obj.access_token === 'string' ? obj.access_token : '';
    const refresh = typeof obj.refresh_token === 'string' ? obj.refresh_token : '';
    if (!access || !refresh) return null;
    return { access_token: access, refresh_token: refresh };
}

export async function readSidecarSessionTokens(): Promise<TokenPair | null> {
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        const json = await invoke<string | null>('crimson_read_supabase_session');
        if (!json) return null;
        return tokensFromUnknown(JSON.parse(json));
    } catch {
        return null;
    }
}

/** Adopte les jetons du sidecar s'ils different de la session webview. */
export async function syncSessionFromSidecar(current: Session | null): Promise<Session | null> {
    const tokens = await readSidecarSessionTokens();
    if (!tokens) return current;
    if (
        current?.access_token === tokens.access_token
        && current?.refresh_token === tokens.refresh_token
    ) {
        return current;
    }
    const { data, error } = await supabase.auth.setSession(tokens);
    if (error) return current;
    return data.session ?? current;
}

export async function applyAuthSessionUpdate(msg: {
    access_token?: string;
    refresh_token?: string;
}): Promise<Session | null> {
    const tokens = tokensFromUnknown(msg);
    if (!tokens) return null;
    const { data, error } = await supabase.auth.setSession(tokens);
    if (error) return null;
    return data.session;
}
