import { RefreshCw, Tv } from 'lucide-react';
import { useLCU } from '../../contexts/LCUContext';
import { pluginStoreUrl } from '../../lib/pluginStore';

export default function TwitchPage() {
  const { twitchState, twitchCommand } = useLCU();
  const live = !!(twitchState?.live);
  const stub = !!(twitchState?.mock || !twitchState);

  return (
    <div className="w-full max-w-2xl mx-auto pt-8 pb-12 px-2 space-y-6 animate-in fade-in duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-white uppercase tracking-wider flex items-center gap-2">
            <Tv className="w-5 h-5 text-red-500" />
            Twitch
          </h1>
          <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest mt-1">
            Statut live · viewers
          </p>
        </div>
        <button
          type="button"
          onClick={() => twitchCommand('refresh')}
          className="flex items-center gap-2 px-3 py-2 bg-red-600/10 hover:bg-red-600/20 text-red-400 rounded-xl border border-red-500/20 text-[9px] font-black uppercase tracking-widest"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      <div className="bg-[#0a0a0c] border border-white/5 rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          {(live || stub) && (
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
          )}
          <span className="text-white font-black text-lg">
            {typeof twitchState?.viewers === 'number' ? `${twitchState.viewers} viewers` : '—'}
            {live ? ' · LIVE' : stub ? ' · stub' : ' · offline'}
          </span>
        </div>
        <p className="text-white/50 text-sm font-bold uppercase tracking-widest">
          {twitchState?.username || 'Twitch'}
          {twitchState?.title ? ` · ${twitchState.title}` : !twitchState ? ' · en attente WS' : ''}
        </p>
      </div>

      <a href={pluginStoreUrl('twitch')} target="_blank" rel="noreferrer" className="text-[9px] text-red-400/60 hover:text-red-300 font-black uppercase tracking-widest">
        Store → Twitch
      </a>
    </div>
  );
}
