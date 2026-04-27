import logoUrl from '../../assets/logo.png'

interface HeaderProps {
    tab: string;
    setTab: (tab: string) => void;
}

const Header = ({ tab, setTab }: HeaderProps) => {
    return (
        <header className="flex justify-between items-center px-8 h-16 shrink-0 relative z-20 border-b border-white/5 bg-[#0a0a0c]/80 backdrop-blur-md">
            <div className="flex items-center gap-4">
                <div className="w-8 h-8 rounded overflow-hidden border border-red-500/30">
                    <img src={logoUrl} alt="Logo" className="w-full h-full object-cover" />
                </div>
                <h1 className="text-xl font-bold tracking-widest text-neutral-100 uppercase">CRIMSON</h1>
            </div>

            <nav className="flex h-full">
                {['home', 'lobby', 'hist'].map(id => (
                    <button 
                        key={id} 
                        onClick={() => setTab(id)} 
                        className={`px-6 h-full text-xs font-semibold uppercase tracking-widest transition-colors border-b-2 ${tab === id ? 'border-red-500 text-red-500' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
                    >
                        {id === 'home' ? 'Accueil' : id === 'lobby' ? 'Champ Select' : 'Historique'}
                    </button>
                ))}
            </nav>
        </header>
    );
};

export default Header;
