import type { Summoner } from '../../types';
import { getChampIcon } from '../../utils/lolDisplay';

interface HomeTabProps {
    sum: Summoner | null;
    v: string;
    data: any;
    toggleAutoBan: (id: number) => void;
    toggleAutoPick: (id: number) => void;
    champs: any[];
    searchChamp: string;
    setSearchChamp: (val: string) => void;
}

const HomeTab = ({ sum, v, data, toggleAutoBan, toggleAutoPick, champs, searchChamp, setSearchChamp }: HomeTabProps) => {
    return (
        <div className="w-full max-w-5xl mx-auto space-y-6 mt-12 px-8 animate-in fade-in duration-500">
            <div className="bg-[#111115] border border-white/5 p-8 flex justify-between items-center">
                <div className="flex items-center gap-6">
                    {sum ? <img src={`https://ddragon.leagueoflegends.com/cdn/${v}/img/profileicon/${sum.profileIconId}.png`} className="w-20 h-20 border border-white/10" alt="Icone" /> : <div className="w-20 h-20 bg-[#0a0a0c] border border-white/5" />}
                    <div>
                        <h2 className="text-2xl font-bold text-white uppercase tracking-widest">{sum ? (sum.displayName || sum.gameName) : 'En attente...'}</h2>
                        <p className="text-neutral-500 text-xs font-semibold uppercase tracking-widest mt-1">{sum ? `Niveau ${sum.summonerLevel}` : 'Client fermé'}</p>
                    </div>
                </div>
                <div className="text-right">
                    <span className={`px-3 py-1 text-[10px] font-bold uppercase tracking-widest border ${sum ? 'text-green-500 border-green-500/30 bg-green-500/10' : 'text-neutral-500 border-neutral-700 bg-neutral-800/50'}`}>
                        {sum ? 'En Ligne' : 'Hors Ligne'}
                    </span>
                </div>
            </div>

            <div className="bg-[#111115] border border-white/5 p-8 flex flex-col gap-6">
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
                        .map(c => (
                            <div key={c.id} className="relative group aspect-square bg-black border border-white/5 overflow-hidden">
                                <img src={getChampIcon(c.id, champs, v)} className={`w-full h-full object-cover transition-transform group-hover:scale-110 ${data?.autoBan === c.id || data?.autoPick === c.id ? '' : 'opacity-60'}`} alt={c.name} />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1">
                                    <button onClick={() => toggleAutoBan(c.id)} className={`w-full py-1 text-[8px] font-bold uppercase ${data?.autoBan === c.id ? 'bg-red-600 text-white' : 'bg-black/80 text-red-500 hover:bg-red-600 hover:text-white'}`}>Ban</button>
                                    <button onClick={() => toggleAutoPick(c.id)} className={`w-full py-1 text-[8px] font-bold uppercase ${data?.autoPick === c.id ? 'bg-blue-600 text-white' : 'bg-black/80 text-blue-500 hover:bg-blue-600 hover:text-white'}`}>Pick</button>
                                </div>
                                {data?.autoBan === c.id && <div className="absolute top-0 right-0 bg-red-600 text-white text-[8px] font-black px-1">BAN</div>}
                                {data?.autoPick === c.id && <div className="absolute top-0 right-0 bg-blue-600 text-white text-[8px] font-black px-1">PICK</div>}
                            </div>
                        ))}
                </div>
            </div>
        </div>
    );
};

export default HomeTab;
