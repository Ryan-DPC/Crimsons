import { useLCU } from '../../contexts/LCUContext';
import { getChampArt, getChampName } from '../../utils/lolDisplay';

const ROLE_TRANSLATE: Record<string, string> = {
    'top': 'Haut',
    'jungle': 'Jungle',
    'middle': 'Milieu',
    'bottom': 'Bas',
    'utility': 'Support',
    '': 'Remplissage'
};

const ROLE_ORDER: Record<string, number> = { 'top': 1, 'jungle': 2, 'middle': 3, 'bottom': 4, 'utility': 5, '': 6 };

interface TeamCellProps {
    p: any;
    isBlue: boolean;
    forceMockMe?: boolean;
}

const TeamCell = ({ p, isBlue, forceMockMe }: TeamCellProps) => {
    const { lobbyState, radar, champs } = useLCU();
    
    const cid = p.championId || p.championPickIntent || 0;
    const art = getChampArt(cid, champs);
    const isMe = forceMockMe || p.cellId === (lobbyState?.localPlayerCellId ?? -1);
    const champName = getChampName(cid, champs);
    const displayName = isMe ? 'YOU' : (cid && champName !== 'Inconnu' ? champName : (isBlue ? 'Allié' : 'Ennemi'));

    return (
        <div className={`relative flex-1 min-w-0 shrink-0 max-w-[6.4rem] aspect-[20/28] h-auto bg-[#111115] border transition-colors ${isMe ? 'border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.3)]' : 'border-white/5'} overflow-hidden`}>
            {art && <img src={art} className={`absolute inset-0 w-full h-full object-cover object-top ${!p.championId ? 'grayscale opacity-50' : ''}`} alt="" />}
            <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0c] via-black/20 to-transparent"></div>
            
            {(() => {
                const r = radar.find((x: any) => x.puuid === p.puuid);
                if (!r) return null;
                if (r.isSmurf) return <div className="absolute inset-0 bg-blue-500/10 mix-blend-overlay pointer-events-none"></div>;
                if (r.isTilt || r.isTroll) return <div className="absolute inset-0 bg-red-500/20 mix-blend-overlay pointer-events-none"></div>;
                return null;
            })()}

            <div className="absolute bottom-0.5 w-full text-center px-0.5">
                <div className="text-[8px] sm:text-[9px] font-bold text-white uppercase tracking-wider truncate drop-shadow-md">
                    {displayName}
                </div>
            </div>
            <div className="absolute top-0.5 left-0.5 flex flex-col items-start gap-0.5">
                <div className="bg-black/80 text-white text-[7px] px-1 py-0.5 font-bold border border-white/5 uppercase shadow-sm">
                    {ROLE_TRANSLATE[p.assignedPosition] || (ROLE_ORDER[p.assignedPosition] ? p.assignedPosition : (isBlue ? 'BLUE' : 'RED'))}
                </div>
                {isBlue && !isMe && p.summonerId && p.summonerId !== 0 && p.summonerId !== '0' && (
                    <>
                        {p.summonerName && p.summonerName !== 'Allié' && p.summonerName !== 'Inconnu' && !p.summonerName.includes('Ennemi') ? (
                            <a 
                                href={`https://www.op.gg/summoners/euw/${encodeURIComponent(p.summonerName.replace('#', '-'))}`} 
                                target="_blank" 
                                rel="noreferrer"
                                className="bg-black/90 text-blue-400 hover:text-white hover:bg-blue-600 hover:border-blue-500 text-[7px] px-1 py-0.5 font-bold border border-blue-500/20 uppercase shadow-sm transition-colors truncate max-w-[3.2rem]"
                                title={`Voir le profil de ${p.summonerName} sur OP.GG`}
                            >
                                {p.summonerName.split('#')[0]}
                            </a>
                        ) : (
                            <span className="bg-black/90 text-neutral-500 text-[7px] px-1 py-0.5 font-bold border border-white/5 uppercase shadow-sm transition-colors truncate max-w-[3.2rem]">
                                Anon
                            </span>
                        )}
                        {(() => {
                            const r = radar.find((x: any) => x.puuid === p.puuid);
                            if (!r || r.winrate === null) return null;
                            return (
                                <div className="flex flex-col gap-0.5 mt-0.5">
                                    <div className={`text-[7px] px-1 py-0.5 border bg-black/80 font-bold flex items-center justify-between shadow-md ${r.isTilt ? 'text-red-400 border-red-500/40' : (r.isSmurf ? 'text-blue-400 border-blue-500/40' : 'text-neutral-400 border-white/10')}`}>
                                        <span>{r.winrate}%</span>
                                    </div>
                                    {r.isTroll && (
                                        <div className="bg-red-600 text-white text-[6px] font-black p-0.5 text-center uppercase tracking-tighter">TROLL</div>
                                    )}
                                    {(r.isTilt || r.isTroll) && (
                                        <div className="bg-red-900/80 text-white text-[6px] font-black p-0.5 text-center uppercase border border-red-500">DODGE</div>
                                    )}
                                    {r.isSmurf && (
                                        <div className="bg-blue-600 text-white text-[6px] font-black p-0.5 text-center uppercase">SMURF</div>
                                    )}
                                </div>
                            );
                        })()}
                    </>
                )}
            </div>
        </div>
    );
};

export default TeamCell;
