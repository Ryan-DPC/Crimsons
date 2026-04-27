import logoUrl from '../../assets/logo.png'

interface HeaderProps {
    tab: string;
    setTab: (tab: string) => void;
    simMode: boolean;
    setSimMode: (val: boolean) => void;
}

const Header = ({ tab, setTab, simMode, setSimMode }: HeaderProps) => {
    return (
        <header className="flex justify-between items-center px-8 h-12 shrink-0 relative z-20 border-b border-white/5 bg-[#0a0a0c]/80 backdrop-blur-md">
            <div className="flex items-center gap-6">
                <div className="flex items-center gap-3">
                    <div className="w-7 h-7 flex items-center justify-center">
                        <img src={logoUrl} alt="Logo" className="w-full h-full object-contain filter drop-shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
                    </div>
                    <h1 className="text-lg font-bold tracking-[0.2em] text-neutral-100 uppercase leading-none">CRIMSON</h1>
                </div>

                <div className="h-4 w-[1px] bg-white/10 mx-2" />

                <button 
                    onClick={() => setSimMode(!simMode)}
                    className={`flex items-center gap-2 px-3 py-1 rounded-full border transition-all duration-300 ${
                        simMode 
                            ? 'bg-blue-500/10 border-blue-500/40 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.1)]' 
                            : 'bg-white/5 border-white/10 text-neutral-500 hover:border-white/20 hover:text-neutral-400'
                    }`}
                >
                    <div className={`w-1.5 h-1.5 rounded-full ${simMode ? 'bg-blue-400 animate-pulse' : 'bg-neutral-600'}`} />
                    <span className="text-[9px] font-black uppercase tracking-widest leading-none">Mode Simulation</span>
                </button>
            </div>

            <nav className="flex h-full items-center">
                {['home', 'lobby', 'hist', 'debug'].map(id => (
                    <button 
                        key={id} 
                        onClick={() => setTab(id)} 
                        className={`px-6 h-full text-[10px] font-bold uppercase tracking-widest transition-all duration-300 border-b-2 relative flex items-center ${
                            tab === id 
                                ? (id === 'debug' ? 'border-amber-400 text-amber-400' : 'border-red-500 text-red-500')
                                : 'border-transparent text-neutral-500 hover:text-neutral-300'
                        }`}
                    >
                        {id === 'home' ? 'Accueil' : id === 'lobby' ? 'Champ Select' : id === 'hist' ? 'Historique' : 'Outils'}
                        {tab === id && <div className={`absolute inset-0 opacity-10 pointer-events-none ${id === 'debug' ? 'bg-amber-400' : 'bg-red-500'}`} />}
                    </button>
                ))}
            </nav>
        </header>
    );
};

export default Header;
