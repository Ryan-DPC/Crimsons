import type { RuneBuild } from '../../types';
import { getShardIcon } from '../../utils/lolDisplay';

interface RuneBuildBoxProps {
    b: RuneBuild;
    i: number;
    runesData: any[];
    handleSecondaryClick: (buildIndex: number, runeId: number, slotIndex: number) => void;
    handleShardClick: (buildIndex: number, rIdx: number, shardId: number) => void;
    doImport: (build: RuneBuild, index: number) => void;
    isImporting: number | null;
}

const RuneBuildBox = ({ b, i, runesData, handleSecondaryClick, handleShardClick, doImport, isImporting }: RuneBuildBoxProps) => {
    const pTree = runesData.find(t => t.id === b.primaryStyleId);
    const sTree = runesData.find(t => t.id === b.subStyleId);

    return (
        <div className="bg-[#0e0e11] border border-white/5 p-6 flex flex-col items-stretch">
            <div className="flex justify-between items-center mb-6">
                <h3 className="text-white font-bold uppercase tracking-wider text-[13px]">{b.name}</h3>
                <span className="text-red-500 font-bold text-[13px] tracking-widest">{b.winrate}</span>
            </div>
            <div className="flex-1 flex justify-center items-start gap-4 mb-8 py-6 border-y border-white-[0.03]">
                {/* Primary Tree Full Layout */}
                {pTree && (
                    <div className="flex flex-col items-center gap-3">
                        <div className="w-10 h-10 rounded-full border-2 border-red-500/50 flex flex-col items-center justify-center bg-gradient-to-br from-red-900/40 to-black shadow-[0_0_15px_rgba(239,68,68,0.15)] p-2 mb-2">
                            <img src={`https://ddragon.leagueoflegends.com/cdn/img/${pTree.icon}`} className="w-full h-full object-contain" alt="" />
                        </div>
                        {pTree.slots.map((slot: any, sIdx: number) => (
                            <div key={sIdx} className="flex gap-2">
                                {slot.runes.map((r: any) => {
                                    const sel = b.perkIds.includes(r.id);
                                    return (
                                        <div key={r.id} className={`flex items-center justify-center rounded-full transition-all ${sel ? (sIdx === 0 ? 'w-10 h-10 border border-red-500/30 shadow-[0_0_8px_rgba(239,68,68,0.3)] bg-black/40' : 'w-8 h-8 border border-white/10 bg-black/40') : 'w-8 h-8 opacity-30 grayscale saturate-0 hover:grayscale-0 hover:opacity-100'} p-1`}>
                                            <img src={`https://ddragon.leagueoflegends.com/cdn/img/${r.icon}`} className="w-full h-full object-contain" alt="" />
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                )}

                <div className="w-px h-full min-h-[250px] bg-white/5"></div>

                {/* Secondary Tree & Shards */}
                <div className="flex flex-col flex-1 items-center gap-3">
                    {sTree && (
                        <>
                            <div className="w-8 h-8 rounded-full border border-white/20 flex flex-col items-center justify-center bg-[#111115] p-1.5 mb-2">
                                <img src={`https://ddragon.leagueoflegends.com/cdn/img/${sTree.icon}`} className="w-full h-full object-contain" alt="" />
                            </div>
                            <div className="flex flex-col gap-3 w-full">
                                {sTree.slots.slice(1).map((slot: any, sIdx: number) => {
                                    return (
                                        <div key={sIdx} className="flex justify-center gap-2 w-full">
                                            {slot.runes.map((r: any) => {
                                                const sel = b.perkIds.includes(r.id);
                                                return (
                                                    <div key={r.id} onClick={() => handleSecondaryClick(i, r.id, sIdx)} className={`flex items-center justify-center rounded-full transition-all cursor-pointer hover:border-white/50 ${sel ? 'w-7 h-7 border border-red-500/50 bg-black/40 shadow-[0_0_8px_rgba(239,68,68,0.2)]' : 'w-7 h-7 opacity-30 grayscale saturate-0 hover:grayscale-0 hover:opacity-100'} p-1`}>
                                                        <img src={`https://ddragon.leagueoflegends.com/cdn/img/${r.icon}`} className="w-full h-full object-contain" alt="" />
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}

                    {/* Shards */}
                    <div className="flex flex-col gap-2 mt-4 pt-4 border-t border-white/5 w-full items-center">
                        {[[5008, 5005, 5007], [5008, 5010, 5013], [5011, 5002, 5003]].map((row, rIdx) => (
                            <div key={rIdx} className="flex justify-center gap-2">
                                {row.map(shardId => {
                                    const sel = b.shards[rIdx] === shardId;
                                    return (
                                        <div key={shardId} onClick={() => handleShardClick(i, rIdx, shardId)} className={`w-5 h-5 rounded-full flex items-center justify-center transition-all cursor-pointer hover:border-white/50 ${sel ? 'border border-red-500/50 bg-black/40 shadow-[0_0_5px_rgba(239,68,68,0.3)]' : 'opacity-30 grayscale saturate-0 hover:grayscale-0 hover:opacity-100'} p-0.5`}>
                                            <img src={getShardIcon(shardId)} className="w-4 h-4 rounded-full" alt="" />
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            <button onClick={() => doImport(b, i)} disabled={isImporting !== null} className={`mt-auto w-full py-3.5 transition-all text-neutral-300 font-bold text-[11px] tracking-[0.2em] uppercase border border-white/5 ${isImporting === i ? 'bg-red-600/20 text-red-400 border-red-500/30' : 'bg-[#17171c] hover:bg-[#202026]'}`}>
                {isImporting === i ? 'Injection...' : 'Appliquer'}
            </button>
        </div>
    );
};

export default RuneBuildBox;
