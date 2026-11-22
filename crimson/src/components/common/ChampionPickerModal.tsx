import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, X, Check, Ban, Crosshair } from 'lucide-react';
import { getChampIcon } from '../../utils/lolDisplay';

interface ChampionPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'pick' | 'ban';
  currentChampionId: number | null;
  champs: any[];
  v: string;
  onSelect: (champId: number | null) => void;
}

export default function ChampionPickerModal({
  isOpen,
  onClose,
  mode,
  currentChampionId,
  champs,
  v,
  onSelect,
}: ChampionPickerModalProps) {
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [isOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }
  }, [isOpen, onClose]);

  const filteredChamps = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return champs;
    const startsWith: any[] = [];
    const contains: any[] = [];
    for (const c of champs) {
      const name = (c.name || '').toLowerCase();
      if (name.startsWith(q)) {
        startsWith.push(c);
      } else if (name.includes(q)) {
        contains.push(c);
      }
    }
    return [...startsWith, ...contains];
  }, [champs, search]);

  if (!isOpen) return null;

  const isPick = mode === 'pick';

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200 select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-[#0e0e12] border border-white/10 rounded-3xl shadow-[0_20px_60px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl border ${isPick ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
              {isPick ? <Crosshair className="w-5 h-5" /> : <Ban className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-base font-black text-white uppercase tracking-wider">
                {isPick ? 'Sélection Auto-Pick' : 'Sélection Auto-Ban'}
              </h3>
              <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest mt-0.5">
                {isPick ? 'Champion prioritaire à sélectionner automatiquement' : 'Champion prioritaire à bannir automatiquement'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-white/40 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
            title="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search bar & None action */}
        <div className="p-4 border-b border-white/5 flex items-center gap-3 bg-white/[0.01]">
          <div className="flex-1 relative flex items-center">
            <Search className="w-4 h-4 text-white/30 absolute left-3 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Écrivez le nom ou les premières lettres (ex: Ahri, Yasuo, Zed)..."
              className={`w-full bg-black/50 border border-white/10 rounded-xl pl-9 pr-8 py-2.5 text-xs text-white placeholder-white/30 outline-none transition-colors ${
                isPick ? 'focus:border-blue-500/60' : 'focus:border-red-500/60'
              }`}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 p-1 text-white/30 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              onSelect(null);
              onClose();
            }}
            className={`px-3.5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border shrink-0 cursor-pointer ${
              !currentChampionId
                ? 'bg-white/10 border-white/20 text-white'
                : 'bg-white/5 border-white/10 text-white/40 hover:text-white hover:bg-white/10'
            }`}
          >
            Aucun (Désactiver)
          </button>
        </div>

        {/* Champions Grid */}
        <div className="p-5 overflow-y-auto flex-1 scrollbar-thin scrollbar-thumb-white/10">
          {filteredChamps.length === 0 ? (
            <div className="py-16 text-center text-white/30 text-xs font-bold uppercase tracking-wider">
              Aucun champion trouvé pour « {search} »
            </div>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3">
              {filteredChamps.map((c) => {
                const isSelected = currentChampionId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      onSelect(c.id);
                      onClose();
                    }}
                    className={`flex flex-col items-center gap-1.5 p-2 rounded-2xl border transition-all cursor-pointer group ${
                      isSelected
                        ? isPick
                          ? 'bg-blue-500/20 border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.4)] scale-105'
                          : 'bg-red-500/20 border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.4)] scale-105'
                        : 'bg-black/30 border-white/5 hover:border-white/20 hover:bg-white/[0.04] hover:scale-105'
                    }`}
                  >
                    <div className="relative w-12 h-12 rounded-xl overflow-hidden border border-white/10">
                      <img
                        src={getChampIcon(c.id, champs, v)}
                        alt={c.name}
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-200"
                        loading="lazy"
                      />
                      {isSelected && (
                        <div className={`absolute inset-0 flex items-center justify-center ${isPick ? 'bg-blue-600/60' : 'bg-red-600/60'}`}>
                          <Check className="w-5 h-5 text-white stroke-[3]" />
                        </div>
                      )}
                    </div>
                    <span className={`text-[10px] font-bold text-center truncate w-full ${
                      isSelected ? 'text-white' : 'text-white/70 group-hover:text-white'
                    }`}>
                      {c.name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="px-6 py-3 border-t border-white/5 bg-black/40 flex items-center justify-between text-[10px] text-white/30 font-mono">
          <span>{filteredChamps.length} champion{filteredChamps.length > 1 ? 's' : ''}</span>
          <span>Échap pour quitter</span>
        </div>
      </div>
    </div>
  );
}
