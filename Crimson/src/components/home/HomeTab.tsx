import { useState } from 'react';
import { useLCU } from '../../contexts/LCUContext';
import { getChampIcon } from '../../utils/lolDisplay';

const HomeTab = () => {
    const { 
        sum, v, appData, toggleAutoBan, toggleAutoPick, 
        champs 
    } = useLCU();

    const [searchChamp, setSearchChamp] = useState('');

    return (
        <div className="w-full max-w-5xl mx-auto space-y-6 mt-12 px-8 animate-in fade-in duration-500">
            <div className="bg-[#111115] border border-white/5 p-8 flex justify-between items-center shadow-2xl">
                <div className="flex items-center gap-6">
                    {sum ? <img src={`https://ddragon.leagueoflegends.com/cdn/${v}/img/profileicon/${sum.profileIconId}.png`} className="w-20 h-20 border border-white/10 rounded-lg shadow-lg" alt="Icone" /> : <div className="w-20 h-20 bg-[#0a0a0c] border border-white/5 rounded-lg" />}
                    <div>
                        <h2 className="text-2xl font-bold text-white uppercase tracking-widest">{sum ? (sum.displayName || sum.gameName) : 'En attente...'}</h2>
                        <p className="text-neutral-500 text-xs font-semibold uppercase tracking-widest mt-1">{sum ? `Niveau ${sum.summonerLevel}` : 'Client fermé'}</p>
                    </div>
                </div>
                <div className="flex flex-col items-end gap-3">
                    <span className={`px-3 py-1 text-[10px] font-bold uppercase tracking-widest border rounded-sm ${sum ? 'text-green-500 border-green-500/30 bg-green-500/10' : 'text-neutral-500 border-neutral-700 bg-neutral-800/50'}`}>
                        {sum ? 'En Ligne' : 'Hors Ligne'}
                    </span>
                </div>
            </div>

            <div className="bg-[#111115] border border-white/5 p-8 flex flex-col gap-6 shadow-xl">
                <div className="flex justify-between items-end border-b border-white/5 pb-4">
                    <div>
                        <h3 className="text-lg font-bold text-white uppercase tracking-widest">Auto Selection</h3>
                        <p className="text-neutral-500 text-[10px] uppercase font-bold mt-1">Configurez vos bans et picks automatiques</p>
                    </div>
                    <div className="relative">
                        <input 
                            type="text" 
                            placeholder="RECHERCHER..." 
                            value={searchChamp}
                            onChange={(e) => setSearchChamp(e.target.value)}
                            className="bg-[#0a0a0c] border border-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-widest focus:border-red-500/50 outline-none w-48 transition-colors"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 gap-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                    {champs
                        .filter(c => c.name.toLowerCase().includes(searchChamp.toLowerCase()))
                        .map(c => {
                            const isBan = appData?.autoBan === c.id;
                            const isPick = appData?.autoPick === c.id;
                            return (
                            <div key={c.id} className={`relative group aspect-square bg-[#050505] rounded-xl border transition-all duration-300 overflow-hidden cursor-pointer ${isBan ? 'border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)]' : isPick ? 'border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]' : 'border-white/5 hover:border-white/20'}`}>
                                <img src={getChampIcon(c.id, champs, v)} className={`w-full h-full object-cover transition-transform duration-700 group-hover:scale-110 ${isBan || isPick ? '' : 'opacity-70 group-hover:opacity-100'}`} alt={c.name} />
                                
                                {/* Always visible name gradient */}
                                <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black via-black/80 to-transparent flex items-end justify-center pb-1.5 pointer-events-none">
                                    <span className={`text-[9px] font-black uppercase tracking-widest truncate px-2 ${isBan ? 'text-red-400' : isPick ? 'text-blue-400' : 'text-white/80'}`}>{c.name}</span>
                                </div>

                                {/* Hover action overlay */}
                                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-all duration-300 flex flex-col items-center justify-center p-2 gap-2">
                                    <button onClick={() => toggleAutoPick(c.id)} className={`w-full py-1.5 rounded text-[9px] font-black uppercase tracking-widest transition-all ${isPick ? 'bg-blue-600 text-white shadow-[0_0_10px_rgba(37,99,235,0.5)]' : 'bg-black/50 text-blue-400 border border-blue-500/30 hover:bg-blue-600 hover:text-white hover:border-blue-500'}`}>Pick</button>
                                    <button onClick={() => toggleAutoBan(c.id)} className={`w-full py-1.5 rounded text-[9px] font-black uppercase tracking-widest transition-all ${isBan ? 'bg-red-600 text-white shadow-[0_0_10px_rgba(220,38,38,0.5)]' : 'bg-black/50 text-red-400 border border-red-500/30 hover:bg-red-600 hover:text-white hover:border-red-500'}`}>Ban</button>
                                </div>
                                
                                {/* Top indicators */}
                                {isPick && <div className="absolute top-0 right-0 bg-blue-600 text-white text-[8px] font-black px-2 py-0.5 rounded-bl-lg shadow-md">P</div>}
                                {isBan && <div className="absolute top-0 right-0 bg-red-600 text-white text-[8px] font-black px-2 py-0.5 rounded-bl-lg shadow-md">B</div>}
                            </div>
                        )})}
                </div>
            </div>
        </div>
    );
};

export default HomeTab;
