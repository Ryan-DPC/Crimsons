import { useLCU } from '../../contexts/LCUContext';
import { useAuth } from '../../contexts/AuthContext';
import { getVisibleHubNav, type HubView } from '../../lib/hubViews';

export default function HubNav() {
  const { tab, setTab, appData } = useLCU();
  const { isPremium } = useAuth();
  const items = getVisibleHubNav(appData?.plugins, isPremium);

  return (
    <nav
      aria-label="Pages actives"
      className="flex items-center gap-1 px-4 py-2 border-b border-white/5 bg-black/40 overflow-x-auto scrollbar-hide shrink-0"
    >
      {items.map((item) => {
        const active = tab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id as HubView)}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
              active
                ? 'bg-white/10 text-white border border-white/15'
                : 'text-white/40 hover:text-white/80 hover:bg-white/5 border border-transparent'
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
