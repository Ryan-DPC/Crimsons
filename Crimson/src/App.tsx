import { useState, useEffect } from 'react';
import { useLCU } from './contexts/LCUContext';
import { getVersion } from '@tauri-apps/api/app';


// Components
import HomeTab from './components/home/HomeTab';
import HistoryTab from './components/history/HistoryTab';
import LobbyTab from './components/lobby/LobbyTab';
import SettingsTab from './components/settings/SettingsTab';
import DebugTab from './components/debug/DebugTab';

// Icons
import { 
  Home, History, Swords, Settings, Bug, 
  ShieldAlert, Cpu, 
  Activity, Zap, Download, X
} from 'lucide-react';

function App() {
  const { 
    tab, setTab, simMode, toggleSimMode, 
    gamePhase, rank, appData, updateSetting,
    updateStatus, updateProgress, availableVersion, installUpdate,
    serverConnected, lolConnected, discordConnected
  } = useLCU();

  const [appVersion, setAppVersion] = useState<string>('1.1.0');
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [showUpdateNotif, setShowUpdateNotif] = useState(true);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(console.error);
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

  return (
    <div className={`flex flex-col h-screen bg-[#050505] text-white selection:bg-red-500/30 font-sans overflow-hidden ${appData?.darkGlassMode ? 'dark-glass' : ''} ${appData?.reducedAnimations ? 'reduced-animations' : ''}`}>
      {/* Top Navigation Bar / Window Draggable Region */}
      <header data-tauri-drag-region className="flex items-center justify-between px-6 py-4 bg-[#050505] border-b border-white/5 z-50 select-none">
        <div data-tauri-drag-region className="flex items-center gap-4">
          <div data-tauri-drag-region className="relative group pointer-events-none">
            <div className="absolute -inset-1 bg-gradient-to-r from-red-600 to-orange-600 rounded-full blur opacity-25 group-hover:opacity-50 transition duration-1000"></div>
            <div className="relative p-2 bg-black rounded-full border border-white/10">
              <Zap className="w-5 h-5 text-red-500 fill-red-500/10" />
            </div>
          </div>
          <div data-tauri-drag-region className="pointer-events-none">
            <h1 className="text-sm font-black tracking-[0.2em] text-white/90 uppercase">Crimson</h1>
            <div className="flex items-center gap-3 text-[10px] font-bold tracking-wider">
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${serverConnected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]'}`} />
                <span className={serverConnected ? 'text-white/60' : 'text-red-500/60'}>SERVER</span>
              </div>
              <div className="w-px h-2 bg-white/10" />
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${lolConnected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)] animate-pulse' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]'}`} />
                <span className={lolConnected ? 'text-white/60' : 'text-red-500/60'}>LEAGUE</span>
              </div>
              <div className="w-px h-2 bg-white/10" />
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${discordConnected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]'}`} />
                <span className={discordConnected ? 'text-white/60' : 'text-red-500/60'}>DISCORD</span>
              </div>
            </div>
          </div>
        </div>

        <nav className="flex items-center bg-white/5 p-1 rounded-xl border border-white/5">
          <button 
            onClick={() => setTab('home')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-300 ${tab === 'home' ? 'bg-white/10 text-white shadow-lg shadow-black/50' : 'text-white/40 hover:text-white/70'}`}
          >
            <Home className="w-4 h-4" /> HOME
          </button>
          <button 
            onClick={() => setTab('lobby')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-300 ${tab === 'lobby' ? 'bg-white/10 text-white shadow-lg shadow-black/50' : 'text-white/40 hover:text-white/70'}`}
          >
            <Swords className="w-4 h-4" /> LOBBY
          </button>
          <button 
            onClick={() => setTab('history')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-300 ${tab === 'history' ? 'bg-white/10 text-white shadow-lg shadow-black/50' : 'text-white/40 hover:text-white/70'}`}
          >
            <History className="w-4 h-4" /> HISTORY
          </button>
          <div className="w-px h-4 bg-white/10 mx-1 cursor-default" />
          <button 
            onClick={() => setTab('settings')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-300 ${tab === 'settings' ? 'bg-white/10 text-white shadow-lg shadow-black/50' : 'text-white/40 hover:text-white/70'}`}
          >
            <Settings className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setTab('debug')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-300 ${tab === 'debug' ? 'bg-white/10 text-white shadow-lg shadow-black/50' : 'text-white/40 hover:text-white/70'}`}
          >
            <Bug className="w-4 h-4" />
          </button>
        </nav>

        <div className="flex items-center gap-4">
          <div data-tauri-drag-region className="hidden md:flex flex-col items-end pointer-events-none">
            <div className="text-[10px] font-black text-white/30 tracking-widest uppercase">Global State</div>
            <div className="text-xs font-bold text-red-500/80">{gamePhase.toUpperCase()}</div>
          </div>
          <div className="w-px h-8 bg-white/5" />
          <button 
            onClick={toggleSimMode}
            className={`group relative flex items-center gap-2 px-4 py-2 rounded-xl border transition-all duration-500 ${simMode ? 'bg-red-500/10 border-red-500/50 text-red-500 shadow-[0_0_20px_rgba(239,68,68,0.2)]' : 'bg-white/5 border-white/10 text-white/40 hover:border-white/20'}`}
          >
            <Activity className={`w-4 h-4 ${simMode ? 'animate-pulse' : ''}`} />
            <span className="text-[10px] font-black tracking-widest uppercase">Simulation</span>
          </button>

          {/* Custom OS Window Controls */}
          <div className="flex items-center gap-1 pl-4 ml-2 border-l border-white/10">
            <button 
              onClick={() => handleWindowCommand('minimize')} 
              className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors"
            >
              <div className="w-2.5 h-[1.5px] bg-current"></div>
            </button>
            <button 
              onClick={() => handleWindowCommand('maximize')} 
              className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors"
            >
              <div className="w-2.5 h-2.5 border-[1.5px] border-current"></div>
            </button>
            <button 
              onClick={() => handleWindowCommand('close')} 
              title="Fermer l'application"
              className="group w-8 h-8 flex items-center justify-center rounded hover:bg-red-500 text-white/50 hover:text-white transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="group-hover:stroke-white"/>
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden relative scrollbar-hide">
        {/* Ambient Background Glows */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-red-600/5 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-orange-600/5 rounded-full blur-[120px] pointer-events-none" />
        <div className="max-w-[1600px] mx-auto p-8 min-h-full flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-1000">
          {tab === 'home' && <HomeTab />}
          {tab === 'lobby' && <LobbyTab />}
          {tab === 'history' && <HistoryTab />}
          {tab === 'settings' && <SettingsTab />}
          {tab === 'debug' && <DebugTab />}
        </div>
        
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
            <span className="text-[10px] font-bold text-white/30 tracking-widest uppercase">{appVersion} Crimson</span>
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
    </div>
  );
}

export default App;
