import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { syncSessionFromSidecar } from '../lib/sessionSync';
import { invoke } from '@tauri-apps/api/core';

interface AuthContextType {
    session: Session | null;
    user: User | null;
    isPremium: boolean;
    loading: boolean;
    refreshPremium: () => Promise<boolean>;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
    session: null,
    user: null,
    isPremium: false,
    loading: true,
    refreshPremium: async () => false,
    signOut: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [session, setSession] = useState<Session | null>(null);
    const [user, setUser] = useState<User | null>(null);
    const [isPremium, setIsPremium] = useState(false);
    const [loading, setLoading] = useState(true);
    const signingOutRef = useRef(false);
    const applyingRef = useRef(false);

    useEffect(() => {
        let cancelled = false;

        const apply = (next: Session | null) => {
            if (cancelled) return;
            setSession(next);
            setUser(next?.user ?? null);
            checkPremiumStatus(next?.user?.id);
        };

        const recover = async (current: Session | null): Promise<Session | null> => {
            if (signingOutRef.current) return current;
            applyingRef.current = true;
            try {
                return await syncSessionFromSidecar(current);
            } finally {
                applyingRef.current = false;
            }
        };

        supabase.auth.getSession().then(async ({ data: { session: initial } }) => {
            const next = await recover(initial);
            apply(next);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
            // Un SIGNED_OUT apres refresh rate n'est pas une deconnexion
            // volontaire : le sidecar a souvent deja le nouveau jeton.
            if (event === 'SIGNED_OUT' && !signingOutRef.current) {
                const recovered = await recover(null);
                if (recovered?.access_token) {
                    apply(recovered);
                    return;
                }
            }
            if (applyingRef.current && event === 'TOKEN_REFRESHED') {
                apply(nextSession);
                return;
            }
            apply(nextSession);
        });

        const onVisibility = () => {
            if (document.visibilityState !== 'visible' || signingOutRef.current) return;
            // La webview throttle les timers quand la fenetre est cachee :
            // supabase-js n'a pas pu renouveler, le sidecar si. Adopter ses
            // jetons AVANT que l'auto-refresh rejoue l'ancien refresh token.
            supabase.auth.getSession().then(async ({ data: { session: current } }) => {
                const next = await recover(current);
                if (next?.refresh_token !== current?.refresh_token) apply(next);
            });
        };
        document.addEventListener('visibilitychange', onVisibility);

        return () => {
            cancelled = true;
            subscription.unsubscribe();
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, []);

    const checkPremiumStatus = async (userId?: string): Promise<boolean> => {
        if (!userId) {
            setIsPremium(false);
            setLoading(false);
            return false;
        }

        // Start the sidecar as soon as we have a Supabase user. Premium lookup
        // must not gate this: a profiles RLS/network failure used to leave the
        // backend permanently down while the UI looked "logged in".
        try {
            await invoke('crimson_start_server');
        } catch (e) {
            console.error('Failed to start server:', e);
        }

        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('is_premium, premium_token')
                .eq('id', userId)
                .single();

            if (error) throw error;

            // Sert uniquement a l'affichage. L'ancienne heuristique sur la
            // longueur du jeton ne prouvait rien : c'est la base qui fait foi,
            // et le serveur local revalide de son cote avant toute commande.
            const premium = data?.is_premium === true;
            setIsPremium(premium);
            return premium;
        } catch (error) {
            console.error('Error fetching premium status:', error);
            setIsPremium(false);
            return false;
        } finally {
            setLoading(false);
        }
    };

    /** Re-lit is_premium apres un achat — pas besoin de reinstaller. */
    const refreshPremium = async (): Promise<boolean> => {
        const { data: { session: current } } = await supabase.auth.getSession();
        return checkPremiumStatus(current?.user?.id);
    };

    const signOut = async () => {
        signingOutRef.current = true;
        // Explicit logout — clear sidecar refresh so StreamDock does not stay premium.
        try {
            let token = await invoke<string | null>('crimson_get_auth_token').catch(() => null);
            const url = token
                ? `ws://127.0.0.1:40510/?token=${encodeURIComponent(token)}`
                : 'ws://127.0.0.1:40510/';
            await new Promise<void>((resolve) => {
                try {
                    const ws = new WebSocket(url);
                    const done = () => resolve();
                    ws.onopen = () => {
                        ws.send(JSON.stringify({ type: 'AUTH_LOGOUT' }));
                        ws.close();
                        done();
                    };
                    ws.onerror = done;
                    setTimeout(done, 1500);
                } catch {
                    resolve();
                }
            });
        } catch (e) {
            console.error('Failed to notify server of logout:', e);
        }
        try {
            await invoke('crimson_stop_server');
        } catch (e) {
            console.error('Failed to stop server:', e);
        }
        await supabase.auth.signOut();
        signingOutRef.current = false;
    };

    return (
        <AuthContext.Provider value={{ session, user, isPremium, loading, refreshPremium, signOut }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
