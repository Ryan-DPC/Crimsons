import { ChevronLeft, ChevronRight, Volume2, VolumeX } from 'lucide-react';
import { useLCU } from '../../contexts/LCUContext';
import { pluginStoreUrl } from '../../lib/pluginStore';

export default function VolumePage() {
  const { volumeState, volumeCommand } = useLCU();
  const tracks = volumeState?.tracks || [];
  const idx = volumeState?.selected_track_index || 0;
  const track = tracks[idx];
  const masterPct = Math.round((volumeState?.master_level ?? 0) * 100);
  const trackPct = track ? Math.round((track.level || 0) * 100) : null;

  return (
    <div className="w-full max-w-2xl mx-auto pt-8 pb-12 px-2 space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-xl font-black text-white uppercase tracking-wider flex items-center gap-2">
          <Volume2 className="w-5 h-5 text-sky-400" />
          Volume
        </h1>
        <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest mt-1">
          Master · pistes · Wave Link
        </p>
      </div>

      <div className="bg-[#0a0a0c] border border-white/5 rounded-2xl p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="text-[9px] font-black text-white/40 uppercase tracking-widest">Master</span>
            <p className="text-white font-black text-2xl mt-1">
              {volumeState?.master_muted ? 'MUTE' : `${masterPct}%`}
              {!volumeState && <span className="text-white/30 text-sm font-bold ml-2">stub</span>}
            </p>
          </div>
          <button
            type="button"
            onClick={() => volumeCommand('master_mute')}
            className="p-3 bg-sky-600/10 hover:bg-sky-600/20 text-sky-400 rounded-xl border border-sky-500/20 transition-all"
            title="Master mute"
          >
            <VolumeX className="w-5 h-5" />
          </button>
        </div>

        <div className="border-t border-white/5 pt-6">
          <span className="text-[9px] font-black text-white/40 uppercase tracking-widest">Piste</span>
          <p className="text-white font-bold text-lg mt-2 truncate">
            {track?.name || (volumeState?.mock || !volumeState ? 'En attente WS · mock' : 'Aucune piste')}
          </p>
          <p className="text-white/45 text-sm mt-1">
            {track
              ? track.muted
                ? 'MUTE'
                : `${trackPct}%`
              : '—'}
            {volumeState?.wavelink?.available ? ' · Wave Link détecté' : ''}
          </p>
          <div className="grid grid-cols-4 gap-2 mt-4">
            <button type="button" onClick={() => volumeCommand('track_prev')} className="flex items-center justify-center py-3 bg-white/5 hover:bg-white/10 text-white/70 rounded-xl border border-white/5" title="Piste précédente">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => volumeCommand('track_down')} className="flex items-center justify-center py-3 bg-white/5 hover:bg-white/10 text-white/70 rounded-xl border border-white/5 text-[10px] font-black">−</button>
            <button type="button" onClick={() => volumeCommand('track_up')} className="flex items-center justify-center py-3 bg-white/5 hover:bg-white/10 text-white/70 rounded-xl border border-white/5 text-[10px] font-black">+</button>
            <button type="button" onClick={() => volumeCommand('track_next')} className="flex items-center justify-center py-3 bg-white/5 hover:bg-white/10 text-white/70 rounded-xl border border-white/5" title="Piste suivante">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <a href={pluginStoreUrl('volume')} target="_blank" rel="noreferrer" className="text-[9px] text-sky-400/60 hover:text-sky-300 font-black uppercase tracking-widest">
        Store → Volume
      </a>
    </div>
  );
}
