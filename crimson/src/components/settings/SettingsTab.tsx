import { useState, useEffect } from 'react';
import { useLCU } from '../../contexts/LCUContext';
import { getVersion } from '@tauri-apps/api/app';
import { 
    Settings as SettingsIcon, Check, 
    RefreshCw, Zap,
    AlertCircle, Activity, Layout,
    Compass, Music
} from 'lucide-react';

// Reusable animated toggle component
const Toggle = ({ value, onChange, label, description, disabled }: {
    value: boolean;
    onChange: (v: boolean) => void;
    label: string;
    description?: string;
    disabled?: boolean;
}) => (
    <div className={`flex items-center justify-between py-4 border-b border-white/5 last:border-0 group ${disabled ? 'opacity-40' : ''}`}>
        <div className="flex flex-col">
            <span className="text-[11px] font-black text-white/70 uppercase tracking-widest group-hover:text-white transition-colors">{label}</span>
            {description && <span className="text-[9px] text-white/30 mt-1 uppercase font-bold tracking-tight">{description}</span>}
        </div>
        <button
            onClick={() => !disabled && onChange(!value)}
            disabled={disabled}
            className={`relative w-12 h-6 rounded-full transition-all duration-500 focus:outline-none ${disabled ? 'bg-white/5 cursor-not-allowed' : value ? 'bg-red-600 shadow-[0_0_15px_rgba(220,38,38,0.4)]' : 'bg-white/10'}`}
        >
            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-md transition-all duration-500 cubic-bezier(0.34, 1.56, 0.64, 1) ${(value && !disabled) ? 'left-7 scale-110' : 'left-1'}`} />
        </button>
    </div>
);

const SettingsTab = () => {
    const { 
        appData, updateSetting, loginSpotify,
        updateStatus, updateProgress, availableVersion, 
        checkUpdates, installUpdate,
        spotifyConnected, spotifyState
    } = useLCU();
    
    const [currentVersion, setCurrentVersion] = useState<string>('0.0.0');
    
    // Custom settings inputs — secrets stay masked once saved; editing replaces, never reveals.
    const [spotifyIdInput, setSpotifyIdInput] = useState('');
    const [spotifySecretInput, setSpotifySecretInput] = useState('');
    const [spotifyEditing, setSpotifyEditing] = useState(!(appData?.spotifyClientId && appData?.spotifyClientSecret));
    const [spotifyReplacingSecret, setSpotifyReplacingSecret] = useState(false);
    const [spotifyError, setSpotifyError] = useState<string | null>(null);

    useEffect(() => {
        if (appData) {
            const savedId = appData.spotifyClientId || spotifyState?.saved_client_id || '';
            const hasSpotifyCreds = !!(savedId && (appData.spotifyClientSecret || spotifyState?.has_credentials));
            const associated = hasSpotifyCreds || spotifyConnected || !!spotifyState?.has_token;
            if (!associated) {
                setSpotifyEditing(true);
            }
            if (!spotifyEditing) {
                setSpotifyIdInput(savedId);
                setSpotifySecretInput('');
                setSpotifyReplacingSecret(false);
            } else if (!spotifyIdInput && savedId) {
                setSpotifyIdInput(savedId);
            }
        }
    }, [appData, spotifyConnected, spotifyState?.has_token]);

    const savedSpotifyId = appData?.spotifyClientId || spotifyState?.saved_client_id || '';
    const hasSavedSecret = !!(appData?.spotifyClientSecret || spotifyState?.has_credentials);

    const resolveSpotifyCredentials = () => {
        const clientId = spotifyIdInput.trim() || savedSpotifyId;
        const clientSecret = spotifySecretInput.trim() || (appData?.spotifyClientSecret || '');
        return { clientId, clientSecret, canReuseSecret: hasSavedSecret || !!clientSecret };
    };

    const handleConnectSpotify = async () => {
        const { clientId, clientSecret, canReuseSecret } = resolveSpotifyCredentials();

        if (!clientId || (!clientSecret && !canReuseSecret)) {
            setSpotifyError("Renseignez d'abord le Client ID et le Client Secret de votre application Spotify.");
            setSpotifyEditing(true);
            return;
        }
        setSpotifyError(null);

        try {
            localStorage.removeItem('spotify_client_secret');
            localStorage.removeItem('spotify_client_id');
            await loginSpotify(clientId, clientSecret);
            setSpotifyIdInput(clientId);
            setSpotifySecretInput('');
            setSpotifyReplacingSecret(false);
            setSpotifyEditing(false);
        } catch (e) {
            console.error("Failed to open Spotify auth", e);
            setSpotifyError("Impossible d'ouvrir la page d'autorisation Spotify.");
        }
    };

    useEffect(() => {
        getVersion().then(setCurrentVersion).catch(console.error);
    }, []);

    const isSpotifyActive = Boolean(appData?.plugins?.spotify);

    return (
        <div className="w-full max-w-5xl mx-auto space-y-10 mt-12 px-8 pb-24 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-8 border-b border-white/5 pb-10">
                <div className="flex items-center gap-5">
                    <div className="p-4 bg-gradient-to-br from-red-600 to-red-800 rounded-2xl shadow-[0_0_30px_rgba(220,38,38,0.2)] border border-white/10">
                        <SettingsIcon className="w-7 h-7 text-white" />
                    </div>
                    <div>
                        <h2 className="text-3xl font-black text-white uppercase tracking-[0.15em]">Configuration</h2>
                        <div className="flex items-center gap-2 mt-1.5 font-black uppercase tracking-widest text-[10px]">
                            <span className="text-white/20">Crimsons Center</span>
                            <span className="w-1 h-1 bg-white/10 rounded-full" />
                            <span className="text-red-500/60">Version {currentVersion}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-8 animate-in slide-in-from-bottom-4 duration-700">
                <div className="space-y-8">
                    {/* UPDATE CENTER */}
                    <section className="bg-white/[0.02] border border-white/5 p-10 rounded-[2.5rem] relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                            <RefreshCw className={`w-32 h-32 text-red-500 ${updateStatus === 'checking' || updateStatus === 'installing' ? 'animate-spin' : ''}`} />
                        </div>
                        <div className="relative z-10">
                            <div className="flex items-center justify-between mb-8">
                                <div className="flex items-center gap-4">
                                    <div className="p-3 bg-red-500/10 rounded-xl">
                                        <RefreshCw className={`w-5 h-5 text-red-500 ${updateStatus === 'checking' || updateStatus === 'installing' ? 'animate-spin' : ''}`} />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-black text-white uppercase tracking-widest">Update Center</h3>
                                        <p className="text-[10px] text-white/30 font-bold uppercase tracking-widest">Maintenir Crimsons à la pointe</p>
                                    </div>
                                </div>
                                <span className="text-[10px] font-black text-white/10 uppercase tracking-widest font-mono">Channel: Production</span>
                            </div>

                            <div className="flex flex-col md:flex-row items-center gap-6 bg-black/40 p-6 rounded-3xl border border-white/5">
                                <div className="flex-1">
                                    {updateStatus === 'idle' && <p className="text-white/40 text-[11px] uppercase font-black tracking-widest">Dernière vérification: Aujourd'hui</p>}
                                    {updateStatus === 'checking' && <p className="text-red-500 text-[11px] uppercase font-black tracking-widest animate-pulse">Recherche de mise à jour...</p>}
                                    {updateStatus === 'up-to-date' && <div className="flex items-center gap-2 text-green-500 font-black uppercase tracking-widest text-[11px]"><Check className="w-4 h-4" /> Système à jour</div>}
                                    {updateStatus === 'available' && <p className="text-red-400 text-[11px] uppercase font-black tracking-widest underline decoration-2 underline-offset-4">Version {availableVersion} disponible</p>}
                                    {updateStatus === 'installing' && <p className="text-blue-400 text-[11px] uppercase font-black tracking-widest animate-pulse">Mise à jour imminente...</p>}
                                </div>
                                <div className="flex gap-4">
                                    {updateStatus === 'available' && (
                                        <button onClick={() => installUpdate()} className="px-8 py-3 bg-red-600 hover:bg-red-500 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-[0_0_20px_rgba(239,68,68,0.3)]">
                                            Installer
                                        </button>
                                    )}
                                    {updateStatus === 'installing' && (
                                        <div className="flex items-center gap-4 bg-white/5 px-6 py-3 rounded-xl border border-white/5">
                                            <div className="w-24 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                                <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${updateProgress}%` }} />
                                            </div>
                                            <span className="text-[10px] font-black text-blue-400">{updateProgress}%</span>
                                        </div>
                                    )}
                                    {(updateStatus === 'idle' || updateStatus === 'up-to-date' || updateStatus === 'checking') && (
                                        <button onClick={checkUpdates} disabled={updateStatus === 'checking'} className="px-8 py-3 bg-white/5 hover:bg-white/10 text-white/60 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all">
                                            Vérifier
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </section>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* APP BEHAVIOR */}
                        <div className="bg-white/[0.02] border border-white/5 p-10 rounded-[2.5rem] flex flex-col justify-between">
                            <div>
                                <div className="flex items-center gap-4 mb-8">
                                    <div className="p-3 bg-red-500/10 rounded-xl">
                                        <Zap className="w-5 h-5 text-red-500" />
                                    </div>
                                    <h3 className="text-sm font-black text-white uppercase tracking-widest font-mono">App Behavior</h3>
                                </div>
                                <Toggle
                                    label="Soft Exit"
                                    description="Minimiser vers le Tray au lieu de quitter"
                                    value={appData?.closeToTray ?? false}
                                    onChange={(v) => updateSetting('closeToTray', v)}
                                />
                            </div>
                        </div>

                        {/* VISUAL EXPERIENCE */}
                        <div className="bg-white/[0.02] border border-white/5 p-10 rounded-[2.5rem]">
                            <div className="flex items-center gap-4 mb-8">
                                <div className="p-3 bg-red-500/10 rounded-xl">
                                    <Layout className="w-5 h-5 text-red-500" />
                                </div>
                                <h3 className="text-sm font-black text-white uppercase tracking-widest font-mono">Aesthetics</h3>
                            </div>
                            <Toggle
                                label="High Fidelity"
                                description="Effets de flou et transparence premium"
                                value={appData?.darkGlassMode ?? true}
                                onChange={(v) => updateSetting('darkGlassMode', v)}
                            />
                            <Toggle
                                label="Low Latency UI"
                                description="Désactiver les animations secondaires"
                                value={appData?.reducedAnimations ?? false}
                                onChange={(v) => updateSetting('reducedAnimations', v)}
                            />
                        </div>

                        {/* SPOTIFY — identifiants propres a chaque utilisateur (masqué si plugin inactif) */}
                        {isSpotifyActive && (
                            <div className="md:col-span-2 bg-white/[0.02] border border-white/5 p-10 rounded-[2.5rem] space-y-6">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 bg-green-500/10 rounded-xl text-green-500">
                                            <Music className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <h3 className="text-sm font-black text-white uppercase tracking-widest font-mono">Spotify</h3>
                                            <span className="text-[9px] text-white/30 font-bold uppercase tracking-widest">Votre application, vos identifiants</span>
                                        </div>
                                    </div>
                                    <div className={`flex items-center gap-2.5 px-4 py-1.5 rounded-full border ${(spotifyConnected || spotifyState?.has_token) ? 'bg-green-500/10 border-green-500/20 text-green-500' : 'bg-white/5 border-white/10 text-white/40'}`}>
                                        <Activity className={`w-3.5 h-3.5 ${(spotifyConnected || spotifyState?.has_token) ? 'animate-pulse' : ''}`} />
                                        <span className="text-[10px] font-black uppercase tracking-tighter">{(spotifyConnected || spotifyState?.has_token) ? 'Connecté' : 'Non connecté'}</span>
                                    </div>
                                </div>

                                {(spotifyConnected || spotifyState?.has_token) && !spotifyEditing ? (
                                    <>
                                        <p className="text-[10px] text-white/40 leading-relaxed uppercase tracking-wider font-semibold">
                                            Identifiants enregistrés. Activez Spotify dans l’onglet Hub pour StreamDock.
                                        </p>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={handleConnectSpotify}
                                                className="flex-1 py-3 bg-green-600/80 hover:bg-green-500 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all"
                                            >
                                                Reconnecter Spotify
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setSpotifyEditing(true);
                                                    setSpotifyIdInput(savedSpotifyId);
                                                    setSpotifySecretInput('');
                                                    setSpotifyReplacingSecret(false);
                                                }}
                                                className="px-4 py-3 bg-white/5 hover:bg-white/10 text-white/60 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all border border-white/5"
                                            >
                                                Identifiants
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <p className="text-[10px] text-white/40 leading-relaxed uppercase tracking-wider font-semibold">
                                            Setup une seule fois : 1) créer une app sur le dashboard Spotify Developer · 2) y déclarer l’URL de redirection · 3) coller Client ID / Secret · 4) Associer. Contrôle StreamDock = Premium.
                                        </p>

                                        <div className="flex items-center justify-between gap-4 bg-black/40 border border-white/5 px-4 py-3 rounded-xl">
                                            <span className="text-[9px] font-black text-white/40 uppercase tracking-widest shrink-0">URL de redirection à déclarer</span>
                                            <code className="text-[10px] font-mono text-white/70 truncate">http://127.0.0.1:40510/callback</code>
                                        </div>

                                        <div className="flex flex-col gap-2">
                                            <div className="flex justify-between items-center pl-2">
                                                <label className="text-[9px] font-black text-white/40 uppercase tracking-widest">Client ID</label>
                                                <a
                                                    href="https://developer.spotify.com/dashboard"
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="text-red-500 hover:text-red-400 text-[8px] font-black uppercase tracking-widest transition-colors flex items-center gap-1"
                                                >
                                                    <Compass size={10} /> Créer une application
                                                </a>
                                            </div>
                                            <input
                                                type="text"
                                                value={spotifyIdInput}
                                                onChange={(e) => setSpotifyIdInput(e.target.value)}
                                                placeholder="Client ID de votre application Spotify..."
                                                autoComplete="off"
                                                spellCheck={false}
                                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-[10px] font-mono text-white outline-none focus:border-red-600 transition-colors"
                                            />
                                        </div>

                                        <div className="flex flex-col gap-2">
                                            <label className="text-[9px] font-black text-white/40 uppercase tracking-widest pl-2">Client Secret</label>
                                            {hasSavedSecret && !spotifyReplacingSecret ? (
                                                <div className="flex gap-2 items-center">
                                                    <div className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-[10px] font-mono text-white/50 uppercase tracking-widest">
                                                        Enregistré
                                                    </div>
                                                    <button
                                                        onClick={() => {
                                                             setSpotifyReplacingSecret(true);
                                                             setSpotifySecretInput('');
                                                        }}
                                                        className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all border border-white/5"
                                                        type="button"
                                                    >
                                                        Remplacer
                                                    </button>
                                                </div>
                                            ) : (
                                                <input
                                                    type="password"
                                                    value={spotifySecretInput}
                                                    onChange={(e) => setSpotifySecretInput(e.target.value)}
                                                    placeholder={hasSavedSecret ? 'Nouveau secret… (vide = conserver)' : 'Client Secret de votre application Spotify...'}
                                                    autoComplete="off"
                                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-[10px] font-mono text-white outline-none focus:border-red-600 transition-colors"
                                                />
                                            )}
                                        </div>

                                        {spotifyError && (
                                            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 px-4 py-3 rounded-xl text-[9px] font-black text-red-400 uppercase tracking-widest">
                                                <AlertCircle size={12} className="shrink-0" />
                                                {spotifyError}
                                            </div>
                                        )}

                                        <div className="flex gap-2">
                                            <button
                                                onClick={handleConnectSpotify}
                                                disabled={!resolveSpotifyCredentials().clientId || !resolveSpotifyCredentials().canReuseSecret}
                                                className="flex-1 py-3 bg-green-600 hover:bg-green-500 disabled:bg-white/5 disabled:text-white/30 disabled:cursor-not-allowed text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all"
                                            >
                                                {(spotifyConnected || spotifyState?.has_token) ? 'Reconnecter Spotify' : 'Associer Spotify'}
                                            </button>
                                            {(spotifyConnected || spotifyState?.has_token) && (
                                                <button
                                                    onClick={() => setSpotifyEditing(false)}
                                                    className="px-4 py-3 bg-white/5 hover:bg-white/10 text-white/60 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all border border-white/5"
                                                >
                                                    Annuler
                                                </button>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsTab;