import { Clapperboard, RefreshCw } from 'lucide-react';
import { useLCU } from '../../contexts/LCUContext';
import { pluginStoreUrl } from '../../lib/pluginStore';

export default function ObsPage() {
  const { obsState, obsCommand } = useLCU();

  const status = obsState?.streaming
    ? 'Streaming'
    : obsState?.recording
      ? 'Recording'
      : obsState?.connected
        ? 'Connecté'
        : 'Stub · connecté';

  return (
    <div className="w-full max-w-2xl mx-auto pt-8 pb-12 px-2 space-y-6 animate-in fade-in duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-white uppercase tracking-wider flex items-center gap-2">
            <Clapperboard className="w-5 h-5 text-purple-400" />
            OBS Studio
          </h1>
          <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest mt-1">
            Scène · stream · record
          </p>
        </div>
        <button
          type="button"
          onClick={() => obsCommand('refresh')}
          className="flex items-center gap-2 px-3 py-2 bg-purple-600/10 hover:bg-purple-600/20 text-purple-400 rounded-xl border border-purple-500/20 text-[9px] font-black uppercase tracking-widest"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      <div className="bg-[#0a0a0c] border border-white/5 rounded-2xl p-6 space-y-3">
        <span className="text-[9px] font-black text-white/40 uppercase tracking-widest">Scène</span>
        <p className="text-white font-black text-xl">
          {obsState?.current_scene || (obsState?.mock || !obsState ? 'Stub · scène' : 'Aucune scène')}
        </p>
        <p className="text-white/45 text-sm uppercase font-bold tracking-widest">
          {status}
          {obsState?.mock || !obsState ? ' · mock' : ''}
        </p>
      </div>

      <a href={pluginStoreUrl('obs-studio')} target="_blank" rel="noreferrer" className="text-[9px] text-purple-400/60 hover:text-purple-300 font-black uppercase tracking-widest">
        Store → OBS Studio
      </a>
    </div>
  );
}
