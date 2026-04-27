import type { RuneBuild, RadarResult } from '../../types';
import TeamCell from './TeamCell';
import RuneBuildBox from './RuneBuildBox';
import { getChampName } from '../../utils/lolDisplay';

const PHASE_TRANSLATE: Record<string, string> = {
    'PLANNING': 'Déclaration',
    'BAN_PICK': 'Ban / Pick',
    'FINALIZATION': 'Préparation',
    'GAME_STARTING': 'Lancement'
};

const ROLE_ORDER: Record<string, number> = { 'top': 1, 'jungle': 2, 'middle': 3, 'bottom': 4, 'utility': 5, '': 6 };

interface LobbyTabProps {
    myChamp: number;
    forceMockLobby: boolean;
    champs: any[];
    builds: RuneBuild[];
    runesData: any[];
    lobbyMyTeam: any[];
    lobbyTheirTeam: any[];
    lobbyState: any;
    radar: RadarResult[];
    isImporting: number | null;
    handleSecondaryClick: (buildIndex: number, runeId: number, slotIndex: number) => void;
    handleShardClick: (buildIndex: number, rIdx: number, shardId: number) => void;
    doImport: (build: RuneBuild, index: number) => void;
    setForceMockLobby: (val: boolean) => void;
}

const LobbyTab = ({
    myChamp, forceMockLobby, champs, builds, runesData,
    lobbyMyTeam, lobbyTheirTeam, lobbyState, radar, isImporting,
    handleSecondaryClick, handleShardClick, doImport, setForceMockLobby
}: LobbyTabProps) => {
    return (
        <div className="w-full h-full flex flex-col">
            <div className="flex-1 w-full p-8 flex flex-col">
                {(myChamp > 0 || forceMockLobby) ? (
                    <div className="w-full max-w-6xl mx-auto animate-in fade-in duration-500">
                        <div className="border-b border-white/5 pb-4 mb-6 flex justify-between items-end">
                            <h2 className="text-3xl font-bold text-white uppercase tracking-widest">{getChampName(forceMockLobby ? 222 : myChamp, champs)}</h2>
                            <span className="text-white/30 text-xs font-bold uppercase tracking-widest">Analytique</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {builds.map((b, i) => (
                                <RuneBuildBox 
                                    key={i} b={b} i={i} runesData={runesData} 
                                    handleSecondaryClick={handleSecondaryClick}
                                    handleShardClick={handleShardClick}
                                    doImport={doImport}
                                    isImporting={isImporting}
                                />
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center opacity-80">
                        <div className="text-center bg-[#111115] border border-white/5 p-12 rounded-xl shadow-2xl relative overflow-hidden group">
                            <div className="absolute inset-0 bg-red-500/5 translate-y-full group-hover:translate-y-0 transition-transform duration-700 ease-out"></div>
                            <div className="w-20 h-20 mx-auto mb-6 rounded-full border border-white/10 flex items-center justify-center bg-[#0a0a0c] relative z-10">
                                <svg className="w-8 h-8 text-neutral-500 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                            </div>
                            <h2 className="text-2xl font-bold text-neutral-200 uppercase tracking-widest relative z-10">En attente de sélection</h2>
                            <p className="text-neutral-500 text-xs font-bold mt-2 uppercase tracking-widest mb-8 relative z-10">Entrez dans un lobby (Draft) pour scanner l'équipe</p>
                        </div>
                    </div>
                )}
            </div>

            <div className="w-full bg-[#0a0a0c] border-t border-white/5 py-6 flex justify-between items-center px-4 sm:px-12 mt-auto">
                <div className="flex flex-1 justify-start gap-1 sm:gap-2 overflow-hidden">
                    {(lobbyMyTeam.length > 0 || forceMockLobby) ? (forceMockLobby ? [
                        { summonerName: 'Allié 1', assignedPosition: 'top', puuid: 'test-1', cellId: 0 },
                        { summonerName: 'Allié 2', assignedPosition: 'jungle', puuid: 'test-2', cellId: 1 },
                        { summonerName: 'KCorp Laoy#KCB', assignedPosition: 'middle', championId: 517, cellId: 2 },
                        { summonerName: 'Allié 4', assignedPosition: 'bottom', puuid: 'test-4', cellId: 3 },
                        { summonerName: 'Allié 5', assignedPosition: 'utility', puuid: 'test-5', cellId: 4 }
                    ] : lobbyMyTeam).map((p, i) => <TeamCell key={i} p={p} isBlue={true} forceMockMe={forceMockLobby && p.cellId === 2} lobbyState={lobbyState} radar={radar} champs={champs} />) : [1, 2, 3, 4, 5].map(i => <div key={i} className="flex-1 min-w-[3rem] max-w-[5.5rem] aspect-[20/28] h-auto bg-[#111115] border border-white/5" />)}
                </div>

                <div className="text-center px-4 sm:px-8 shrink-0 min-w-[100px]">
                    <div className="text-4xl font-bold text-neutral-100 font-mono tracking-widest">{forceMockLobby ? '30' : (lobbyState?.timer?.adjustedTimeLeftInPhase ? Math.floor(lobbyState.timer.adjustedTimeLeftInPhase / 1000) : '--')}</div>
                    <div className="text-[10px] text-white/30 font-bold uppercase tracking-widest mt-1">{forceMockLobby ? 'ATTENTE' : (PHASE_TRANSLATE[lobbyState?.timer?.phase] || lobbyState?.timer?.phase || 'ATTENTE')}</div>
                </div>

                <div className="flex flex-1 justify-end gap-1 sm:gap-2 overflow-hidden">
                    {(lobbyTheirTeam.length > 0 || forceMockLobby) ? (forceMockLobby ? [84, 157, 4, 202, 111].map((id, i) => ({ summonerName: 'Ennemi ' + (i + 1), assignedPosition: '', championId: id })) : [...lobbyTheirTeam].sort((a, b) => (ROLE_ORDER[a.assignedPosition] || 6) - (ROLE_ORDER[b.assignedPosition] || 6))).map((p, i) => <TeamCell key={i} p={p} isBlue={false} lobbyState={lobbyState} radar={radar} champs={champs} />) : [1, 2, 3, 4, 5].map(i => <div key={i} className="flex-1 min-w-[3rem] max-w-[5.5rem] aspect-[20/28] h-auto bg-[#111115] border border-white/5" />)}
                </div>
            </div>

            {forceMockLobby && (
                <button onClick={() => setForceMockLobby(false)} className="absolute top-24 right-8 bg-red-600/20 hover:bg-red-600 text-white p-2 border border-red-500/50 transition-colors z-50">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            )}
        </div>
    );
};

export default LobbyTab;
