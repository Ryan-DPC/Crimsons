import { useState, useEffect } from 'react';
import { 
    Sparkles, Key, Music, MessageSquare, 
    ArrowRight, Check, Compass, ShieldCheck, Activity
} from 'lucide-react';
import logoRed from '../../assets/logos/logo_red_transparent.png';

interface OnboardingModalProps {
    onClose: () => void;
    updateSetting: (key: string, value: any) => Promise<void>;
    appData: any;
    loginSpotify: (clientId: string, clientSecret: string) => Promise<void>;
    spotifyConnected: boolean;
}

export default function OnboardingModal({
    onClose,
    updateSetting,
    appData,
    loginSpotify,
    spotifyConnected,
}: OnboardingModalProps) {
    const [step, setStep] = useState(1);
    const [geminiKey, setGeminiKey] = useState(appData?.geminiApiKey || '');
    const [isSaving, setIsSaving] = useState(false);
    const [spotifyId, setSpotifyId] = useState(appData?.spotifyClientId || '');
    const [spotifySecret, setSpotifySecret] = useState('');
    const [spotifyError, setSpotifyError] = useState<string | null>(null);
    const [spotifyPending, setSpotifyPending] = useState(false);
    const hasSavedSecret = !!appData?.spotifyClientSecret;

    useEffect(() => {
        if (appData?.spotifyClientId && !spotifyId) {
            setSpotifyId(appData.spotifyClientId);
        }
    }, [appData?.spotifyClientId]);

    useEffect(() => {
        if (spotifyConnected && spotifyPending) {
            setSpotifyPending(false);
            setSpotifyError(null);
        }
    }, [spotifyConnected, spotifyPending]);

    // Chaque installation utilise l'application Spotify de son proprietaire :
    // aucun identifiant n'est fourni par Crimsons.
    const handleConnectSpotify = async () => {
        const clientId = spotifyId.trim() || (appData?.spotifyClientId || '');
        const clientSecret = spotifySecret.trim() || (appData?.spotifyClientSecret || '');

        if (!clientId || (!clientSecret && !hasSavedSecret)) {
            setSpotifyError("Renseignez le Client ID et le Client Secret de votre application Spotify.");
            return;
        }
        setSpotifyError(null);
        setSpotifyPending(true);

        try {
            localStorage.removeItem('spotify_client_secret');
            localStorage.removeItem('spotify_client_id');
        } catch { /* ignore */ }

        try {
            // Persists credentials + pushes SPOTIFY_CREDENTIALS to the sidecar,
            // then opens OAuth — same path as Paramètres.
            await loginSpotify(clientId, clientSecret);
        } catch (e) {
            console.error("Failed to open Spotify auth", e);
            setSpotifyPending(false);
            setSpotifyError("Impossible d'ouvrir la page d'autorisation Spotify.");
        }
    };

    const handleNext = async () => {
        if (step === 2) {
            setIsSaving(true);
            await updateSetting('geminiApiKey', geminiKey);
            setIsSaving(false);
        }
        
        if (step < 4) {
            setStep(step + 1);
        } else {
            setIsSaving(true);
            await updateSetting('firstLaunchFinished', true);
            setIsSaving(false);
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-2xl animate-in fade-in duration-500">
            {/* Ambient Background Glows */}
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-red-600/10 rounded-full blur-[150px] pointer-events-none" />
            <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-rose-600/5 rounded-full blur-[150px] pointer-events-none" />

            <div className="relative w-full max-w-2xl bg-[#09090c]/90 border border-white/10 backdrop-blur-md rounded-[3rem] p-10 overflow-hidden shadow-2xl animate-in zoom-in-95 duration-500">
                {/* Step indicator */}
                <div className="absolute top-10 right-10 flex gap-1">
                    {[1, 2, 3, 4].map((s) => (
                        <div 
                            key={s} 
                            className={`h-1.5 rounded-full transition-all duration-300 ${s === step ? 'w-6 bg-red-600' : 'w-2 bg-white/10'}`} 
                        />
                    ))}
                </div>

                {step === 1 && (
                    <div className="flex flex-col items-center text-center py-6 animate-in fade-in duration-500">
                        <div className="relative w-24 h-24 flex items-center justify-center rounded-full border border-white/10 overflow-hidden bg-black/40 mb-8 shadow-inner animate-pulse">
                            <img src={logoRed} className="w-full h-full object-cover scale-[1.35]" alt="CRIMSONS" />
                        </div>
                        <h2 className="text-3xl font-black tracking-[0.1em] text-white uppercase mb-4">Bienvenue sur <span className="text-red-600">Crimsons</span></h2>
                        <p className="text-sm text-white/50 max-w-md leading-relaxed mb-10 uppercase tracking-wide font-medium">
                            Votre compagnon de jeu intelligent pour League of Legends. Préparez-vous à optimiser vos drafts et à contrôler vos applications multimédia en toute simplicité.
                        </p>
                        <button 
                            onClick={handleNext}
                            className="flex items-center gap-3 px-8 py-4 bg-red-600 hover:bg-red-500 text-white rounded-2xl border border-white/10 transition-all shadow-lg hover:shadow-[0_0_30px_rgba(220,38,38,0.3)] hover:scale-105 active:scale-95"
                        >
                            <span className="text-xs font-black tracking-widest uppercase">Commencer la Configuration</span>
                            <ArrowRight size={14} />
                        </button>
                    </div>
                )}

                {step === 2 && (
                    <div className="flex flex-col py-4 animate-in fade-in duration-500">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="p-3 bg-red-500/10 rounded-xl text-red-500">
                                <Key size={24} />
                            </div>
                            <div>
                                <h2 className="text-xl font-black text-white uppercase tracking-widest">Configuration de l'IA</h2>
                                <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest mt-0.5">Nécessaire pour le Coach de draft et les builds de runes</p>
                            </div>
                        </div>

                        <p className="text-xs text-white/60 leading-relaxed mb-6 uppercase tracking-wider font-semibold">
                            Crimsons utilise l'IA Google Gemini pour analyser votre draft en temps réel et proposer les meilleurs builds. Vous pouvez obtenir une clé d'API gratuite en quelques secondes.
                        </p>

                        <div className="bg-black/40 border border-white/5 p-5 rounded-2xl flex items-center justify-between mb-8">
                            <span className="text-[10px] font-black text-white/50 uppercase tracking-widest">Pas encore de clé API ?</span>
                            <a 
                                href="https://aistudio.google.com/" 
                                target="_blank" 
                                rel="noreferrer"
                                className="flex items-center gap-1.5 text-red-500 hover:text-red-400 text-[10px] font-black uppercase tracking-widest transition-colors"
                            >
                                <Compass size={12} />
                                Obtenir une clé gratuite
                            </a>
                        </div>

                        <div className="flex flex-col gap-2 mb-8">
                            <label className="text-[9px] font-black text-white/40 uppercase tracking-widest pl-2">Clé d'API Google Gemini</label>
                            <input 
                                type="password" 
                                value={geminiKey}
                                onChange={(e) => setGeminiKey(e.target.value)}
                                placeholder="Collez votre clé API ici (ex: AIzaSy...)" 
                                className="w-full bg-black/40 border border-white/10 rounded-2xl px-5 py-4 text-xs font-mono text-white outline-none focus:border-red-600 transition-colors"
                            />
                        </div>

                        <button 
                            onClick={handleNext}
                            disabled={isSaving}
                            className="ml-auto flex items-center gap-3 px-8 py-4 bg-red-600 hover:bg-red-500 text-white rounded-2xl border border-white/10 transition-all disabled:opacity-50"
                        >
                            <span className="text-xs font-black tracking-widest uppercase">Étape Suivante</span>
                            <ArrowRight size={14} />
                        </button>
                    </div>
                )}

                {step === 3 && (
                    <div className="flex flex-col py-4 animate-in fade-in duration-500">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="p-3 bg-red-500/10 rounded-xl text-red-500">
                                <Sparkles size={24} />
                            </div>
                            <div>
                                <h2 className="text-xl font-black text-white uppercase tracking-widest">Associer vos services</h2>
                                <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest mt-0.5">Une fois · LoL auto · Spotify &amp; Discord = Premium</p>
                            </div>
                        </div>

                        <p className="text-xs text-white/60 leading-relaxed mb-6 uppercase tracking-wider font-semibold">
                            League of Legends se connecte tout seul dès que le client est ouvert. Spotify se configure une seule fois ici. Discord s’active ensuite dans Crimsons (Paramètres → Plugins), pas dans Discord.
                        </p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
                            {/* Spotify */}
                            <div className="bg-black/40 border border-white/5 p-6 rounded-3xl flex flex-col justify-between hover:border-white/10 transition-colors">
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex flex-col">
                                        <span className="text-xs font-black text-white uppercase tracking-widest">Spotify</span>
                                        <span className="text-[8px] text-white/30 uppercase font-black tracking-widest mt-1">Setup unique · Premium pour StreamDock</span>
                                    </div>
                                    <Music className="w-5 h-5 text-green-500" />
                                </div>

                                {spotifyConnected ? (
                                    <div className="flex flex-col gap-4 flex-1 justify-center">
                                        <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl border bg-green-500/10 border-green-500/20 text-green-500">
                                            <Activity className="w-3.5 h-3.5 animate-pulse" />
                                            <span className="text-[10px] font-black uppercase tracking-tighter">Connecté — jetons enregistrés</span>
                                        </div>
                                        <p className="text-[8px] text-white/40 uppercase font-black tracking-widest leading-relaxed">
                                            Activez Spotify dans Paramètres → Plugins (Hub) pour le contrôle StreamDock.
                                        </p>
                                    </div>
                                ) : (
                                    <>
                                        <ol className="text-[8px] text-white/40 uppercase font-black tracking-widest mb-3 leading-relaxed space-y-1.5 list-decimal list-inside">
                                            <li>
                                                <a
                                                    href="https://developer.spotify.com/dashboard"
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="text-red-500 hover:text-red-400"
                                                >
                                                    Créer une app Spotify Developer
                                                </a>
                                            </li>
                                            <li>
                                                Redirect URI :{' '}
                                                <code className="text-white/50 normal-case tracking-normal">http://127.0.0.1:40510/callback</code>
                                            </li>
                                            <li>Coller Client ID + Secret ci-dessous</li>
                                            <li>Cliquer Associer → autoriser dans le navigateur</li>
                                        </ol>

                                        <div className="flex flex-col gap-2 mb-3">
                                            <input
                                                type="text"
                                                value={spotifyId}
                                                onChange={(e) => setSpotifyId(e.target.value)}
                                                placeholder="Client ID"
                                                autoComplete="off"
                                                spellCheck={false}
                                                className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-[10px] font-mono text-white outline-none focus:border-green-600 transition-colors"
                                            />
                                            <input
                                                type="password"
                                                value={spotifySecret}
                                                onChange={(e) => setSpotifySecret(e.target.value)}
                                                placeholder={hasSavedSecret ? 'Enregistré — laisser vide' : 'Client Secret'}
                                                autoComplete="off"
                                                className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-[10px] font-mono text-white outline-none focus:border-green-600 transition-colors"
                                            />
                                        </div>

                                        {spotifyError && (
                                            <p className="text-[8px] font-black text-red-400 uppercase tracking-widest mb-3 leading-relaxed">{spotifyError}</p>
                                        )}
                                        {spotifyPending && !spotifyError && (
                                            <p className="text-[8px] font-black text-yellow-400/80 uppercase tracking-widest mb-3 leading-relaxed">
                                                Autorisez Spotify dans le navigateur… en attente de confirmation
                                            </p>
                                        )}

                                        <button
                                            onClick={handleConnectSpotify}
                                            disabled={!(spotifyId.trim() || appData?.spotifyClientId) || !(spotifySecret.trim() || hasSavedSecret) || spotifyPending}
                                            className="w-full py-3 bg-green-600 hover:bg-green-500 disabled:bg-white/5 disabled:text-white/30 disabled:cursor-not-allowed text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all"
                                        >
                                            {spotifyPending ? 'En attente…' : 'Associer Spotify'}
                                        </button>
                                    </>
                                )}
                            </div>

                            {/* Discord — optionnel, pas de setup OAuth ici */}
                            <div className="bg-black/40 border border-white/5 p-6 rounded-3xl flex flex-col justify-between hover:border-white/10 transition-colors">
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex flex-col">
                                        <span className="text-xs font-black text-white uppercase tracking-widest">Discord</span>
                                        <span className="text-[8px] text-white/30 uppercase font-black tracking-widest mt-1">Optionnel · Premium</span>
                                    </div>
                                    <MessageSquare className="w-5 h-5 text-indigo-400" />
                                </div>
                                <ol className="text-[8px] text-white/40 uppercase font-black tracking-widest leading-relaxed space-y-1.5 list-decimal list-inside">
                                    <li>Ouvre l’app Discord sur le PC (pas de menu Plugin dans Discord)</li>
                                    <li>Dans Crimsons : Paramètres → Plugins → activer Discord</li>
                                    <li>Mute / deafen = IPC, sans OAuth</li>
                                    <li>Touches StreamDock Discord = plugin optionnel à part</li>
                                </ol>
                            </div>
                        </div>

                        <button 
                            onClick={handleNext}
                            className="ml-auto flex items-center gap-3 px-8 py-4 bg-red-600 hover:bg-red-500 text-white rounded-2xl border border-white/10 transition-all"
                        >
                            <span className="text-xs font-black tracking-widest uppercase">Étape Suivante</span>
                            <ArrowRight size={14} />
                        </button>
                    </div>
                )}

                {step === 4 && (
                    <div className="flex flex-col items-center text-center py-6 animate-in fade-in duration-500">
                        <div className="w-20 h-20 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center text-green-500 mb-8 animate-bounce">
                            <ShieldCheck size={40} />
                        </div>
                        <h2 className="text-2xl font-black text-white uppercase tracking-widest mb-4">Configuration Terminée !</h2>
                        <p className="text-xs text-white/50 max-w-sm leading-relaxed mb-4 uppercase tracking-wider font-semibold">
                            Lancez League of Legends : Crimsons se connecte automatiquement. Après un achat Premium, utilisez « Actualiser le statut » dans Paramètres — aucune réinstallation.
                        </p>
                        <p className="text-[10px] text-white/30 max-w-sm leading-relaxed mb-10 uppercase tracking-wider font-semibold">
                            StreamDock : installez les plugins depuis le catalogue Crimsons (aucun pack n’est fourni avec l’app), puis redémarrez Stream Dock.
                        </p>
                        <button 
                            onClick={handleNext}
                            disabled={isSaving}
                            className="flex items-center gap-3 px-10 py-4 bg-red-600 hover:bg-red-500 text-white rounded-2xl border border-white/10 transition-all shadow-lg hover:shadow-[0_0_30px_rgba(220,38,38,0.3)]"
                        >
                            <span className="text-xs font-black tracking-widest uppercase">Lancer Crimsons</span>
                            <Check size={14} />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
