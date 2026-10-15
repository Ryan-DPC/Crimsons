import { useState, useEffect } from 'react';
import { useLCU } from './contexts/LCUContext';
import { getVersion } from '@tauri-apps/api/app';


// Components
import HomeTab from './components/home/HomeTab';
import LobbyTab from './components/lobby/LobbyTab';
import HistoryTab from './components/history/HistoryTab';
import SettingsTab from './components/settings/SettingsTab';
import DebugTab from './components/debug/DebugTab';
import { useAuth } from './contexts/AuthContext';
import LoginScreen from './components/auth/LoginScreen';
import logoRed from './assets/logos/logo_red_transparent.png';
import OnboardingModal from './components/common/OnboardingModal';

// Icons
import { 
  Home, Swords, 
  ShieldAlert, Cpu, 
  Activity, Download, X,
  Bell, Menu, User
} from 'lucide-react';

function App() {
  const { 
    tab, setTab, 
    rank, appData, updateSetting,
    updateStatus, updateProgress, availableVersion, installUpdate,
    serverConnected, lolConnected,
    sum, v,
    loginSpotify, spotifyConnected,
  } = useLCU();

  const { session, loading } = useAuth();

  const [appVersion, setAppVersion] = useState<string>('1.1.0');
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [showUpdateNotif, setShowUpdateNotif] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    if (!appData) return;

    let browserFinished = false;
    try {
      browserFinished = localStorage.getItem('crimsons_first_launch_finished') === '1';
    } catch { /* ignore */ }

    // Already finished — never re-open full welcome.
    if (appData.firstLaunchFinished === true || browserFinished) {
      setShowOnboarding(false);
      return;
    }

    // Heal after a Default-wipe race: evidence of prior setup means skip welcome.
    const priorUse = !!(
      appData.spotifyClientId ||
      appData.geminiApiKey ||
      appData.plugins?.spotify ||
      appData.plugins?.discord ||
      appData.closeToTray !== undefined && appData.closeToTray !== null ||
      spotifyConnected
    );

    if (priorUse) {
      updateSetting('firstLaunchFinished', true).catch(() => {});
      setShowOnboarding(false);
      return;
    }

    // Only show when the flag is explicitly missing on a fresh profile.
    if (appData.firstLaunchFinished === undefined) {
      setShowOnboarding(true);
    }
  }, [appData, spotifyConnected]);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(console.error);
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      getCurrentWindow().show().catch(console.error);
    });
  }, []);

  const handleWindowCommand = async (command: 'minimize' | 'maximize' | 'close') => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();
      if (command === 'minimize') await appWindow.minimize();
      if (command === 'maximize') await appWindow.toggleMaximize();
      if (command === 'close') {
        if (appData?.closeToTray === undefined) {
          setShowCloseDialog(true);
        } else if (appData.closeToTray) {
          await appWindow.hide();
        } else {
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('crimson_quit_app');
          } catch(e) {
            console.error('Failed to invoke crimson_quit_app:', e);
          }
        }
      }
    } catch (e) {
      console.warn('Window command failed, likely not in Tauri context:', e);
    }
  };

  if (loading) {
    return (
      <div data-tauri-drag-region className="h-screen w-screen bg-[#050505] flex flex-col items-center justify-center relative overflow-hidden">
        {/* App Titlebar for Loading Screen */}
        <div data-tauri-drag-region className="absolute top-0 inset-x-0 h-10 flex items-center justify-between px-4">
            <span data-tauri-drag-region className="text-white/20 text-[10px] font-black tracking-widest uppercase">Crimsons</span>
            <button 
                onClick={async () => {
                    const { getCurrentWindow } = await import('@tauri-apps/api/window');
                    getCurrentWindow().close();
                }} 
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-500/20 text-white/50 hover:text-red-500 transition-colors z-50"
            >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M1 1L9 9M9 1L1 9"/>
                </svg>
            </button>
        </div>

        <div className="relative group mt-8">
          <div className="relative w-16 h-16 flex items-center justify-center rounded-full border border-white/10 overflow-hidden animate-bounce">
            <img src={logoRed} className="w-full h-full object-cover scale-[1.3]" alt="CRIMSONS" />
          </div>
        </div>
        <p className="mt-8 text-white/30 text-[10px] font-black uppercase tracking-widest animate-pulse">Connexion aux serveurs...</p>
      </div>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  return (
    <div className={`flex flex-col h-screen bg-[#050505] text-white selection:bg-red-500/30 font-sans overflow-hidden ${appData?.darkGlassMode ? 'dark-glass' : ''} ${appData?.reducedAnimations ? 'reduced-animations' : ''}`}>
      {/* Top Navigation Bar / Window Draggable Region */}
      <header data-tauri-drag-region className="flex items-center justify-between px-4 py-2.5 bg-[#050505] border-b border-white/5 z-50 select-none gap-2">
        {/* LEFT: Logo & Notifications */}
        <div data-tauri-drag-region className="flex items-center gap-4 shrink-0">
          <div data-tauri-drag-region className="flex items-center gap-3">
            <div data-tauri-drag-region className="relative group pointer-events-none">
              <div className="relative w-8 h-8 flex items-center justify-center rounded-full border border-white/10 overflow-hidden bg-black/20">
                <img src={logoRed} className="w-full h-full object-cover scale-[1.35]" alt="CRIMSONS" />
              </div>
            </div>
            <div data-tauri-drag-region className="pointer-events-none">
              <h1 className="text-xs font-black tracking-[0.2em] text-white/90 uppercase leading-tight">CRIMSONS</h1>
              <div className="flex items-center gap-2 text-[9px] font-bold tracking-wider mt-0.5">
                <div className="flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${serverConnected ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]' : 'bg-red-500'}`} />
                  <span className={serverConnected ? 'text-white/50' : 'text-red-500/60'}>SERVER</span>
                </div>
                <span className="text-white/10">·</span>
                <div className="flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${lolConnected ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)] animate-pulse' : 'bg-red-500'}`} />
                  <span className={lolConnected ? 'text-white/50' : 'text-red-500/60'}>LEAGUE</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* CENTER: Navigation Tabs */}
        <nav className="flex items-center bg-white/5 p-1 rounded-xl border border-white/5">
          <button onClick={() => setTab('home')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all duration-300 ${tab === 'home' ? 'bg-white/10 text-white shadow-lg shadow-black/50' : 'text-white/40 hover:text-white/70'}`}>
            <Home className="w-3.5 h-3.5" /> HOME
          </button>
          <button onClick={() => setTab('league')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all duration-300 ${tab === 'league' || tab === 'lobby' ? 'bg-white/10 text-white shadow-lg shadow-black/50' : 'text-white/40 hover:text-white/70'}`}>
            <Swords className="w-3.5 h-3.5" /> GAME
          </button>
          <button onClick={() => setTab('history')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all duration-300 ${tab === 'history' ? 'bg-white/10 text-white shadow-lg shadow-black/50' : 'text-white/40 hover:text-white/70'}`}>
            <Activity className="w-3.5 h-3.5" /> ACTIVITY
          </button>
          <button onClick={() => setTab('settings')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all duration-300 ${tab === 'settings' ? 'bg-white/10 text-white shadow-lg shadow-black/50' : 'text-white/40 hover:text-white/70'}`}>
            <User className="w-3.5 h-3.5" /> ACCOUNT
          </button>
        </nav>

        {/* RIGHT: Profile & Window Controls */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-3 pr-3 border-r border-white/10">
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-black text-white uppercase tracking-widest leading-none">{sum ? (sum.displayName || sum.gameName) : 'Offline'}</span>
              <span className="text-[9px] font-bold text-red-500 uppercase tracking-widest mt-1">{rank?.tier ? `${rank.tier} ${rank.division}` : (sum ? `Niveau ${sum.summonerLevel}` : '')}</span>
            </div>
            {sum ? (
              <img src={`https://ddragon.leagueoflegends.com/cdn/${v}/img/profileicon/${sum.profileIconId}.png`} className="w-8 h-8 rounded-full border border-white/10 shadow-lg" alt="Profile" />
            ) : (
              <div className="w-8 h-8 bg-[#111115] rounded-full border border-white/10" />
            )}
            <button className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-colors ml-1">
              <Menu className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-white/10 mx-1" />
            <button className="relative w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-colors">
              <Bell className="w-4 h-4" />
              <div className="absolute top-2.5 right-2.5 w-1.5 h-1.5 bg-red-500 rounded-full border border-black" />
            </button>
          </div>

          {/* Window Controls */}
          <div className="flex items-center gap-0.5">
            <button onClick={() => handleWindowCommand('minimize')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors">
              <div className="w-2.5 h-[1.5px] bg-current" />
            </button>
            <button onClick={() => handleWindowCommand('maximize')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors">
              <div className="w-2.5 h-2.5 border-[1.5px] border-current" />
            </button>
            <button onClick={() => handleWindowCommand('close')} title="Fermer l'application" className="group w-7 h-7 flex items-center justify-center rounded hover:bg-red-500 text-white/50 hover:text-white transition-colors">
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="group-hover:stroke-white"/>
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* Ambient Background Glows */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-red-600/5 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-orange-600/5 rounded-full blur-[120px] pointer-events-none" />
        {tab === 'league' || tab === 'lobby' ? (
          <div className="flex-1 min-h-0 flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-1000">
            <LobbyTab />
          </div>
        ) : tab === 'history' ? (
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide max-w-[1600px] mx-auto p-8 w-full animate-in fade-in slide-in-from-bottom-4 duration-1000">
            <HistoryTab />
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-hide">
            <div className="max-w-[1600px] mx-auto p-8 min-h-full flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-1000">
              {tab === 'home' && <HomeTab />}
              {tab === 'settings' && <SettingsTab />}
              {tab === 'debug' && <DebugTab />}
            </div>
          </div>
        )}
        
        {/* GitHub Update Notification */}
        {availableVersion && showUpdateNotif && (
          <div className="absolute top-4 right-4 z-50 animate-in fade-in slide-in-from-right-4 duration-500">
            <div className="bg-[#1a1a20]/95 border border-red-500/30 p-4 rounded-xl shadow-[0_0_30px_rgba(239,68,68,0.15)] flex items-center gap-4 backdrop-blur-md">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                {updateStatus === 'installing' ? (
                   <div className="relative w-8 h-8 flex items-center justify-center">
                      <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                          <circle cx="18" cy="18" r="16" fill="none" className="stroke-white/10" strokeWidth="3" />
                          <circle cx="18" cy="18" r="16" fill="none" className="stroke-red-500" strokeWidth="3" strokeDasharray={`${updateProgress}, 100`} />
                      </svg>
                      <span className="absolute text-[8px] font-black text-white">{updateProgress}%</span>
                   </div>
                ) : (
                  <Download className="w-5 h-5 text-red-500 animate-bounce" />
                )}
              </div>
              <div>
                <p className="text-white font-bold text-sm tracking-tight">
                  {updateStatus === 'installing' ? "Installation en cours..." : `Mise à jour disponible (v${availableVersion})`}
                </p>
                <p className="text-white/40 text-[10px] uppercase font-black tracking-widest mt-0.5">
                  {updateStatus === 'installing' ? "L'application va redémarrer" : "Nouvelle version sur GitHub"}
                </p>
              </div>
              {updateStatus !== 'installing' && (
                <button 
                  onClick={() => installUpdate()}
                  className="ml-4 px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-[10px] font-black uppercase tracking-widest rounded-lg transition-all shadow-[0_0_15px_rgba(239,68,68,0.3)] hover:scale-105 active:scale-95"
                >
                  Mettre à jour
                </button>
              )}
              <button 
                 onClick={() => setShowUpdateNotif(false)}
                 className="p-1 hover:bg-white/5 rounded-full"
              >
                <X className="w-4 h-4 text-white/20" />
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Modern Status Footer */}
      <footer className="px-6 py-3 bg-black/60 backdrop-blur-xl border-t border-white/5 flex items-center justify-between z-50">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Cpu className="w-3.5 h-3.5 text-white/20" />
            <span className="text-[10px] font-bold text-white/30 tracking-widest uppercase">{appVersion} Crimsons</span>
          </div>
        </div>

        <div className="flex items-center gap-8">
          {rank.tier && rank.tier !== 'UNRANKED' && rank.tier !== 'NA' && rank.tier !== 'NONE' && rank.division !== 'NA' && rank.division !== 'NONE' && (
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end">
                <div className="text-[10px] font-black text-white/20 tracking-tighter uppercase">Solo / Duo</div>
                <div className="text-xs font-black text-white/80">{rank.tier} {rank.division} <span className="text-red-500/60 ml-1">{rank.lp} LP</span></div>
              </div>
              <div className="p-1.5 bg-white/5 rounded-lg border border-white/10">
                <ShieldAlert className="w-4 h-4 text-white/40" />
              </div>
            </div>
          )}
          {rank.tftTier && rank.tftTier !== 'UNRANKED' && rank.tftTier !== 'NA' && rank.tftTier !== 'NONE' && rank.tftDivision !== 'NA' && rank.tftDivision !== 'NONE' && (
            <div className="flex items-center gap-3 border-l border-white/5 pl-6">
              <div className="flex flex-col items-end">
                <div className="text-[10px] font-black text-white/20 tracking-tighter uppercase">TFT Rank</div>
                <div className="text-xs font-black text-white/80">{rank.tftTier} {rank.tftDivision} <span className="text-blue-500/60 ml-1">{rank.tftLp} LP</span></div>
              </div>
              <div className="p-1.5 bg-white/5 rounded-lg border border-white/10">
                <Activity className="w-4 h-4 text-white/40" />
              </div>
            </div>
          )}
          <div className="flex items-center gap-3 px-4 py-1.5 bg-white/5 rounded-xl border border-white/10 group hover:border-red-500/30 transition-colors duration-500 cursor-help">
            <div className="flex flex-col items-end">
              <div className="text-[10px] font-black text-white/20 tracking-tighter uppercase">Gemini AI</div>
              <div className="text-[10px] font-bold text-green-500/80 uppercase">Operational</div>
            </div>
            <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
          </div>
        </div>
      </footer>

      {/* Close Configuration Dialog */}
      {showCloseDialog && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-[#111115] border border-white/10 p-8 rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.8)] max-w-sm w-full mx-4">
            <h2 className="text-xl font-black text-white uppercase tracking-widest mb-2">Fermeture</h2>
            <p className="text-white/50 text-xs font-bold leading-relaxed mb-6">
              Voulez-vous réduire l'application dans la zone de notification (en arrière-plan) ou la quitter complètement ?
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  updateSetting('closeToTray', true);
                  setShowCloseDialog(false);
                  setTimeout(() => handleWindowCommand('close'), 100);
                }}
                className="w-full py-3 bg-red-600 hover:bg-red-500 rounded-xl text-white text-xs font-black uppercase tracking-widest transition-all shadow-[0_0_15px_rgba(239,68,68,0.3)]"
              >
                Minimiser (Recommandé)
              </button>
              <button
                onClick={() => {
                  updateSetting('closeToTray', false);
                  setShowCloseDialog(false);
                  setTimeout(() => handleWindowCommand('close'), 100);
                }}
                className="w-full py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white/70 hover:text-white text-xs font-black uppercase tracking-widest transition-all"
              >
                Quitter l'application
              </button>
            </div>
            <p className="text-center text-[9px] text-white/30 uppercase tracking-widest mt-4">Vous pourrez changer ceci dans les paramètres.</p>
          </div>
        </div>
      )}

      {/* Onboarding Welcome Tutorial */}
      {showOnboarding && (
        <OnboardingModal 
          onClose={() => setShowOnboarding(false)} 
          updateSetting={updateSetting} 
          appData={appData}
          loginSpotify={loginSpotify}
          spotifyConnected={spotifyConnected}
        />
      )}
    </div>
  );
}

export default App;
