import { useState, useEffect } from 'react';
import { useLCU } from '../../contexts/LCUContext';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { 
    Settings as SettingsIcon, Shield, Cpu, Check, 
    Loader2, RefreshCw, Zap, Power, 
    AlertCircle, Activity, Layout, Terminal
} from 'lucide-react';

// Reusable animated toggle component
const Toggle = ({ value, onChange, label, description }: {
    value: boolean;
    onChange: (v: boolean) => void;
    label: string;
    description?: string;
}) => (
    <div className="flex items-center justify-between py-4 border-b border-white/5 last:border-0 group">
        <div className="flex flex-col">
            <span className="text-[11px] font-black text-white/70 uppercase tracking-widest group-hover:text-white transition-colors">{label}</span>
            {description && <span className="text-[9px] text-white/30 mt-1 uppercase font-bold tracking-tight">{description}</span>}
        </div>
        <button
            onClick={() => onChange(!value)}
            className={`relative w-12 h-6 rounded-full transition-all duration-500 focus:outline-none ${value ? 'bg-red-600 shadow-[0_0_15px_rgba(220,38,38,0.4)]' : 'bg-white/10'}`}
        >
            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-md transition-all duration-500 cubic-bezier(0.34, 1.56, 0.64, 1) ${value ? 'left-7 scale-110' : 'left-1'}`} />
        </button>
    </div>
);

const SettingsTab = () => {
    const { 
        appData, updateGeminiKey, updateSetting,
        updateStatus, updateProgress, availableVersion, 
        checkUpdates, installUpdate, serverConnected, 
        discordConnected, discordState
    } = useLCU();
    
    const [activeTab, setActiveTab] =useState<'app' | 'server'>('app');
    const [keyInput, setKeyInput] = useState(appData?.geminiApiKey || '');
    const [verifyStatus, setVerifyStatus] = useState<'idle' | 'loading' | 'success'>('idle');
    const [isEditingKey, setIsEditingKey] = useState(!appData?.geminiApiKey);
    const [currentVersion, setCurrentVersion] = useState<string>('0.0.0');
    const [isRestarting, setIsRestarting] = useState(false);

    useEffect(() => {
        getVersion().then(setCurrentVersion).catch(console.error);
    }, []);

    useEffect(() => {
        if (appData?.geminiApiKey) {
            setKeyInput(appData.geminiApiKey);
            setIsEditingKey(false);
        }
    }, [appData?.geminiApiKey]);

    const handleVerifyKey = () => {
        setVerifyStatus('loading');
        updateGeminiKey(keyInput);
        setTimeout(() => {
            setVerifyStatus('success');
            setTimeout(() => setVerifyStatus('idle'), 3000);
        }, 800);
    };

    const handleRestartServer = async () => {
        setIsRestarting(true);
        try {
            await invoke('crimson_restart_server');
        } catch (e) {
            console.error(e);
        }
        setTimeout(() => setIsRestarting(false), 2000);
    };

    return (
        <div className="w-full max-w-5xl mx-auto space-y-10 mt-12 px-8 pb-24 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            {/* Header with Premium Tab Switcher */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-8 border-b border-white/5 pb-10">
                <div className="flex items-center gap-5">
                    <div className="p-4 bg-gradient-to-br from-red-600 to-red-800 rounded-2xl shadow-[0_0_30px_rgba(220,38,38,0.2)] border border-white/10">
                        <SettingsIcon className="w-7 h-7 text-white" />
                    </div>
                    <div>
                        <h2 className="text-3xl font-black text-white uppercase tracking-[0.15em]">Configuration</h2>
                        <div className="flex items-center gap-2 mt-1.5 font-black uppercase tracking-widest text-[10px]">
                            <span className="text-white/20">Crimson Center</span>
                            <span className="w-1 h-1 bg-white/10 rounded-full" />
                            <span className="text-red-500/60">Version {currentVersion}</span>
                        </div>
                    </div>
                </div>

                {/* Sliding Pill Tab Switcher */}
                <div className="relative flex p-1.5 bg-white/5 rounded-2xl border border-white/10 backdrop-blur-xl w-fit">
                    {/* Sliding Indicator */}
                    <div 
                        className={`absolute top-1.5 bottom-1.5 left-1.5 w-[calc(50%-6px)] bg-red-600 rounded-xl transition-all duration-500 shadow-lg shadow-red-900/20 pointer-events-none ${activeTab === 'server' ? 'translate-x-full' : 'translate-x-0'}`}
                    />
                    <button 
                        onClick={() => setActiveTab('app')}
                        className={`relative z-10 px-8 py-3 text-[11px] font-black uppercase tracking-widest transition-colors duration-300 ${activeTab === 'app' ? 'text-white' : 'text-white/30 hover:text-white/50'}`}
                    >
                        Crimson
                    </button>
                    <button 
                        onClick={() => setActiveTab('server')}
                        className={`relative z-10 px-8 py-3 text-[11px] font-black uppercase tracking-widest transition-colors duration-300 ${activeTab === 'server' ? 'text-white' : 'text-white/30 hover:text-white/50'}`}
                    >
                        Serveur
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-8 animate-in slide-in-from-bottom-4 duration-700">
                {activeTab === 'app' ? (
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
                                            <p className="text-[10px] text-white/30 font-bold uppercase tracking-widest">Maintenir Crimson à la pointe</p>
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
                            <div className="bg-white/[0.02] border border-white/5 p-10 rounded-[2.5rem]">
                                <div className="flex items-center gap-4 mb-8">
                                    <div className="p-3 bg-red-500/10 rounded-xl">
                                        <Zap className="w-5 h-5 text-red-500" />
                                    </div>
                                    <h3 className="text-sm font-black text-white uppercase tracking-widest font-mono">App Behavior</h3>
                                </div>
                                <Toggle
                                    label="Auto-Wake UI"
                                    description="Ouvrir Crimson au démarrage de Windows"
                                    value={appData?.launchOnStartup ?? false}
                                    onChange={async (v) => {
                                        await invoke('crimson_toggle_autostart', { enable: v });
                                        updateSetting('launchOnStartup', v);
                                    }}
                                />
                                <Toggle
                                    label="Soft Exit"
                                    description="Minimiser vers le Tray au lieu de quitter"
                                    value={appData?.closeToTray ?? false}
                                    onChange={(v) => updateSetting('closeToTray', v)}
                                />
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
                        </div>
                    </div>
                ) : (
                    <div className="space-y-8 animate-in slide-in-from-right-4 duration-500">
                        {/* SERVER STATUS CARD */}
                        <section className="grid grid-cols-1 md:grid-cols-3 gap-8">
                            <div className="md:col-span-2 bg-white/[0.02] border border-white/5 p-8 rounded-[2.5rem] flex flex-col justify-between">
                                <div className="flex items-center justify-between mb-8">
                                    <div className="flex items-center gap-4 font-black uppercase tracking-widest">
                                        <div className="p-3 bg-red-500/10 rounded-xl">
                                            <Power className="w-5 h-5 text-red-500" />
                                        </div>
                                        <div>
                                            <h3 className="text-sm text-white">Phantom Engine</h3>
                                            <span className="text-[9px] text-white/30">Background Automation Core</span>
                                        </div>
                                    </div>
                                    <div className={`flex items-center gap-2.5 px-4 py-1.5 rounded-full border ${serverConnected ? 'bg-green-500/10 border-green-500/20 text-green-500 shadow-[0_0_20px_rgba(34,197,94,0.1)]' : 'bg-red-500/10 border-red-500/20 text-red-500'}`}>
                                        <Activity className={`w-3.5 h-3.5 ${serverConnected ? 'animate-pulse' : ''}`} />
                                        <span className="text-[10px] font-black uppercase tracking-tighter">{serverConnected ? 'En Ligne' : 'Hors Ligne'}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4">
                                    <button 
                                        onClick={handleRestartServer}
                                        disabled={isRestarting}
                                        className="flex-1 flex items-center justify-center gap-2.5 bg-white/5 hover:bg-white/10 border border-white/5 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest text-white/60 hover:text-white transition-all active:scale-[0.98] disabled:opacity-50"
                                    >
                                        <Terminal className={`w-4 h-4 ${isRestarting ? 'animate-spin' : ''}`} />
                                        {isRestarting ? 'Redémarrage...' : 'Redémarrer le Moteur'}
                                    </button>
                                </div>
                            </div>

                            <div className="bg-white/[0.02] border border-white/5 p-8 rounded-[2.5rem] flex flex-col gap-6">
                                <div className="flex items-center gap-3">
                                    <AlertCircle className="w-4 h-4 text-red-500/50" />
                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-white/40">Persistence</h4>
                                </div>
                                <Toggle
                                    label="Mode Fantôme"
                                    description="Serveur actif sans Crimson"
                                    value={appData?.serverLaunchOnStartup ?? false}
                                    onChange={async (v) => {
                                        await invoke('crimson_toggle_server_autostart', { enable: v });
                                        updateSetting('serverLaunchOnStartup', v);
                                    }}
                                />
                            </div>
                        </section>

                        {/* SERVICE MODULES */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-white">
                            <div className="bg-white/[0.02] border border-white/5 p-10 rounded-[2.5rem]">
                                <div className="flex items-center gap-4 mb-8">
                                    <div className="p-3 bg-red-500/10 rounded-xl">
                                        <Shield className="w-5 h-5 text-red-500" />
                                    </div>
                                    <h3 className="text-sm font-black uppercase tracking-widest font-mono">Automation</h3>
                                </div>
                                <Toggle
                                    label="Auto-Accept Logic"
                                    description="Accepte instantanément les matchs"
                                    value={appData?.autoAccept ?? true}
                                    onChange={(v) => updateSetting('autoAccept', v)}
                                />
                                <Toggle
                                    label="Invisible Scans"
                                    description="Optimise le CPU pendant la draft"
                                    value={appData?.invisibleAutomation ?? false}
                                    onChange={(v) => updateSetting('invisibleAutomation', v)}
                                />
                            </div>

                            <div className="bg-white/[0.02] border border-white/5 p-10 rounded-[2.5rem]">
                                <div className="flex items-center gap-4 mb-8">
                                    <div className="p-3 bg-red-500/10 rounded-xl">
                                        <Terminal className="w-5 h-5 text-red-500" />
                                    </div>
                                    <h3 className="text-sm font-black uppercase tracking-widest font-mono">Draft Shield</h3>
                                </div>
                                <Toggle
                                    label="Draft Warnings"
                                    description="Alertes sonores et visuelles sur les picks"
                                    value={appData?.draftWarnings ?? true}
                                    onChange={(v) => updateSetting('draftWarnings', v)}
                                />
                            </div>
                        </div>

                        {/* AI & EXTERNAL SERVICES */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="bg-[#111115] border border-white/5 p-10 rounded-[2.5rem] relative overflow-hidden group">
                                <div className="absolute -top-12 -right-12 p-8 opacity-5 group-hover:opacity-10 transition-all duration-700">
                                    <Cpu className="w-48 h-48" />
                                </div>
                                <div className="relative z-10">
                                    <div className="flex items-center gap-4 mb-8">
                                        <div className={`p-3 rounded-xl ${!isEditingKey ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                                            <Cpu className={`w-5 h-5 ${!isEditingKey ? 'text-green-500' : 'text-red-500'}`} />
                                        </div>
                                        <h3 className="text-sm font-black uppercase tracking-widest">Neural Network</h3>
                                    </div>
                                    <p className="text-white/30 text-[10px] font-bold uppercase tracking-wider mb-8 max-w-xs leading-relaxed">
                                        Intégration Gemini pour l'analyse prédictive et les builds dynamiques.
                                    </p>
                                    <div className="flex gap-3">
                                        {!isEditingKey ? (
                                            <div className="flex items-center gap-4 w-full bg-green-500/5 border border-green-500/10 px-5 py-4 rounded-2xl cursor-pointer group/key" onClick={() => setIsEditingKey(true)}>
                                                <div className="flex-1 text-green-500/50 text-xs font-mono tracking-widest truncate group-hover/key:text-green-500 transition-colors">••••••••••••••••••••••••</div>
                                                <Check className="w-4 h-4 text-green-500" />
                                            </div>
                                        ) : (
                                            <>
                                                <input 
                                                    type="password"
                                                    value={keyInput}
                                                    onChange={(e) => setKeyInput(e.target.value)}
                                                    placeholder="GOOGLE API KEY..."
                                                    className="flex-1 bg-black/60 border border-white/5 px-5 py-4 text-xs font-mono focus:border-red-500/50 outline-none text-white/50 rounded-2xl shadow-inner"
                                                />
                                                <button 
                                                    onClick={handleVerifyKey}
                                                    className="px-8 bg-red-600 hover:bg-red-500 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl transition-all shadow-lg shadow-red-900/40"
                                                >
                                                    {verifyStatus === 'loading' ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Verify"}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="bg-[#111115] border border-white/5 p-10 rounded-[2.5rem] relative overflow-hidden group">
                                <div className="absolute -top-12 -right-12 p-8 opacity-5 group-hover:opacity-10 transition-all duration-700">
                                    <Shield className="w-48 h-48" />
                                </div>
                                <div className="relative z-10">
                                    <div className="flex items-center gap-4 mb-8">
                                        <div className={`p-3 rounded-xl ${discordConnected ? 'bg-[#5865F2]/10' : 'bg-red-500/10'}`}>
                                            <Shield className={`w-5 h-5 ${discordConnected ? 'text-[#5865F2]' : 'text-red-500'}`} />
                                        </div>
                                        <h3 className="text-sm font-black uppercase tracking-widest">Communication Node</h3>
                                    </div>
                                    <p className="text-white/30 text-[10px] font-bold uppercase tracking-wider mb-8 max-w-xs leading-relaxed">
                                        Interface Discord RPC pour le contrôle vocal et le retour d'état StreamDock.
                                    </p>
                                    
                                    {!discordConnected ? (
                                        <div className="flex items-center gap-3 p-4 bg-red-500/5 border border-red-500/10 rounded-2xl">
                                            <AlertCircle className="w-4 h-4 text-red-500/50" />
                                            <span className="text-[10px] font-black text-red-500/50 uppercase tracking-widest">Discord Non Détecté</span>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-3 gap-3">
                                            <div className="flex flex-col items-center gap-2 p-3 bg-white/5 border border-white/10 rounded-xl">
                                                <div className={`w-2 h-2 rounded-full ${discordState?.is_muted ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]' : 'bg-green-500 animate-pulse'}`} />
                                                <span className="text-[8px] font-black uppercase text-white/40">Mic</span>
                                            </div>
                                            <div className="flex flex-col items-center gap-2 p-3 bg-white/5 border border-white/10 rounded-xl">
                                                <div className={`w-2 h-2 rounded-full ${discordState?.is_deaf ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]' : 'bg-green-500 animate-pulse'}`} />
                                                <span className="text-[8px] font-black uppercase text-white/40">Deafen</span>
                                            </div>
                                            <div className="flex flex-col items-center gap-2 p-3 bg-white/5 border border-white/10 rounded-xl">
                                                <div className={`w-2 h-2 rounded-full ${discordState?.is_camera_on ? 'bg-green-500 animate-pulse' : 'bg-red-500/20'}`} />
                                                <span className="text-[8px] font-black uppercase text-white/40">Video</span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SettingsTab;
