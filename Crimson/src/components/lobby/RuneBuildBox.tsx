import { RefreshCw } from 'lucide-react';
import type { RuneBuild } from '../../types';
import { getShardIcon } from '../../utils/lolDisplay';
import { useLCU } from '../../contexts/LCUContext';

const RuneBuildBox = ({ b, i }: { b: RuneBuild | null, i: number }) => {
    const { 
        runesData, handleSecondaryClick, handleShardClick, 
        doImport, isImporting 
    } = useLCU();

    if (!b) {
        return (
            <div className="h-full bg-[#0e0e11]/80 border border-white/5 p-3 flex flex-col items-center justify-center max-w-[320px] min-w-[260px] mx-auto w-full min-h-[360px] rounded-2xl">
                <div className="relative mb-6">
                    <div className="absolute -inset-4 bg-red-500/10 rounded-full blur-xl animate-pulse" />
                    <RefreshCw className="w-8 h-8 text-red-500/40 animate-spin-slow" />
                </div>
                <span className="text-[9px] font-black text-white/30 uppercase tracking-[0.4em] animate-pulse">AI Analyzing...</span>
                <div className="mt-8 flex gap-2">
                   <div className="w-2 h-2 bg-red-500/20 rounded-full animate-bounce [animation-delay:-0.3s]" />
                   <div className="w-2 h-2 bg-red-500/20 rounded-full animate-bounce [animation-delay:-0.15s]" />
                   <div className="w-2 h-2 bg-red-500/20 rounded-full animate-bounce" />
                </div>
            </div>
        );
    }

    const pTree = runesData.find((t: any) => t.id === b.primaryStyleId);
    const sTree = runesData.find((t: any) => t.id === b.subStyleId);

    const getIconUrl = (iconPath: string) => {
        // Normalize to CommunityDragon URL (lowercase)
        return `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/${iconPath.toLowerCase()}`;
    };

    return (
        <div className="h-full bg-[#0e0e11] border border-white/5 p-3 flex flex-col items-stretch max-w-[320px] min-w-[260px] mx-auto w-full overflow-hidden rounded-2xl animate-in zoom-in-95 duration-500">
            <div className="flex justify-between items-center mb-3">
                <h3 className="text-white font-bold uppercase tracking-[0.15em] text-[11px] truncate pr-2">{b.name}</h3>
                <div className="flex flex-col items-end shrink-0">
                    <span className="text-red-500 font-bold text-[13px] tracking-widest leading-none">{b.winrate}</span>
                    <span className="text-white/20 text-[6px] font-black uppercase mt-1">Winrate</span>
                </div>
            </div>
            
            <div className="flex-1 flex justify-center items-center gap-2 mb-3 py-4 border-y border-white/5 min-h-[260px]">
                {/* Primary Tree */}
                {pTree && (
                    <div className="flex flex-col items-center gap-2.5 shrink-0">
                        <div className="w-8 h-8 rounded-full border border-red-500/50 flex flex-col items-center justify-center bg-gradient-to-br from-red-900/40 to-black shadow-[0_0_8px_rgba(239,68,68,0.2)] p-1.5 mb-1">
                            <img src={getIconUrl(pTree.icon)} className="w-full h-full object-contain" alt="" />
                        </div>
                        {pTree.slots.map((slot: any, sIdx: number) => (
                            <div key={sIdx} className="flex gap-1.5">
                                {slot.runes.map((r: any, rIdx: number) => {
                                    // Ensure only ONE rune per slot/row is highlighted even if AI provides duplicates
                                    const isFirstMatchInSlot = slot.runes.findIndex((x: any) => b.perkIds.includes(x.id)) === rIdx;
                                    const sel = b.perkIds.includes(r.id) && isFirstMatchInSlot;
                                    
                                    const size = sIdx === 0 ? 'w-11 h-11' : 'w-7 h-7';
                                    return (
                                        <div key={r.id} className={`flex items-center justify-center rounded-full transition-all duration-300 ${sel ? (sIdx === 0 ? `${size} border-2 border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.4)] bg-black/60` : `${size} border border-red-500/60 bg-black/60 shadow-[0_0_8px_rgba(239,68,68,0.2)]`) : `${size} opacity-20 grayscale saturate-0 hover:grayscale-0 hover:opacity-100 hover:scale-110`} p-1`}>
                                            <img src={getIconUrl(r.icon)} className="w-full h-full object-contain" alt="" />
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                )}

                <div className="w-px h-2/3 bg-white/5 shrink-0 mx-1"></div>

                {/* Secondary Tree & Shards */}
                <div className="flex flex-col items-center gap-5 shrink-0">
                    {sTree && (
                        <div className="flex flex-col items-center gap-3">
                            <div className="w-8 h-8 rounded-full border border-white/20 flex flex-col items-center justify-center bg-[#111115] p-1.5 mb-0.5">
                                <img src={getIconUrl(sTree.icon)} className="w-full h-full object-contain" alt="" />
                            </div>
                            <div className="flex flex-col gap-2.5">
                                {sTree.slots.slice(1).map((slot: any, sIdx: number) => {
                                    return (
                                        <div key={sIdx} className="flex justify-center gap-1.5">
                                            {slot.runes.map((r: any) => {
                                                const sel = (b.perkIds || []).includes(r.id);
                                                return (
                                                    <div key={r.id} onClick={() => handleSecondaryClick(i, r.id, sIdx)} className={`flex items-center justify-center rounded-full transition-all duration-300 cursor-pointer hover:border-white/50 hover:scale-110 ${sel ? 'w-6 h-6 border border-emerald-500/50 bg-black/40 shadow-[0_0_6px_rgba(16,185,129,0.2)]' : 'w-6 h-6 opacity-20 grayscale saturate-0 hover:grayscale-0 hover:opacity-100'} p-1`}>
                                                        <img src={getIconUrl(r.icon)} className="w-full h-full object-contain" alt="" />
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Shards (Updated Grid to match S14/S15 Client) */}
                    <div className="flex flex-col gap-1.5 mt-1 pt-3 border-t border-white/5 w-full items-center">
                        {[
                           [5008, 5005, 5007], // Row 1: Adaptive, Atk Spd, CDR
                           [5008, 5002, 5003], // Row 2: Adaptive, Armor, MR
                           [5011, 5002, 5003]  // Row 3: HP Scaling, Armor, MR
                        ].map((row, rIdx) => (
                            <div key={rIdx} className="flex justify-center gap-2">
                                {row.map(shardId => {
                                    const sel = (b.shards || []).includes(shardId);
                                    return (
                                        <div key={shardId} onClick={() => handleShardClick(i, rIdx, shardId)} className={`w-4 h-4 rounded-full flex items-center justify-center transition-all duration-300 cursor-pointer border hover:border-white/50 hover:scale-110 ${sel ? 'border-amber-400/80 bg-[#1a1a20] shadow-[0_0_5px_rgba(251,191,36,0.3)]' : 'border-white/5 opacity-20 grayscale saturate-0 hover:grayscale-0 hover:opacity-100'} p-0.5`}>
                                            <img src={getShardIcon(shardId)} className="w-full h-full rounded-full" alt="" />
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            <button 
                onClick={() => doImport(b, i)} 
                disabled={isImporting !== null} 
                className={`mt-auto w-full py-3 transition-all text-neutral-300 font-black text-[10px] tracking-[0.25em] uppercase border ${isImporting === i ? 'bg-red-600/20 text-red-400 border-red-500/30' : 'bg-[#17171c] hover:bg-[#202026] hover:text-white border-white/5'}`}
            >
                {isImporting === i ? '⚡ Injection...' : 'Injecter les Runes'}
            </button>
        </div>
    );
};

export default RuneBuildBox;
