import { useLCU } from '../../contexts/LCUContext';
import { getChampIcon } from '../../utils/lolDisplay';

const HistoryTab = () => {
    const { hist, champs, v } = useLCU();
    
    const Q_MAP: Record<string, string> = {
        'RANKED_SOLO_5x5': 'Solo Q',
        'RANKED_FLEX_SR': 'Flex Q',
        'ARAM': 'ARAM',
        'NORMAL_5x5_BLIND': 'Normal',
        '420': 'Classé Solo/Duo',
        '440': 'Classé Flexible',
        '400': 'Normal Draft',
        '430': 'Normal Aveugle',
        '450': 'ARAM',
        '900': 'URF',
        '1090': 'TFT Normal',
        '1100': 'TFT Classé',
    };

    return (
        <div className="w-full max-w-5xl mx-auto space-y-4 mt-8 px-8 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex justify-between items-end mb-6 border-b border-white/5 pb-4">
                <h2 className="text-xl font-bold text-white uppercase tracking-widest">Dernières Parties</h2>
                <div className="text-[10px] text-neutral-500 font-bold uppercase tracking-widest">{hist.length} MATCHS ENREGISTRÉS</div>
            </div>
            
            <div className="space-y-3">
                {hist.map((m, i) => {
                    const isRemake = m.gameDuration > 0 && m.gameDuration < 300;
                    const borderClass = isRemake ? 'border-neutral-500' : (m.stats?.win ? 'border-blue-500' : 'border-red-500');
                    const textClass = isRemake ? 'text-neutral-400' : (m.stats?.win ? 'text-blue-400' : 'text-red-400');
                    const resultText = isRemake ? 'ANNULÉ' : (m.stats?.win ? 'VICTOIRE' : 'DÉFAITE');

                    return (
                        <div key={i} className={`flex items-center gap-6 p-4 bg-[#111115] border-l-4 transition-all hover:bg-[#16161c] ${borderClass}`}>
                            <div className="relative w-14 h-14 shrink-0">
                                <img src={getChampIcon(m.championId, champs, v)} className="w-full h-full object-cover border border-white/10" alt="" />
                            </div>
                            <div className="flex-1">
                                <div className="text-[10px] font-black uppercase tracking-widest text-neutral-500 mb-1">{Q_MAP[String(m.gameQueueId)] || 'Autre'} • {Math.floor(m.gameDuration / 60)}m</div>
                                <div className="flex items-center gap-3">
                                    <span className={`text-lg font-black tracking-tighter ${textClass}`}>{resultText}</span>
                                    <div className="h-4 w-px bg-white/10"></div>
                                    <div className="text-sm font-bold text-neutral-300">
                                        <span className="text-white">{m.stats?.kills}</span> / <span className="text-red-500">{m.stats?.deaths}</span> / <span className="text-white">{m.stats?.assists}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="text-right">
                                 <div className="text-[10px] font-bold text-neutral-500 uppercase">{new Date(m.gameCreation).toLocaleDateString()}</div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default HistoryTab;
