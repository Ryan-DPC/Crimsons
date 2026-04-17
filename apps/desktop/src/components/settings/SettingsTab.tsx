import { useState, useEffect } from 'react';
import { useLCU } from '../../contexts/LCUContext';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { Settings as SettingsIcon, Shield, Bell, Eye, Cpu, Check, Loader2, RefreshCw, Download, Zap, Music } from 'lucide-react';

// Reusable animated toggle component
const Toggle = ({ value, onChange, label, description }: {
    value: boolean;
    onChange: (v: boolean) => void;
    label: string;
    description?: string;
}) => (
    <div className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
        <div className="flex flex-col">
            <span className="text-[11px] font-bold text-white/70 uppercase tracking-widest">{label}</span>
            {description && <span className="text-[9px] text-white/30 mt-0.5">{description}</span>}
        </div>
        <button
            onClick={() => onChange(!value)}
            className={`relative w-10 h-5 rounded-full transition-all duration-300 focus:outline-none ${value ? 'bg-red-600 shadow-[0_0_10px_rgba(220,38,38,0.4)]' : 'bg-white/10'}`}
        >
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-md transition-all duration-300 ${value ? 'left-5' : 'left-0.5'}`} />
        </button>
    </div>
);

const SettingsTab = () => {
    const { 
        appData, updateGeminiKey, updateSetting,
        updateStatus, updateProgress, availableVersion, 
        checkUpdates, installUpdate
    } = useLCU();
    const [keyInput, setKeyInput] = useState(appData?.geminiApiKey || '');
    const [status, setStatus] = useState<'idle' | 'loading' | 'success'>('idle');
    const [isEditingKey, setIsEditingKey] = useState(!appData?.geminiApiKey);
    const [currentVersion, setCurrentVersion] = useState<string>('0.0.0');
    const { spotifyConnected, spotifyState, loginSpotify } = useLCU();
    const [spotifyClientId, setSpotifyClientId] = useState(appData?.spotifyClientId || '');
    const [spotifyClientSecret, setSpotifyClientSecret] = useState(appData?.spotifyClientSecret || '');

    useEffect(() => {
        getVersion().then(setCurrentVersion).catch(console.error);
    }, []);

    useEffect(() => {
        if (appData?.geminiApiKey) {
            setKeyInput(appData.geminiApiKey);
            setIsEditingKey(false);
        }
    }, [appData?.geminiApiKey]);

    const handleVerify = () => {
        setStatus('loading');
        updateGeminiKey(keyInput);
        setTimeout(() => {
            setStatus('success');
            setTimeout(() => setStatus('idle'), 3000);
        }, 800);
    };

    return (
        <div className="w-full max-w-4xl mx-auto space-y-8 mt-12 px-8 animate-in fade-in duration-700">
            <div className="flex items-center gap-4 mb-8">
                <div className="p-3 bg-red-600/10 rounded-2xl border border-red-500/20">
                    <SettingsIcon className="w-6 h-6 text-red-500" />
                </div>
                <div>
                    <h2 className="text-2xl font-black text-white uppercase tracking-widest">Paramètres</h2>
                    <p className="text-white/30 text-xs font-bold uppercase tracking-widest mt-1">Configuration globale de Crimson</p>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6">
                {/* AI Configuration */}
                <div className="bg-[#111115] border border-white/5 p-8 rounded-2xl shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-5">
                        <Cpu className="w-24 h-24" />
                    </div>
                    <div className="relative z-10">
                        <div className="flex items-center gap-3 mb-6">
                            <Shield className={`w-5 h-5 ${!isEditingKey ? 'text-green-500' : 'text-red-500'}`} />
                            <h3 className="text-sm font-black text-white uppercase tracking-widest">Intelligence Artificielle</h3>
                        </div>
                        <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-6 leading-relaxed max-w-md">
                            Clé API Gemini pour les analyses de draft en temps réel et les suggestions de runes dynamiques.
                        </p>
                        <div className="flex flex-col gap-2 max-w-lg">
                            <label className="text-[9px] text-white/20 uppercase font-black tracking-widest mb-1">Google Gemini API Key</label>
                            {!isEditingKey ? (
                                <div className="flex items-center gap-3 w-full bg-green-500/10 border border-green-500/20 px-4 py-3 rounded-xl cursor-pointer group" onClick={() => setIsEditingKey(true)}>
                                    <div className="flex-1 text-green-500/80 text-xs font-mono tracking-widest">••••••••••••••••••••••••••••••••••</div>
                                    <div className="flex items-center gap-2 text-green-500">
                                        <span className="text-[10px] font-black uppercase tracking-widest group-hover:text-green-400">Opérationnelle</span>
                                        <Check className="w-4 h-4" />
                                    </div>
                                </div>
                            ) : (
                                <div className="flex gap-3 w-full">
                                    <input 
                                        type="password"
                                        value={keyInput}
                                        onChange={(e) => setKeyInput(e.target.value)}
                                        placeholder="COLLEZ VOTRE CLÉ ICI..."
                                        className="flex-1 bg-black/40 border border-white/5 px-4 py-3 text-xs font-mono focus:border-red-500/50 outline-none text-white/50 transition-all rounded-xl"
                                    />
                                    <button 
                                        onClick={handleVerify}
                                        disabled={status === 'loading' || !keyInput}
                                        className={`px-6 flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${
                                            status === 'success' ? 'bg-green-600/20 text-green-500 border border-green-500/30' : 
                                            'bg-white/5 hover:bg-white/10 border border-white/10 text-white/60'
                                        }`}
                                    >
                                        {status === 'loading' && <Loader2 className="w-4 h-4 animate-spin" />}
                                        {status === 'success' && <Check className="w-4 h-4" />}
                                        {status === 'idle' ? "Vérifier" : status === 'success' ? "Sauvegardé" : "Vérifier"}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Mises à Jour */}
                <div className="bg-[#111115] border border-white/5 p-8 rounded-2xl shadow-2xl">
                    <div className="flex items-center gap-3 mb-6">
                        <RefreshCw className={`w-5 h-5 text-red-500 ${updateStatus === 'checking' || updateStatus === 'installing' ? 'animate-spin' : ''}`} />
                        <h3 className="text-sm font-black text-white uppercase tracking-widest">Mises à Jour</h3>
                        <span className="ml-auto text-[9px] font-black text-white/20 uppercase tracking-widest">v{currentVersion}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <div>
                            {updateStatus === 'idle' && <p className="text-white/30 text-[10px] uppercase font-bold tracking-widest">Vérifiez si une nouvelle version est disponible.</p>}
                            {updateStatus === 'checking' && <p className="text-white/50 text-[10px] uppercase font-bold tracking-widest animate-pulse">Vérification en cours...</p>}
                            {updateStatus === 'up-to-date' && <p className="text-green-500 text-[10px] uppercase font-black tracking-widest">✓ Vous êtes à jour !</p>}
                            {updateStatus === 'available' && <p className="text-red-400 text-[10px] uppercase font-black tracking-widest">🚀 Version <span className="text-white">{availableVersion}</span> disponible !</p>}
                            {updateStatus === 'installing' && <p className="text-blue-400 text-[10px] uppercase font-black tracking-widest animate-pulse">Téléchargement... L'app va redémarrer automatiquement.</p>}
                        </div>
                        <div className="flex gap-3 items-center">
                            {updateStatus === 'available' && (
                                <button onClick={() => installUpdate()} className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-500 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-[0_0_15px_rgba(239,68,68,0.3)]">
                                    <Download className="w-3.5 h-3.5" /> Installer
                                </button>
                            )}
                            {updateStatus === 'installing' && (
                                <div className="flex items-center justify-center relative w-10 h-10 ml-4">
                                    <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                                        <path
                                            className="text-white/10"
                                            strokeWidth="3.5" stroke="currentColor" fill="none"
                                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                        />
                                        <path
                                            className="text-red-500 transition-all duration-300"
                                            strokeDasharray={`${updateProgress}, 100`}
                                            strokeWidth="3.5" stroke="currentColor" fill="none" strokeLinecap="round"
                                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                        />
                                    </svg>
                                    <span className="absolute text-[9px] font-black tracking-tighter text-white">{updateProgress}%</span>
                                </div>
                            )}
                            {(updateStatus === 'idle' || updateStatus === 'up-to-date' || updateStatus === 'checking') && (
                                <button onClick={checkUpdates} disabled={updateStatus === 'checking'} className="flex items-center gap-2 px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white/60 hover:text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all">
                                    <RefreshCw className={`w-3.5 h-3.5 ${updateStatus === 'checking' ? 'animate-spin' : ''}`} /> Vérifier
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Notifications & Automation */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-[#111115] border border-white/5 p-8 rounded-2xl shadow-2xl">
                        <div className="flex items-center gap-3 mb-6">
                            <Bell className="w-5 h-5 text-red-500" />
                            <h3 className="text-sm font-black text-white uppercase tracking-widest">Automation</h3>
                        </div>
                        <div>
                            <Toggle
                                label="Auto-Accept"
                                description="Accepte automatiquement les matchs"
                                value={appData?.autoAccept ?? true}
                                onChange={(v) => updateSetting('autoAccept', v)}
                            />
                            <Toggle
                                label="Lancer au démarrage"
                                description="Lance Crimson au démarrage de Windows"
                                value={appData?.launchOnStartup ?? false}
                                onChange={async (v) => {
                                    await invoke('crimson_toggle_autostart', { enable: v });
                                    updateSetting('launchOnStartup', v);
                                }}
                            />
                            <Toggle
                                label="Draft Warnings"
                                description="Alertes sur les mauvais picks alliés"
                                value={appData?.draftWarnings ?? true}
                                onChange={(v) => updateSetting('draftWarnings', v)}
                            />
                            <Toggle
                                label="Automation Invisible"
                                description="Ne pas ouvrir l'app en Draft (Consommation Réduite)"
                                value={appData?.invisibleAutomation ?? false}
                                onChange={(v) => updateSetting('invisibleAutomation', v)}
                            />
                        </div>
                    </div>

                    <div className="bg-[#111115] border border-white/5 p-8 rounded-2xl shadow-2xl">
                        <div className="flex items-center gap-3 mb-6">
                            <Eye className="w-5 h-5 text-red-500" />
                            <h3 className="text-sm font-black text-white uppercase tracking-widest">Interface</h3>
                        </div>
                        <div>
                            <Toggle
                                label="Dark Glass Mode"
                                description="Design glassmorphism premium"
                                value={appData?.darkGlassMode ?? true}
                                onChange={(v) => updateSetting('darkGlassMode', v)}
                            />
                            <Toggle
                                label="Animations Réduites"
                                description="Désactive les effets de transition"
                                value={appData?.reducedAnimations ?? false}
                                onChange={(v) => updateSetting('reducedAnimations', v)}
                            />
                            <Toggle
                                label="Fermer dans la zone de notification"
                                description="Minimiser l'application avec la croix au lieu de la quitter"
                                value={appData?.closeToTray ?? false}
                                onChange={(v) => updateSetting('closeToTray', v)}
                            />
                        </div>
                    </div>
                </div>

                {/* Spotify Integration */}
                <div className="bg-[#111115] border border-white/5 p-8 rounded-2xl shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-5">
                        <Music className="w-24 h-24" />
                    </div>
                    <div className="relative z-10">
                        <div className="flex items-center gap-3 mb-6">
                            <Music className={`w-5 h-5 ${spotifyConnected ? 'text-green-500' : 'text-red-500'}`} />
                            <h3 className="text-sm font-black text-white uppercase tracking-widest">Spotify Integration</h3>
                        </div>
                        <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-6 leading-relaxed max-w-md">
                            Connectez votre compte Spotify pour contrôler votre musique directement depuis Crimson et Stream Dock.
                        </p>
                        
                        {!spotifyConnected ? (
                            <div className="space-y-4 max-w-lg">
                                <div className="grid grid-cols-1 gap-4">
                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-[9px] text-white/20 uppercase font-black tracking-widest">Client ID</label>
                                        <input 
                                            type="text"
                                            value={spotifyClientId}
                                            onChange={(e) => setSpotifyClientId(e.target.value)}
                                            placeholder="SPOTIFY CLIENT ID..."
                                            className="bg-black/40 border border-white/5 px-4 py-2.5 text-xs font-mono focus:border-red-500/50 outline-none text-white/50 transition-all rounded-xl"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-[9px] text-white/20 uppercase font-black tracking-widest">Client Secret</label>
                                        <input 
                                            type="password"
                                            value={spotifyClientSecret}
                                            onChange={(e) => setSpotifyClientSecret(e.target.value)}
                                            placeholder="SPOTIFY CLIENT SECRET..."
                                            className="bg-black/40 border border-white/5 px-4 py-2.5 text-xs font-mono focus:border-red-500/50 outline-none text-white/50 transition-all rounded-xl"
                                        />
                                    </div>
                                </div>
                                <button 
                                    onClick={() => loginSpotify(spotifyClientId, spotifyClientSecret)}
                                    className="w-full py-3 bg-red-600 hover:bg-red-500 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-[0_0_15px_rgba(239,68,68,0.2)]"
                                >
                                    Connexion avec Spotify
                                </button>
                                <p className="text-[8px] text-white/10 uppercase tracking-widest text-center">
                                    Redirection vers accounts.spotify.com
                                </p>
                            </div>
                        ) : (
                            <div className="flex items-center gap-4 bg-green-500/5 border border-green-500/10 p-4 rounded-2xl max-w-lg">
                                {spotifyState?.album_art && (
                                    <img src={spotifyState.album_art} alt="Cover" className="w-12 h-12 rounded-lg shadow-lg" />
                                )}
                                <div className="flex-1 min-w-0">
                                    <p className="text-[10px] font-black text-white truncate uppercase tracking-widest">{spotifyState?.track_name || 'En attente...'}</p>
                                    <p className="text-[9px] text-white/30 truncate uppercase font-bold tracking-widest">{spotifyState?.artist_name || 'Spotify Connecté'}</p>
                                </div>
                                <div className="flex items-center gap-2 px-3 py-1 bg-green-500/20 rounded-full border border-green-500/30">
                                    <span className="text-[8px] font-black text-green-500 uppercase tracking-widest font-mono">LIVE</span>
                                    <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* About */}
                <div className="bg-[#111115] border border-white/5 p-6 rounded-2xl shadow-2xl">
                    <div className="flex items-center gap-4">
                        <div className="p-2 bg-black rounded-full border border-white/10">
                            <Zap className="w-5 h-5 text-red-500 fill-red-500/20" />
                        </div>
                        <div>
                            <p className="text-xs font-black text-white/50 uppercase tracking-widest">Crimson • v{currentVersion}</p>
                            <p className="text-[9px] text-white/20 uppercase tracking-widest mt-0.5">by Ryan — Powered by Tauri + Rust + React</p>
                        </div>
                        <a 
                            href="https://github.com/Ryan-DPC/Crimson" 
                            target="_blank"
                            rel="noreferrer"
                            className="ml-auto text-[9px] font-black text-white/20 hover:text-white/60 uppercase tracking-widest transition-colors"
                        >
                            GitHub →
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsTab;
