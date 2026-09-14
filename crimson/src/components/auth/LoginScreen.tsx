import React, { useState, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { Loader2, AlertCircle } from 'lucide-react';
import logoRed from '../../assets/logos/logo_red_transparent.png';

/** Traduit les erreurs brutes supabase/fetch en messages actionnables. */
function formatLoginError(err: unknown): string {
    const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
    const lower = raw.toLowerCase();

    if (!isSupabaseConfigured()) {
        return 'Configuration Supabase manquante dans cette build. Réinstalle la dernière release.';
    }
    if (
        lower.includes('failed to fetch')
        || lower.includes('networkerror')
        || lower.includes('load failed')
        || lower.includes('network request failed')
        || err instanceof TypeError
    ) {
        return 'Impossible de joindre le serveur d’auth (réseau / DNS / antivirus). Vérifie ta connexion, désactive VPN/proxy, ou autorise *.supabase.co.';
    }
    if (lower.includes('invalid login credentials') || lower.includes('invalid_credentials')) {
        return 'Email ou mot de passe incorrect.';
    }
    if (lower.includes('email not confirmed')) {
        return 'Confirme d’abord ton email (lien reçu à l’inscription).';
    }
    return raw || 'Une erreur est survenue.';
}

const LoginScreen = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isSignUp, setIsSignUp] = useState(false);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    useEffect(() => {
        import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
            getCurrentWindow().show().catch(console.error);
        });
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setSuccessMessage(null);

        try {
            if (!isSupabaseConfigured()) {
                throw new Error('Configuration Supabase manquante.');
            }
            if (isSignUp) {
                const { error, data } = await supabase.auth.signUp({
                    email,
                    password,
                });
                if (error) throw error;
                
                if (data.user && data.user.identities && data.user.identities.length === 0) {
                    throw new Error("Cet email est déjà utilisé.");
                }
                setSuccessMessage("Compte créé avec succès ! Vous pouvez maintenant vous connecter.");
                setIsSignUp(false);
            } else {
                const { error } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });
                if (error) throw error;
            }
        } catch (err: unknown) {
            setError(formatLoginError(err));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="h-screen w-screen bg-[#050505] flex items-center justify-center p-4 relative overflow-hidden">
            {/* Window Controls */}
            <div data-tauri-drag-region className="absolute top-0 left-0 right-0 h-10 flex justify-end items-center px-4 z-50">
                <button 
                    onClick={async () => {
                        const { getCurrentWindow } = await import('@tauri-apps/api/window');
                        const { invoke } = await import('@tauri-apps/api/core');
                        try {
                            await invoke('crimson_quit_app');
                        } catch {
                            await getCurrentWindow().close();
                        }
                    }}
                    className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>

            {/* Background effects */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-red-600/10 rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-orange-600/5 rounded-full blur-[100px] pointer-events-none" />
            
            <div className="w-full max-w-md relative z-10 animate-in fade-in slide-in-from-bottom-8 duration-1000">
                <div className="bg-[#111115]/80 backdrop-blur-2xl border border-white/10 p-10 rounded-[2.5rem] shadow-2xl">
                    <div className="flex flex-col items-center mb-10">
                        <div className="relative group mb-6">
                            <div className="relative w-20 h-20 rounded-full border border-white/10 flex items-center justify-center overflow-hidden bg-black/20">
                                <img src={logoRed} className="w-full h-full object-cover scale-[1.3]" alt="CRIMSONS" />
                            </div>
                        </div>
                        <h1 className="text-3xl font-black tracking-[0.2em] text-white uppercase text-center">CRIMSONS</h1>
                        <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mt-2">LoL gratuit · Spotify &amp; Discord en Premium</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        {error && (
                            <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl animate-in fade-in">
                                <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
                                <p className="text-[10px] font-black text-red-400 uppercase tracking-widest">{error}</p>
                            </div>
                        )}
                        {successMessage && (
                            <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-2xl animate-in fade-in">
                                <p className="text-[10px] font-black text-green-400 uppercase tracking-widest">{successMessage}</p>
                            </div>
                        )}

                        <div className="space-y-4">
                            <div>
                                <label className="block text-[9px] font-black uppercase tracking-widest text-white/40 mb-2 ml-2">Email</label>
                                <input
                                    type="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="w-full bg-black/40 border border-white/5 px-5 py-4 text-xs font-mono focus:border-red-500/50 outline-none text-white/80 rounded-2xl transition-colors"
                                    placeholder="Email"
                                    autoComplete="off"
                                    autoCorrect="off"
                                    spellCheck={false}
                                />
                            </div>
                            <div>
                                <label className="block text-[9px] font-black uppercase tracking-widest text-white/40 mb-2 ml-2">Mot de passe</label>
                                <input
                                    type="password"
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full bg-black/40 border border-white/5 px-5 py-4 text-xs font-mono focus:border-red-500/50 outline-none text-white/80 rounded-2xl transition-colors"
                                    placeholder="••••••••••••"
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-4 mt-4 bg-red-600 hover:bg-red-500 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 text-white text-[11px] font-black uppercase tracking-[0.2em] rounded-2xl transition-all shadow-[0_0_20px_rgba(220,38,38,0.3)] flex items-center justify-center gap-2"
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (isSignUp ? 'Créer mon compte' : 'Initialisation')}
                        </button>
                    </form>

                    <div className="mt-6 text-center">
                        <button 
                            onClick={() => {
                                setIsSignUp(!isSignUp);
                                setError(null);
                                setSuccessMessage(null);
                            }}
                            className="text-[10px] font-black uppercase tracking-widest text-white/30 hover:text-white/70 transition-colors"
                        >
                            {isSignUp ? 'Déjà un compte ? Se connecter' : 'Pas de compte ? S\'inscrire'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LoginScreen;
