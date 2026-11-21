import React, { useState, useEffect } from 'react';
import { supabase, isSupabaseConfigured, SUPABASE_URL } from '../../lib/supabase';
import { Loader2, AlertCircle, ArrowLeft, KeyRound, MailCheck, ShieldCheck } from 'lucide-react';
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
        return 'Impossible de joindre le serveur d’authentification. Vérifie ta connexion internet ou désactive ton VPN/proxy.';
    }
    if (lower.includes('invalid login credentials') || lower.includes('invalid_credentials')) {
        return 'Email ou mot de passe incorrect.';
    }
    if (lower.includes('email not confirmed') || lower.includes('email non vérifié')) {
        return 'Veuillez valider le code de vérification envoyé à votre adresse email.';
    }
    return raw || 'Une erreur est survenue.';
}

type AuthStep = 'login' | 'signup' | 'verify' | 'forgot_request' | 'forgot_reset';

const LoginScreen = () => {
    const [step, setStep] = useState<AuthStep>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [resendCooldown, setResendCooldown] = useState(0);

    useEffect(() => {
        import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
            getCurrentWindow().show().catch(console.error);
        });
    }, []);

    useEffect(() => {
        if (resendCooldown <= 0) return;
        const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
        return () => clearTimeout(timer);
    }, [resendCooldown]);

    const handleResendCode = async () => {
        if (resendCooldown > 0 || !email) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${SUPABASE_URL}/api/auth/resend-code`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || data.error || 'Erreur lors du renvoi du code.');
            setSuccessMessage('Un nouveau code à 6 chiffres vous a été envoyé.');
            setResendCooldown(60);
        } catch (err: any) {
            setError(err.message || 'Impossible de renvoyer le code.');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setSuccessMessage(null);

        try {
            if (!isSupabaseConfigured()) {
                throw new Error('Configuration Supabase manquante.');
            }

            // --- STEP: SIGNUP ---
            if (step === 'signup') {
                const res = await fetch(`${SUPABASE_URL}/api/auth/signup`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password }),
                });
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.error_description || data.message || 'Erreur lors de la création du compte.');
                }

                if (data.requires_verification) {
                    setStep('verify');
                    setSuccessMessage(`Un code de validation à 6 chiffres a été envoyé à ${email}.`);
                    setResendCooldown(60);
                    return;
                }

                // If directly verified
                if (data.access_token) {
                    await supabase.auth.setSession({
                        access_token: data.access_token,
                        refresh_token: data.refresh_token,
                    });
                }
            }

            // --- STEP: VERIFY 6-DIGIT OTP ---
            else if (step === 'verify') {
                const res = await fetch(`${SUPABASE_URL}/api/auth/verify`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, code: code.trim() }),
                });
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.error_description || data.message || 'Code de validation incorrect.');
                }

                if (data.access_token) {
                    await supabase.auth.setSession({
                        access_token: data.access_token,
                        refresh_token: data.refresh_token,
                    });
                }
            }

            // --- STEP: FORGOT PASSWORD REQUEST ---
            else if (step === 'forgot_request') {
                const res = await fetch(`${SUPABASE_URL}/api/auth/recover`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email }),
                });
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.message || data.error || 'Erreur lors de la demande de réinitialisation.');
                }
                setStep('forgot_reset');
                setSuccessMessage(`Un code de réinitialisation a été envoyé à ${email}.`);
                setResendCooldown(60);
            }

            // --- STEP: FORGOT PASSWORD RESET ---
            else if (step === 'forgot_reset') {
                const res = await fetch(`${SUPABASE_URL}/api/auth/reset-password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, code: code.trim(), new_password: newPassword }),
                });
                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.message || data.error || 'Code incorrect ou expiré.');
                }

                if (data.access_token) {
                    await supabase.auth.setSession({
                        access_token: data.access_token,
                        refresh_token: data.refresh_token,
                    });
                }
            }

            // --- STEP: LOGIN ---
            else {
                const { error } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });
                if (error) {
                    if (error.message.toLowerCase().includes('email not confirmed') || error.message.toLowerCase().includes('non vérifié')) {
                        setStep('verify');
                        setError("Votre compte n'est pas encore vérifié. Un code à 6 chiffres vous a été envoyé par email.");
                        setResendCooldown(60);
                        return;
                    }
                    throw error;
                }
            }
        } catch (err: unknown) {
            setError(formatLoginError(err));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="h-screen w-screen bg-[#050505] flex items-center justify-center p-4 relative overflow-hidden select-none">
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
            
            <div className="w-full max-w-md relative z-10 animate-in fade-in slide-in-from-bottom-8 duration-700">
                <div className="bg-[#111115]/90 backdrop-blur-2xl border border-white/10 p-10 rounded-[2.5rem] shadow-2xl">
                    <div className="flex flex-col items-center mb-8">
                        <div className="relative group mb-5">
                            <div className="relative w-18 h-18 rounded-full border border-white/10 flex items-center justify-center overflow-hidden bg-black/20 shadow-[0_0_30px_rgba(220,38,38,0.2)]">
                                <img src={logoRed} className="w-full h-full object-cover scale-[1.3]" alt="CRIMSONS" />
                            </div>
                        </div>
                        <h1 className="text-3xl font-black tracking-[0.2em] text-white uppercase text-center font-mono">CRIMSONS</h1>
                        <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mt-1.5">
                            {step === 'verify' ? 'Vérification obligatoire du compte' : 
                             step === 'forgot_request' || step === 'forgot_reset' ? 'Récupération de mot de passe' : 
                             'LoL gratuit · Spotify & Discord en Premium'}
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-5">
                        {error && (
                            <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl animate-in fade-in">
                                <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                                <p className="text-[10px] font-black text-red-400 uppercase tracking-widest">{error}</p>
                            </div>
                        )}
                        {successMessage && (
                            <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-2xl animate-in fade-in">
                                <p className="text-[10px] font-black text-green-400 uppercase tracking-widest">{successMessage}</p>
                            </div>
                        )}

                        {/* --- VIEW: VERIFY OTP CODE --- */}
                        {step === 'verify' && (
                            <div className="space-y-4">
                                <div className="text-center p-3 rounded-2xl bg-white/[0.02] border border-white/5">
                                    <MailCheck className="w-8 h-8 text-red-500 mx-auto mb-2" />
                                    <p className="text-xs text-white/80 font-bold">Un code de vérification a été envoyé à :</p>
                                    <p className="text-xs font-mono text-red-400 font-black mt-0.5">{email}</p>
                                </div>

                                <div>
                                    <label className="block text-[9px] font-black uppercase tracking-widest text-white/40 mb-2 ml-2">Code à 6 chiffres</label>
                                    <input
                                        type="text"
                                        required
                                        maxLength={6}
                                        value={code}
                                        onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
                                        className="w-full bg-black/40 border border-white/10 px-5 py-3.5 text-center text-xl font-mono tracking-[0.5em] focus:border-red-500 outline-none text-white rounded-2xl transition-colors"
                                        placeholder="000000"
                                        autoComplete="one-time-code"
                                        autoFocus
                                    />
                                </div>

                                <button
                                    type="submit"
                                    disabled={loading || code.length < 6}
                                    className="w-full py-4 mt-2 bg-red-600 hover:bg-red-500 active:scale-[0.98] disabled:opacity-40 text-white text-[11px] font-black uppercase tracking-[0.2em] rounded-2xl transition-all shadow-[0_0_20px_rgba(220,38,38,0.3)] flex items-center justify-center gap-2"
                                >
                                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><ShieldCheck className="w-4 h-4" /> Confirmer mon compte</>}
                                </button>

                                <div className="flex items-center justify-between pt-2">
                                    <button
                                        type="button"
                                        onClick={handleResendCode}
                                        disabled={resendCooldown > 0 || loading}
                                        className="text-[10px] font-bold text-white/40 hover:text-white/80 disabled:opacity-40 uppercase tracking-wider transition-colors"
                                    >
                                        {resendCooldown > 0 ? `Renvoyer (${resendCooldown}s)` : 'Renvoyer un code'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setStep('login'); setError(null); }}
                                        className="text-[10px] font-bold text-white/40 hover:text-white/80 uppercase tracking-wider transition-colors flex items-center gap-1"
                                    >
                                        <ArrowLeft className="w-3 h-3" /> Retour
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* --- VIEW: FORGOT PASSWORD REQUEST --- */}
                        {step === 'forgot_request' && (
                            <div className="space-y-4">
                                <div className="text-center mb-4">
                                    <KeyRound className="w-8 h-8 text-red-500 mx-auto mb-2" />
                                    <p className="text-xs text-white/70">Entrez votre adresse email pour recevoir un code de réinitialisation.</p>
                                </div>
                                <div>
                                    <label className="block text-[9px] font-black uppercase tracking-widest text-white/40 mb-2 ml-2">Email du compte</label>
                                    <input
                                        type="email"
                                        required
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="w-full bg-black/40 border border-white/5 px-5 py-4 text-xs font-mono focus:border-red-500/50 outline-none text-white/80 rounded-2xl transition-colors"
                                        placeholder="Votre email..."
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={loading || !email}
                                    className="w-full py-4 mt-2 bg-red-600 hover:bg-red-500 active:scale-[0.98] disabled:opacity-40 text-white text-[11px] font-black uppercase tracking-[0.2em] rounded-2xl transition-all shadow-[0_0_20px_rgba(220,38,38,0.3)] flex items-center justify-center gap-2"
                                >
                                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Envoyer le code'}
                                </button>
                                <div className="text-center pt-2">
                                    <button
                                        type="button"
                                        onClick={() => { setStep('login'); setError(null); }}
                                        className="text-[10px] font-bold text-white/40 hover:text-white/80 uppercase tracking-wider transition-colors"
                                    >
                                        Retour à la connexion
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* --- VIEW: FORGOT PASSWORD RESET --- */}
                        {step === 'forgot_reset' && (
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-[9px] font-black uppercase tracking-widest text-white/40 mb-2 ml-2">Code à 6 chiffres reçu</label>
                                    <input
                                        type="text"
                                        required
                                        maxLength={6}
                                        value={code}
                                        onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
                                        className="w-full bg-black/40 border border-white/10 px-5 py-3 text-center text-lg font-mono tracking-[0.4em] focus:border-red-500 outline-none text-white rounded-2xl transition-colors"
                                        placeholder="000000"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[9px] font-black uppercase tracking-widest text-white/40 mb-2 ml-2">Nouveau mot de passe</label>
                                    <input
                                        type="password"
                                        required
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        className="w-full bg-black/40 border border-white/5 px-5 py-3.5 text-xs font-mono focus:border-red-500/50 outline-none text-white/80 rounded-2xl transition-colors"
                                        placeholder="Nouveau mot de passe..."
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={loading || code.length < 6 || newPassword.length < 6}
                                    className="w-full py-4 mt-2 bg-red-600 hover:bg-red-500 active:scale-[0.98] disabled:opacity-40 text-white text-[11px] font-black uppercase tracking-[0.2em] rounded-2xl transition-all shadow-[0_0_20px_rgba(220,38,38,0.3)] flex items-center justify-center gap-2"
                                >
                                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Réinitialiser & Connexion'}
                                </button>
                                <div className="text-center pt-2">
                                    <button
                                        type="button"
                                        onClick={() => { setStep('login'); setError(null); }}
                                        className="text-[10px] font-bold text-white/40 hover:text-white/80 uppercase tracking-wider transition-colors"
                                    >
                                        Annuler
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* --- VIEW: LOGIN / SIGNUP --- */}
                        {(step === 'login' || step === 'signup') && (
                            <>
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-[9px] font-black uppercase tracking-widest text-white/40 mb-2 ml-2">Email</label>
                                        <input
                                            type="email"
                                            required
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            className="w-full bg-black/40 border border-white/5 px-5 py-4 text-xs font-mono focus:border-red-500/50 outline-none text-white/80 rounded-2xl transition-colors"
                                            placeholder="votre.email@exemple.com"
                                            autoComplete="off"
                                            autoCorrect="off"
                                            spellCheck={false}
                                        />
                                    </div>
                                    <div>
                                        <div className="flex items-center justify-between mb-2 ml-2 mr-1">
                                            <label className="block text-[9px] font-black uppercase tracking-widest text-white/40">Mot de passe</label>
                                            {step === 'login' && (
                                                <button
                                                    type="button"
                                                    onClick={() => { setStep('forgot_request'); setError(null); setSuccessMessage(null); }}
                                                    className="text-[9px] font-bold uppercase tracking-wider text-red-500/70 hover:text-red-400 transition-colors"
                                                >
                                                    Oublié ?
                                                </button>
                                            )}
                                        </div>
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
                                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (step === 'signup' ? 'Créer mon compte' : 'Initialisation')}
                                </button>

                                <div className="mt-6 text-center">
                                    <button 
                                        type="button"
                                        onClick={() => {
                                            setStep(step === 'signup' ? 'login' : 'signup');
                                            setError(null);
                                            setSuccessMessage(null);
                                        }}
                                        className="text-[10px] font-black uppercase tracking-widest text-white/30 hover:text-white/70 transition-colors"
                                    >
                                        {step === 'signup' ? 'Déjà un compte ? Se connecter' : 'Pas de compte ? S\'inscrire'}
                                    </button>
                                </div>
                            </>
                        )}
                    </form>
                </div>
            </div>
        </div>
    );
};

export default LoginScreen;