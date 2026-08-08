import { useLCU } from '../../contexts/LCUContext';
import { useAuth } from '../../contexts/AuthContext';
import { getChampIcon } from '../../utils/lolDisplay';
import { Disc3, MessageSquare, Laptop, Music, MicOff, Mic, Headphones, MonitorPlay } from 'lucide-react';


// Reusable animated toggle component
const Toggle = ({ value, onChange, label, disabled }: {
    value: boolean;
    onChange: (v: boolean) => void;
    label: string;
    disabled?: boolean;
}) => (
    <div className={`flex items-center justify-between group ${disabled ? 'opacity-40' : ''}`}>
        <span className="text-[10px] font-black text-white/70 uppercase tracking-widest group-hover:text-white transition-colors">{label}</span>
        <button
            onClick={() => !disabled && onChange(!value)}
            disabled={disabled}
            className={`relative w-9 h-5 rounded-full transition-all duration-500 focus:outline-none ${disabled ? 'bg-white/5 cursor-not-allowed' : value ? 'bg-red-600 shadow-[0_0_10px_rgba(220,38,38,0.4)]' : 'bg-white/10'}`}
        >
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-md transition-all duration-500 cubic-bezier(0.34, 1.56, 0.64, 1) ${(value && !disabled) ? 'left-4 scale-110' : 'left-0.5'}`} />
        </button>
    </div>
);

export default function HomeTab() {
    const { appData, updateSetting, sum, v, hist, champs, seasonStats, spotifyState, discordState, spotifyCommand, discordCommand, discordConnected } = useLCU();
    const { isPremium } = useAuth();
    
    const openLyricsWindow = async () => {
        try {
            const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
            new WebviewWindow('lyrics', {
                url: '/index.html?window=lyrics',
                title: 'Crimson Lyrics',
                width: 1200,
                height: 800,
                fullscreen: false,
                transparent: false,
                decorations: false,
            });
        } catch (e) {
            console.error("Failed to open lyrics window", e);
        }
    };

    // Calcul des statistiques
    const validMatches = hist.filter(m => m.gameDuration > 300);
    const recentWins = validMatches.filter(m => m.stats?.win).length;

    // Compteur officiel du Split actuel si disponible, sinon historique récent
    const totalMatches = seasonStats ? (seasonStats.wins + seasonStats.losses) : validMatches.length;
    const wins = seasonStats ? seasonStats.wins : recentWins;
    const losses = seasonStats ? seasonStats.losses : (validMatches.length - recentWins);
    
    let totalKills = 0, totalDeaths = 0, totalAssists = 0;
    hist.forEach(m => {
        if (m.stats) {
            totalKills += m.stats.kills || 0;
            totalDeaths += m.stats.deaths || 0;
            totalAssists += m.stats.assists || 0;
        }
    });
    
    const avgKills = validMatches.length ? (totalKills / validMatches.length).toFixed(1) : '0';
    const avgDeaths = validMatches.length ? (totalDeaths / validMatches.length).toFixed(1) : '0';
    const avgAssists = validMatches.length ? (totalAssists / validMatches.length).toFixed(1) : '0';

    // --- REAL GRAPH CALCULATIONS ---
    const reversedHist = [...validMatches].slice(0, 15).reverse();
    const maxKills = Math.max(1, ...reversedHist.map(m => m.stats?.kills || 0));
    
    const kdaPoints = reversedHist.map(m => {
        const k = m.stats?.kills || 0;
        const d = Math.max(1, m.stats?.deaths || 1);
        const a = m.stats?.assists || 0;
        return (k + a) / d;
    });
    const maxKda = Math.max(1, ...kdaPoints);
    
    const kdaSvgPoints = kdaPoints.map((kda, i) => {
        const x = (i / Math.max(1, kdaPoints.length - 1)) * 100;
        const y = 35 - ((kda / maxKda) * 30); // Scale 5 to 35
        return `${x},${y}`;
    }).join(' L');
    const kdaSvgPath = kdaPoints.length > 0 ? `M${kdaSvgPoints}` : `M0,30 L100,30`;
    
    // Extract last point for the glowing dot
    let lastCx = '100', lastCy = '5';
    if (kdaPoints.length > 0) {
        const lastP = kdaSvgPoints.split(' L').pop()?.split(',') || ['100', '5'];
        lastCx = lastP[0]; lastCy = lastP[1];
    }

    const winPercent = totalMatches > 0 ? Math.round((wins / totalMatches) * 100) : 0;

    return (
        <div className="w-full h-full flex justify-center items-start pt-12 pb-12 overflow-y-auto scrollbar-hide gap-20">
            
            {/* Main Stats Card (Flat Dark Mode) */}
            <div className="w-[600px] bg-[#0a0a0c] border border-white/5 rounded-2xl flex flex-col shrink-0">

                {/* Summoner Banner */}
                <div className="p-6 flex items-center gap-5 border-b border-white/5">
                    <div className="relative shrink-0">
                        {sum ? <img src={`https://ddragon.leagueoflegends.com/cdn/${v}/img/profileicon/${sum.profileIconId}.png`} className="w-12 h-12 rounded-xl border border-white/10" alt="Icone" /> : <div className="w-12 h-12 bg-[#111115] border border-white/5 rounded-xl" />}
                    </div>
                    <div className="flex flex-col flex-1 min-w-0">
                        <span className="text-white/40 text-[9px] uppercase font-black tracking-widest">Summoner</span>
                        <span className="text-white font-bold text-base tracking-wide truncate">{sum ? (sum.displayName || sum.gameName) : 'Offline'}</span>
                    </div>
                </div>

                {/* Compact Stats Row */}
                <div className="px-6 py-5 grid grid-cols-3 gap-4 border-b border-white/5 bg-[#050505]/50">
                    <div className="flex flex-col gap-1">
                        <span className="text-white/50 text-[10px] uppercase font-black tracking-widest">Matches</span>
                        <span className="text-white font-black text-lg">{totalMatches}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-white/50 text-[10px] uppercase font-black tracking-widest">W/L</span>
                        <span className="text-white font-black text-lg">{wins}/<span className="text-red-500">{losses}</span></span>
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-white/50 text-[10px] uppercase font-black tracking-widest">KDA</span>
                        <span className="text-white font-black text-lg">{avgKills}/<span className="text-red-500">{avgDeaths}</span><span className="text-white/50 text-sm">/{avgAssists}</span></span>
                    </div>
                </div>

                {/* Recent Match History Graph Header */}
                <div className="px-6 pt-6 pb-2 flex items-center justify-between z-10 relative">
                    <span className="text-white/80 text-[10px] uppercase font-black tracking-widest">Recent Match History</span>
                    <button className="px-3 py-1 bg-[#2a2a30] hover:bg-white/20 rounded-md border border-white/10 text-white/90 text-[9px] font-black tracking-widest uppercase transition-colors">Graph</button>
                </div>

                {/* Real Recent Match Graph */}
                <div className="px-5 h-16 flex items-end justify-between gap-1 z-10 relative mt-2 mb-2">
                    {reversedHist.map((m, i) => {
                        const isWin = m.stats?.win;
                        const kills = m.stats?.kills || 0;
                        const height = Math.max(10, (kills / maxKills) * 100); // bar height based on kills
                        return (
                            <div key={i} className="flex-1 relative flex items-end justify-center group cursor-crosshair">
                                <div className="w-[1px] h-full bg-white/5 absolute bottom-0" />
                                <div 
                                    className={`w-1.5 rounded-t-sm transition-all duration-300 ${isWin ? 'bg-white/80' : 'bg-red-500/80 group-hover:bg-red-400'}`} 
                                    style={{ height: `${height}%` }} 
                                />
                            </div>
                        );
                    })}
                    {/* Real line overlay (KDA) */}
                    <div className="absolute inset-x-5 inset-y-0 pointer-events-none">
                        <svg viewBox="0 0 100 40" className="w-full h-full overflow-visible" preserveAspectRatio="none">
                            <path d={kdaSvgPath} fill="none" stroke="#ef4444" strokeWidth="1" strokeLinejoin="round" className="opacity-50" />
                            {kdaPoints.length > 0 && (
                                <circle cx={lastCx} cy={lastCy} r="2" fill="white" className="drop-shadow-[0_0_5px_rgba(255,255,255,0.8)]" />
                            )}
                        </svg>
                    </div>
                </div>

                {/* Match List */}
                <div className="px-5 py-4 flex flex-col gap-4 z-10 relative border-t border-white/5">
                    {hist.slice(0, 3).map((m, i) => {
                        const isWin = m.stats?.win;
                        return (
                            <div key={i} className="flex items-center justify-between group">
                                <div className="flex items-center gap-3">
                                    <img src={getChampIcon(m.championId, champs, v)} className="w-8 h-8 rounded-full border border-white/10 shadow-lg group-hover:scale-110 transition-transform" alt="" />
                                    <div className="flex items-center gap-2">
                                        <span className="text-white font-bold text-[11px] min-w-[50px]">{champs.find(c => c.id === String(m.championId))?.name || 'Champ'}</span>
                                        <span className="text-white/20 text-[10px]">|</span>
                                        <span className={`text-[10px] font-black uppercase tracking-widest min-w-[55px] ${isWin ? 'text-green-500' : 'text-red-500'}`}>{isWin ? 'Victory' : 'Defeat'}</span>
                                        <span className="text-white/20 text-[10px]">|</span>
                                        <span className="text-white/70 text-[11px] font-bold tracking-wider">{m.stats?.kills}/{m.stats?.deaths}/{m.stats?.assists}</span>
                                    </div>
                                </div>
                                <span className={`text-[10px] font-black tracking-widest ${isWin ? 'text-green-500' : 'text-red-500'}`}>{isWin ? '+24 LP' : '-18 LP'}</span>
                            </div>
                        )
                    })}
                </div>

                {/* Bottom Charts */}
                <div className="p-5 border-t border-white/5 flex gap-4 mt-auto">
                    <div className="flex-1 flex flex-col gap-2">
                        <span className="text-white/50 text-[9px] uppercase font-black tracking-widest">W/L Ratio</span>
                        <div 
                            className="w-16 h-16 rounded-full relative flex items-center justify-center mt-2"
                            style={{ background: `conic-gradient(white ${winPercent}%, #ef4444 ${winPercent}%)` }}
                        >
                            <div className="absolute inset-1 bg-[#0a0a0c] rounded-full" /> {/* Inner circle to make it a donut */}
                            <span className="text-white font-black text-[9px] uppercase tracking-widest z-10">{winPercent}%</span>
                        </div>
                    </div>
                    <div className="w-px bg-white/5" />
                    <div className="flex-1 flex flex-col gap-2">
                        <span className="text-white/50 text-[9px] uppercase font-black tracking-widest">KDA Graph</span>
                        {/* Real KDA line chart */}
                        <div className="flex-1 relative flex items-end pt-2">
                            <svg viewBox="0 0 100 40" className="w-full h-full overflow-visible" preserveAspectRatio="none">
                                <path d={kdaSvgPath} fill="none" stroke="#ef4444" strokeWidth="2" strokeLinejoin="round" />
                                {kdaPoints.length > 0 && (
                                    <circle cx={lastCx} cy={lastCy} r="2.5" fill="white" />
                                )}
                            </svg>
                            <div className="absolute inset-0 bg-gradient-to-t from-red-500/10 to-transparent pointer-events-none" style={{ clipPath: 'polygon(0 30px, 25px 10px, 50px 25px, 75px 15px, 100px 5px, 100px 40px, 0 40px)' }} />
                        </div>
                    </div>
                </div>

            </div>

            {/* Sidebar Controls (No Heavy Blocks) */}
            <div className="w-[450px] flex flex-col gap-8 shrink-0 pt-2">
                <div className="flex flex-col gap-3">
                    <span className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-1 border-b border-white/5 pb-2">Automation</span>
                    <Toggle
                        label="Auto-Accept Match"
                        value={appData?.autoAccept ?? true}
                        onChange={(v) => updateSetting('autoAccept', v)}
                    />
                </div>

                <div className="flex flex-col gap-3 mt-4">
                    <span className="text-[10px] font-black text-white/40 uppercase tracking-widest border-b border-white/5 pb-2">Auto Selection</span>
                    <div className="flex items-center gap-3">
                        <div className="flex-1 bg-[#0a0a0c] border border-white/5 rounded-xl p-3 flex items-center gap-3 relative overflow-hidden transition-colors hover:border-blue-500/30">
                            {appData?.autoPick ? <img src={getChampIcon(appData.autoPick, champs, v)} className="absolute inset-0 w-full h-full object-cover opacity-10" /> : null}
                            <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest relative z-10 shrink-0">Pick</span>
                            <span className="text-white text-xs font-bold relative z-10 truncate">{appData?.autoPick ? champs.find(c => c.id === appData.autoPick)?.name : 'None'}</span>
                        </div>
                        <div className="flex-1 bg-[#0a0a0c] border border-white/5 rounded-xl p-3 flex items-center gap-3 relative overflow-hidden transition-colors hover:border-red-500/30">
                            {appData?.autoBan ? <img src={getChampIcon(appData.autoBan, champs, v)} className="absolute inset-0 w-full h-full object-cover opacity-10" /> : null}
                            <span className="text-[10px] font-black text-red-500 uppercase tracking-widest relative z-10 shrink-0">Ban</span>
                            <span className="text-white text-xs font-bold relative z-10 truncate">{appData?.autoBan ? champs.find(c => c.id === appData.autoBan)?.name : 'None'}</span>
                        </div>
                    </div>
                    <span className="text-[9px] text-white/30 uppercase font-bold mt-2">Edit selections in your Settings</span>
                </div>

                {isPremium && appData?.plugins?.spotify && (
                    <div className="flex flex-col gap-3 mt-4">
                        <span className="text-[10px] font-black text-white/40 uppercase tracking-widest border-b border-white/5 pb-2">Spotify</span>
                        <div className="bg-[#0a0a0c] border border-white/5 rounded-xl p-4 flex items-center gap-4 transition-colors hover:border-green-500/30">
                            {spotifyState?.album_art ? (
                                <img src={spotifyState.album_art} className="w-10 h-10 rounded-lg shadow-md" />
                            ) : (
                                <div className="w-10 h-10 bg-white/5 rounded-lg flex items-center justify-center">
                                    <Disc3 className="w-5 h-5 text-white/20" />
                                </div>
                            )}
                            <div className="flex flex-col flex-1 min-w-0">
                                <span className="text-white font-bold text-xs truncate">{spotifyState?.track_name || 'Aucune musique'}</span>
                                <span className="text-white/50 text-[10px] truncate">{spotifyState?.artist_name || 'En attente...'}</span>
                            </div>
                        </div>
                        
                        <div className="flex gap-2 mt-1">
                            <button
                                onClick={() => spotifyCommand("transfer-to-crimson")}
                                className="flex-1 flex items-center justify-center gap-2 py-3 bg-green-600/10 hover:bg-green-600/20 text-green-500 rounded-xl border border-green-500/20 transition-all hover:scale-[1.02] active:scale-95"
                            >
                                <Laptop className="w-4 h-4" />
                                <span className="text-[9px] font-black tracking-widest uppercase">Écouter sur ce PC</span>
                            </button>

                            <button
                                onClick={openLyricsWindow}
                                className="flex-1 flex items-center justify-center gap-2 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl border border-white/10 transition-all hover:scale-[1.02] active:scale-95"
                            >
                                <Music className="w-4 h-4" />
                                <span className="text-[9px] font-black tracking-widest uppercase">Lyrics Overlay</span>
                            </button>
                        </div>
                    </div>
                )}

                {isPremium && appData?.plugins?.discord && (
                    <div className="flex flex-col gap-3 mt-4">
                        <span className="text-[10px] font-black text-white/40 uppercase tracking-widest border-b border-white/5 pb-2">Discord</span>
                        <div className="bg-[#0a0a0c] border border-white/5 rounded-xl p-4 flex items-center gap-4 transition-colors hover:border-indigo-500/30">
                            <div className="w-10 h-10 bg-indigo-500/10 rounded-lg flex items-center justify-center">
                                <MessageSquare className="w-5 h-5 text-indigo-500" />
                            </div>
                            <div className="flex flex-col flex-1 min-w-0">
                                <span className="text-white font-bold text-xs truncate">
                                    {discordState?.username ? `@${discordState.username}` : 'Statut Vocal'}
                                </span>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                    <div className={`w-1.5 h-1.5 rounded-full ${
                                        discordState?.connected
                                            ? (discordState?.in_voice ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-amber-400')
                                            : 'bg-red-500'
                                    }`} />
                                    <span className="text-white/50 text-[10px] truncate uppercase font-bold tracking-widest">
                                        {discordState?.error
                                            ? (discordState.error.includes('invalide') || discordState.error.includes('manquant')
                                                ? 'Client ID requis'
                                                : 'Erreur Discord')
                                            : !discordState?.connected
                                                ? 'Discord introuvable'
                                                : discordState?.in_voice
                                                    ? 'En vocal'
                                                    : 'Connecté'}
                                    </span>
                                </div>
                                {discordState?.error && (
                                    <p className="text-[9px] text-red-400/80 mt-2 leading-snug">
                                        {discordState.error}
                                    </p>
                                )}
                            </div>
                        </div>
                        
                        <div className={`grid grid-cols-3 gap-2 mt-1 transition-all duration-500 ${discordConnected || discordState?.connected ? 'opacity-100 scale-100' : 'opacity-40 pointer-events-none'}`}>
                            <button
                                onClick={() => discordCommand("toggleMute")}
                                className={`flex items-center justify-center gap-2 py-3 rounded-xl border transition-all hover:scale-[1.02] active:scale-95 ${
                                    discordState?.is_muted 
                                    ? 'bg-red-500/10 border-red-500/20 text-red-500 hover:bg-red-500/20' 
                                    : 'bg-white/5 border-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                                }`}
                            >
                                {discordState?.is_muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                                <span className="text-[9px] font-black uppercase tracking-wider">{discordState?.is_muted ? 'Muet' : 'Mic'}</span>
                            </button>
                
                            <button
                                onClick={() => discordCommand("toggleDeafen")}
                                className={`flex items-center justify-center gap-2 py-3 rounded-xl border transition-all hover:scale-[1.02] active:scale-95 ${
                                    discordState?.is_deaf 
                                    ? 'bg-red-500/10 border-red-500/20 text-red-500 hover:bg-red-500/20' 
                                    : 'bg-white/5 border-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                                }`}
                            >
                                <Headphones className="w-4 h-4" />
                                <span className="text-[9px] font-black uppercase tracking-wider">{discordState?.is_deaf ? 'Sourd' : 'Casque'}</span>
                            </button>
                
                            <button
                                onClick={() => discordCommand("toggleCamera")}
                                className={`flex items-center justify-center gap-2 py-3 rounded-xl border transition-all hover:scale-[1.02] active:scale-95 ${
                                    discordState?.is_camera_on 
                                    ? 'bg-green-500/10 border-green-500/20 text-green-500 hover:bg-green-500/20' 
                                    : 'bg-white/5 border-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                                }`}
                            >
                                <MonitorPlay className="w-4 h-4" />
                                <span className="text-[9px] font-black uppercase tracking-wider">{discordState?.is_camera_on ? 'Cam ON' : 'Cam OFF'}</span>
                            </button>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}
