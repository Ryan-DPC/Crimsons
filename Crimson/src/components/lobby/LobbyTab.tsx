import { useState, useEffect } from 'react';
import TeamCell from './TeamCell';
import RuneBuildBox from './RuneBuildBox';
import { useLCU } from '../../contexts/LCUContext';
import { getChampName } from '../../utils/lolDisplay';
import { RefreshCw } from 'lucide-react';

const PHASE_TRANSLATE: Record<string, string> = {
    'PLANNING': 'Déclaration',
    'BAN_PICK': 'Ban / Pick',
    'FINALIZATION': 'Préparation',
    'GAME_STARTING': 'Lancement'
};

const LobbyTab = () => {
    const { 
        myChamp, champs, builds, runesData, 
        lobbyMyTeam, lobbyTheirTeam, lobbyState, 
        isLoadingBuilds, appData
    } = useLCU();

    const [simMode] = useState(false);

    const getRuneIcon = (id: number) => {
        for (const tree of runesData) {
            for (const slot of tree.slots) {
                const rune = slot.runes.find((r: any) => r.id === id);
                if (rune) return rune.icon;
            }
        }
        return '';
    };

    // --- LOGIQUE DE SIMULATION INTERNE ---
    const simBuilds: any[] = [
        {
            name: "Méta Standard",
            winrate: "54.2%",
            banrate: "12%",
            primaryStyleId: 8100,
            subStyleId: 8000,
            perkIds: [8112, 8139, 8138, 8105, 8009, 8014],
            shards: [5008, 5008, 5002],
            spells: [4, 14]
        },
        {
            name: "Contre Akali",
            winrate: "56.1%",
            banrate: "22%",
            primaryStyleId: 8100,
            subStyleId: 8400,
            perkIds: [8112, 8143, 8138, 8106, 8473, 8451],
            shards: [5008, 5008, 5003],
            spells: [4, 14],
            counters: [
                { name: "Vex", keystoneId: 8112 },
                { name: "Fizz", keystoneId: 8112 },
                { name: "Pantheon", keystoneId: 8010 }
            ]
        },
        {
            name: "Scaling Late",
            winrate: "51.5%",
            banrate: "5%",
            primaryStyleId: 8000,
            subStyleId: 8300,
            perkIds: [8010, 9111, 9104, 8299, 8345, 8347],
            shards: [5005, 5008, 5001],
            spells: [4, 12]
        }
    ];

    const simMyTeam = [
        { summonerName: 'Allié 1', assignedPosition: 'top', championId: 266, cellId: 0 },
        { summonerName: 'Allié 2', assignedPosition: 'jungle', championId: 64, cellId: 1 },
        { summonerName: 'KCorp Laoy#KCB', assignedPosition: 'middle', championId: 517, cellId: 2, puuid: 'me' },
        { summonerName: 'Allié 4', assignedPosition: 'bottom', championId: 222, cellId: 3 },
        { summonerName: 'Allié 5', assignedPosition: 'utility', championId: 111, cellId: 4 }
    ];

    const simTheirTeam = [
        { summonerName: 'Ennemi 1', assignedPosition: 'top', championId: 122 },
        { summonerName: 'Ennemi 2', assignedPosition: 'jungle', championId: 121 },
        { summonerName: 'Ennemi 3', assignedPosition: 'middle', championId: 84 },
        { summonerName: 'Ennemi 4', assignedPosition: 'bottom', championId: 81 },
        { summonerName: 'Ennemi 5', assignedPosition: 'utility', championId: 53 }
    ];

    const activeBuilds = simMode ? simBuilds : builds;
    const activeMyTeam = simMode ? simMyTeam : lobbyMyTeam;
    const activeTheirTeam = simMode ? simTheirTeam : lobbyTheirTeam;
    const activeCounters = (simMode ? simBuilds[1].counters : builds.find(b => b?.counters)?.counters) || [];
    const activeChampId = simMode ? 517 : myChamp;

    const [scanKey, setScanKey] = useState(0);

    useEffect(() => {
        if (activeChampId !== 0) {
            setScanKey(prev => prev + 1);
        }
    }, [activeChampId]);

    const getSimChampName = (id: number) => {
        if (id === 517) return "Sylas";
        return getChampName(id, champs);
    };

    const getSimChampAlias = (id: number, name?: string) => {
        const c = champs.find(x => x.id === id || (name && x.name.toLowerCase() === name.toLowerCase()));
        if (c) return c.alias;
        if (id === 517 || name === "Sylas") return "Sylas";
        if (id === 266) return "Aatrox";
        if (id === 64) return "LeeSin";
        if (id === 222) return "Jinx";
        if (id === 111) return "Nautilus";
        if (id === 122) return "Darius";
        if (id === 121) return "Khazix";
        if (id === 84) return "Akali";
        if (id === 81) return "Ezreal";
        if (id === 53) return "Blitzcrank";
        if (name === "Vex") return "Vex";
        if (name === "Fizz") return "Fizz";
        if (name === "Pantheon") return "Pantheon";
        return "Unknown";
    };

    return (
        <div className="flex-1 flex flex-col min-h-[600px] relative">
            {activeChampId !== 0 && <div key={scanKey} className="scanning-line" />}
            
            {/* Middle/Main Section: Champion Info + AI Builds Analysis (Scrollable) */}
            <div className="flex-1 overflow-y-auto px-2 pt-2 pb-[220px] custom-scrollbar animate-in fade-in duration-700">
                <div className="w-full max-w-7xl mx-auto">
                    <div className="border-b border-white/5 pb-3 mb-6 flex justify-between items-end">
                        <div className="flex flex-col">
                            <span className="text-red-500/60 text-[9px] font-black uppercase tracking-[0.4em] mb-1.5">
                                {simMode ? 'Aperçu Simulation' : (activeChampId === 0 ? 'Attente de Sélection' : 'Champion Actuellement Sélectionné')}
                            </span>
                            <h2 key={activeChampId} className="text-4xl font-black text-white uppercase tracking-tighter leading-none flex items-center gap-4">
                                {activeChampId === 0 ? '--' : getSimChampName(activeChampId)}
                                {isLoadingBuilds && <span className="text-[10px] text-red-500 animate-pulse font-bold bg-red-500/5 px-2 py-1 rounded border border-red-500/20 normal-case tracking-normal">AI Analyzing Meta...</span>}
                            </h2>
                        </div>
                        
                        {/* Draft Warnings / Counters anchor */}
                        {(appData?.draftWarnings !== false) && activeCounters && activeCounters.length > 0 && (
                            <div className="flex flex-col items-end gap-1.5 animate-in fade-in slide-in-from-right-4 duration-1000">
                                <span className="text-[8px] text-red-500 font-black uppercase tracking-[0.2em] bg-red-500/10 px-2 py-0.5 border border-red-500/20 rounded">Analyse du Draft : Counters Suggérés</span>
                                <div className="flex gap-3">
                                    {activeCounters.map((cug: any, idx: number) => {
                                        const alias = getSimChampAlias(0, cug.name);
                                        const rIcon = getRuneIcon(cug.keystoneId);
                                        return alias ? (
                                            <div key={idx} className="group relative">
                                                <div className="relative">
                                                    <img src={`https://ddragon.leagueoflegends.com/cdn/${lobbyState?.v || '15.5.1'}/img/champion/${alias}.png`} className="w-10 h-10 border border-red-500/40 rounded-lg shadow-2xl transition-all duration-300 group-hover:scale-110 group-hover:border-red-500" alt={cug.name} />
                                                    {rIcon && (
                                                        <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-black rounded-full border border-red-500/60 flex items-center justify-center p-1 shadow-2xl">
                                                            <img src={`https://ddragon.leagueoflegends.com/cdn/img/${rIcon}`} className="w-full h-full object-contain" alt="Keystone" />
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ) : null;
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
                        {activeBuilds.length > 0 ? activeBuilds.map((b, i) => (
                            <RuneBuildBox key={i} b={b} i={i} />
                        )) : (
                            <div className="col-span-full h-64 border border-dashed border-white/5 rounded-3xl flex items-center justify-center bg-white/[0.02]">
                                <div className="flex flex-col items-center gap-4 text-white/10 select-none">
                                    <RefreshCw className="w-12 h-12" />
                                    <span className="text-xs font-black uppercase tracking-[0.5em]">Attente des données du client...</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Bottom Floating Grid: Team Draft (Portraits + Bans) - Anchored at the Absolute Bottom of the tab */}
            <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-black via-black/80 to-transparent pt-20 pb-4 px-4 pointer-events-none z-30">
                <div className="w-full max-w-[1500px] mx-auto flex justify-between items-end gap-6 pointer-events-auto pb-4">
                    {/* Blue Team Side */}
                    <div className="flex flex-1 items-end gap-4 min-w-0">
                        <div className="flex flex-1 gap-1.5 min-w-0">
                            {activeMyTeam.length > 0 ? activeMyTeam.map((p, i) => (
                                <TeamCell key={i} p={p} isBlue={true} forceMockMe={simMode && p.cellId === 2} />
                            )) : [1, 2, 3, 4, 5].map(i => <div key={i} className="flex-1 min-w-0 max-w-[6.4rem] aspect-[20/28] h-auto bg-white/5 border border-white/5 rounded-md" />)}
                        </div>

                        {/* Blue Team Bans */}
                        <div className="flex flex-col gap-2 shrink-0 mb-1">
                            <span className="text-[7px] text-blue-500/60 font-black uppercase tracking-widest text-center">Bans</span>
                            <div className="flex gap-1">
                                {[0, 1, 2, 3, 4].map(idx => {
                                    const ban = lobbyState?.actions?.flat().find((a: any) => a.type === 'ban' && a.actorCellId === idx && a.completed);
                                    return (
                                        <div key={idx} className="w-7 h-7 bg-black/60 border border-white/10 flex items-center justify-center grayscale opacity-60 overflow-hidden rounded shadow-inner shrink-0 scale-90">
                                            {ban && ban.championId > 0 && (
                                                <img src={`https://ddragon.leagueoflegends.com/cdn/${lobbyState?.v || '15.5.1'}/img/champion/${champs.find((c: any) => c.id === ban.championId)?.alias || getChampName(ban.championId, champs)}.png`} className="w-full h-full object-cover" alt="" />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Center: Timer & Phase Info - Simplified */}
                    <div className="text-center px-4 shrink-0 flex flex-col items-center justify-center gap-1 min-w-[140px] pb-4">
                        <div className="text-6xl font-black text-neutral-100 font-mono tracking-tighter drop-shadow-[0_0_20px_rgba(255,255,255,0.4)] italic leading-none">
                            {simMode ? '30' : (lobbyState?.timer?.displayTime !== undefined ? Math.max(0, Math.floor(lobbyState.timer.displayTime / 1000)) : (lobbyState?.timer?.adjustedTimeLeftInPhase ? Math.max(0, Math.floor(lobbyState.timer.adjustedTimeLeftInPhase / 1000)) : '--'))}
                        </div>
                        <div className="text-[10px] text-red-500 font-black uppercase tracking-[0.5em] drop-shadow-lg">
                            {simMode ? 'BAN / PICK' : (PHASE_TRANSLATE[lobbyState?.timer?.phase] || lobbyState?.timer?.phase || 'ATTENTE')}
                        </div>
                    </div>

                    {/* Red Team Side */}
                    <div className="flex flex-1 flex-row-reverse items-end gap-4 min-w-0">
                        <div className="flex flex-1 flex-row-reverse gap-1.5 min-w-0">
                            {activeTheirTeam.length > 0 ? activeTheirTeam.map((p, i) => (
                                <TeamCell key={i} p={p} isBlue={false} />
                            )) : [1, 2, 3, 4, 5].map(i => <div key={i} className="flex-1 min-w-0 max-w-[6.4rem] aspect-[20/28] h-auto bg-white/5 border border-white/5 rounded-md" />)}
                        </div>

                        {/* Red Team Bans */}
                        <div className="flex flex-col gap-2 shrink-0 mb-1">
                            <span className="text-[7px] text-red-500/60 font-black uppercase tracking-widest text-center">Bans</span>
                            <div className="flex gap-1 flex-row-reverse">
                                {[5, 6, 7, 8, 9].map(idx => {
                                    const ban = lobbyState?.actions?.flat().find((a: any) => a.typePos === 'ban' || (a.type === 'ban' && a.actorCellId === idx && a.completed));
                                    return (
                                        <div key={idx} className="w-7 h-7 bg-black/60 border border-white/10 flex items-center justify-center grayscale opacity-60 overflow-hidden rounded shadow-inner shrink-0 scale-90">
                                            {ban && ban.championId > 0 && (
                                                <img src={`https://ddragon.leagueoflegends.com/cdn/${lobbyState?.v || '15.5.1'}/img/champion/${champs.find((c: any) => c.id === ban.championId)?.alias || getChampName(ban.championId, champs)}.png`} className="w-full h-full object-cover" alt="" />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LobbyTab;
