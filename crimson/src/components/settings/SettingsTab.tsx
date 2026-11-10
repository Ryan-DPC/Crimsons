import { useState, useEffect } from 'react';
import { useLCU } from '../../contexts/LCUContext';
import { useAuth } from '../../contexts/AuthContext';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { 
    Settings as SettingsIcon, Shield, Check, 
    RefreshCw, Zap, Power, 
    AlertCircle, Activity, Layout, Terminal,
    Key, Compass
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
        appData, updateSetting,
        updateStatus, updateProgress, availableVersion, 
        checkUpdates, installUpdate, serverConnected, 
        resyncAuthSession
    } = useLCU();
    
    const { signOut, refreshPremium } = useAuth();
    
    const [activeTab, setActiveTab] = useState<'app' | 'server'>('app');
    const [currentVersion, setCurrentVersion] = useState<string>('0.0.0');
    const [isRestarting, setIsRestarting] = useState(false);
    const [actualServerPath, setActualServerPath] = useState<string>('Recherche du chemin...');
    const [premiumRefreshing, setPremiumRefreshing] = useState(false);
    
    // Custom settings inputs — secrets stay masked once saved; editing replaces, never reveals.
    const [geminiKeyInput, setGeminiKeyInput] = useState('');
    const [geminiEditing, setGeminiEditing] = useState(!(appData?.geminiApiKey));
    const [geminiTestStatus, setGeminiTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
    const [geminiTestMsg, setGeminiTestMsg] = useState<string | null>(null);
    const [premiumTokenInput, setPremiumTokenInput] = useState(appData?.premiumToken || '');

    useEffect(() => {
        if (appData) {
            setPremiumTokenInput(appData.premiumToken || '');
            const hasGemini = !!appData.geminiApiKey;
            if (!geminiEditing) {
                setGeminiKeyInput(hasGemini ? '' : '');
            }
            if (!hasGemini) setGeminiEditing(true);
        }
    }, [appData]);

    const handleSaveGeminiKey = async () => {
        const key = geminiKeyInput.trim();
        if (!key) return;
        await updateSetting('geminiApiKey', key);
        setGeminiKeyInput('');
        setGeminiEditing(false);
        setGeminiTestStatus('idle');
        setGeminiTestMsg(null);
    };

    const handleTestGeminiKey = async () => {
        const key = (geminiEditing ? geminiKeyInput.trim() : '') || (appData?.geminiApiKey || '');
        if (!key) {
            setGeminiTestStatus('fail');
            setGeminiTestMsg('Aucune clé à tester.');
            return;
        }
        setGeminiTestStatus('testing');
        setGeminiTestMsg(null);
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.0-flash:generateContent?key=${encodeURIComponent(key)}`;
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: 'Réponds uniquement: OK' }] }],
                }),
            });
            if (resp.ok) {
                setGeminiTestStatus('ok');
                setGeminiTestMsg('Clé valide — Gemini répond.');
            } else {
                const body = await resp.text().catch(() => '');
                setGeminiTestStatus('fail');
                setGeminiTestMsg(`Échec HTTP ${resp.status}${body ? ' — vérifiez la clé' : ''}`);
            }
        } catch {
            setGeminiTestStatus('fail');
            setGeminiTestMsg('Impossible de joindre l’API Gemini.');
        }
    };

    const handleSavePremiumToken = async () => {
        // Le jeton est seulement conserve pour reference. Le statut premium n'est
        // jamais decide ici : il vient de Supabase et c'est le serveur local qui
        // le verifie. Un client ne doit pas pouvoir se l'attribuer.
        await updateSetting('premiumToken', premiumTokenInput);
    };

    const handleRefreshPremium = async () => {
        setPremiumRefreshing(true);
        try {
            await refreshPremium();
            resyncAuthSession();
        } finally {
            setPremiumRefreshing(false);
        }
    };

    useEffect(() => {
        getVersion().then(setCurrentVersion).catch(console.error);
        invoke<string | null>('crimson_get_actual_server_path').then(path => {
            setActualServerPath(path || 'Chemin non trouvé (vérifiez l\'installation)');
        }).catch(err => {
            console.error("Failed to get server path:", err);
            setActualServerPath('Erreur lors de la récupération du chemin');
        });
    }, []);

    useEffect(() => {
        // Dependencies logic if needed
    }, [appData]);





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
                            <span className="text-white/20">Crimsons Center</span>
                            <span className="w-1 h-1 bg-white/10 rounded-full" />
                            <span className="text-red-500/60">Version {currentVersion}</span>
                        </div>
                    </div>
                </div>

                {/* Sliding Pill Tab Switcher */}
                <div className="relative flex p-1.5 bg-white/5 rounded-2xl border border-white/10 backdrop-blur-xl w-fit">
                    {/* Sliding Indicator */}
                    <div 
                        className={`absolute top-1.5 bottom-1.5 left-1.5 w-[calc(50%-4px)] bg-red-600 rounded-xl transition-all duration-500 shadow-lg shadow-red-900/20 pointer-events-none 
                            ${activeTab === 'app' ? 'translate-x-0' : 'translate-x-full'}`}
                    />
                    <button 
                        onClick={() => setActiveTab('app')}
                        className={`relative z-10 w-36 py-3 text-[11px] font-black uppercase tracking-wider whitespace-nowrap transition-colors duration-300 text-center ${activeTab === 'app' ? 'text-white' : 'text-white/30 hover:text-white/50'}`}
                    >
                        CRIMSONS
                    </button>
                    <button 
                        onClick={() => setActiveTab('server')}
                        className={`relative z-10 w-36 py-3 text-[11px] font-black uppercase tracking-wider whitespace-nowrap transition-colors duration-300 text-center ${activeTab === 'server' ? 'text-white' : 'text-white/30 hover:text-white/50'}`}
                    >
                        Serveur
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-8 animate-in slide-in-from-bottom-4 duration-700">
                {activeTab === 'app' && (
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

                            {/* ACCOUNT */}
                            <div className="bg-white/[0.02] border border-white/5 p-10 rounded-[2.5rem] space-y-6">
                                <div className="flex items-center gap-4 mb-2">
                                    <div className="p-3 bg-red-500/10 rounded-xl">
                                        <Shield className="w-5 h-5 text-red-500" />
                                    </div>
                                    <h3 className="text-sm font-black text-white uppercase tracking-widest font-mono">Compte & Sécurité</h3>
                                </div>
                                
                                <div className="flex items-center justify-end gap-2">
                                    <button 
                                        onClick={handleRefreshPremium}
                                        disabled={premiumRefreshing}
                                        className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white/70 rounded-lg text-[9px] font-black uppercase tracking-widest transition-colors border border-white/10 flex items-center gap-1.5 disabled:opacity-50"
                                    >
                                        <RefreshCw className={`w-3 h-3 ${premiumRefreshing ? 'animate-spin' : ''}`} />
                                        Actualiser le statut
                                    </button>
                                    <button 
                                        onClick={() => signOut()}
                                        className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg text-[9px] font-black uppercase tracking-widest transition-colors border border-red-500/20"
                                    >
                                        Déconnexion
                                    </button>
                                </div>

                                <div className="flex flex-col gap-2">
                                    <label className="text-[9px] font-black text-white/40 uppercase tracking-widest pl-2">Référence Premium (ne débloque pas le compte)</label>
                                    <div className="flex gap-2">
                                        <input 
                                            type="text" 
                                            value={premiumTokenInput}
                                            onChange={(e) => setPremiumTokenInput(e.target.value)}
                                            placeholder="Jeton de référence uniquement…" 
                                            className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-[10px] font-mono text-white outline-none focus:border-red-600 transition-colors"
                                        />
                                        <button 
                                            onClick={handleSavePremiumToken}
                                            className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all border border-white/5"
                                        >
                                            Sauver
                                        </button>
                                    </div>
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

                            {/* INTELLIGENCE ARTIFICIELLE (GEMINI) */}
                            <div className="bg-white/[0.02] border border-white/5 p-10 rounded-[2.5rem] space-y-6">
                                <div className="flex items-center gap-4 mb-2">
                                    <div className="p-3 bg-red-500/10 rounded-xl text-red-500">
                                        <Key className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-black text-white uppercase tracking-widest font-mono">Intelligence Artificielle</h3>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-2">
                                    <div className="flex justify-between items-center pl-2">
                                        <label className="text-[9px] font-black text-white/40 uppercase tracking-widest">Clé API Google Gemini</label>
                                        <a 
                                            href="https://aistudio.google.com/" 
                                            target="_blank" 
                                            rel="noreferrer"
                                            className="text-red-500 hover:text-red-400 text-[8px] font-black uppercase tracking-widest transition-colors flex items-center gap-1"
                                        >
                                            <Compass size={10} /> Obtenir une clé
                                        </a>
                                    </div>
                                    
                                    {geminiEditing || !appData?.geminiApiKey ? (
                                        <div className="flex gap-2">
                                            <input 
                                                type="password" 
                                                value={geminiKeyInput}
                                                onChange={(e) => setGeminiKeyInput(e.target.value)}
                                                placeholder="Clé d'API Google Gemini..." 
                                                autoComplete="off"
                                                className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-[10px] font-mono text-white outline-none focus:border-red-600 transition-colors"
                                            />
                                            <button
                                                onClick={handleSaveGeminiKey}
                                                disabled={!geminiKeyInput.trim()}
                                                className="px-4 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all border border-white/5"
                                            >
                                                Sauver
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex gap-2 items-center">
                                            <div className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-[10px] font-mono text-white/50 tracking-widest">
                                                ••••••••••••••••
                                            </div>
                                            <button
                                                onClick={() => { setGeminiEditing(true); setGeminiKeyInput(''); }}
                                                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all border border-white/5"
                                            >
                                                Remplacer
                                            </button>
                                        </div>
                                    )}
                                    <div className="flex items-center gap-2 pt-1">
                                        <button
                                            onClick={handleTestGeminiKey}
                                            disabled={geminiTestStatus === 'testing' || (!(geminiKeyInput.trim()) && !appData?.geminiApiKey)}
                                            className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 disabled:opacity-40 text-red-400 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all border border-red-500/20 flex items-center gap-1.5"
                                        >
                                            {geminiTestStatus === 'testing' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                            Tester
                                        </button>
                                        {geminiTestMsg && (
                                            <span className={`text-[9px] font-black uppercase tracking-widest ${geminiTestStatus === 'ok' ? 'text-green-500' : 'text-red-400'}`}>
                                                {geminiTestMsg}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                        </div>
                    </div>
                )}
                
                {activeTab === 'server' && (
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
                                <div className="mt-2">
                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-3">Chemin du Serveur (.exe)</h4>
                                    <div className="flex gap-2">
                                        <input 
                                            type="text"
                                            value={actualServerPath}
                                            readOnly
                                            className="flex-1 bg-black/40 border border-white/5 px-4 py-3 text-[10px] font-mono outline-none text-white/40 rounded-xl cursor-not-allowed"
                                        />
                                    </div>
                                </div>
                            </div>
                        </section>


                    </div>
                )}

            </div>
        </div>
    );
};

export default SettingsTab;
