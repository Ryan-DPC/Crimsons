import { Music, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useLCU } from '../../contexts/LCUContext';
import { pluginStoreUrl } from '../../lib/pluginStore';

export default function AppleMusicPage() {
  const { appleMusicState, appleMusicCommand } = useLCU();

  return (
    <div className="w-full max-w-3xl mx-auto pt-8 pb-12 px-2 animate-in fade-in duration-500">
      <div className="bg-[#0a0a0c] border border-red-500/15 rounded-2xl overflow-hidden">
        <div className="p-8 flex flex-col md:flex-row gap-8 items-center">
          {appleMusicState?.album_art ? (
            <img
              src={appleMusicState.album_art}
              className="w-48 h-48 rounded-2xl object-cover shadow-2xl border border-white/10 shrink-0"
              alt="Cover"
            />
          ) : (
            <div className="w-48 h-48 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
              <Music className="w-16 h-16 text-red-500/60" />
            </div>
          )}
          <div className="flex flex-col flex-1 min-w-0 gap-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[10px] font-black text-red-500 uppercase tracking-widest">
                Apple Music · Cider
              </span>
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight truncate">
              {appleMusicState?.track_name || 'Aucune musique en cours'}
            </h1>
            <p className="text-white/50 text-sm truncate">
              {appleMusicState?.artist_name || 'Cider prêt'}
            </p>
            {appleMusicState?.album_name && (
              <p className="text-white/30 text-xs truncate">{appleMusicState.album_name}</p>
            )}
            <div className="flex items-center gap-3 pt-4">
              <button
                type="button"
                onClick={() => appleMusicCommand('previous')}
                className="p-3 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all"
              >
                <SkipBack className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => appleMusicCommand('play_pause')}
                className="p-4 rounded-2xl bg-red-600 hover:bg-red-500 text-white shadow-[0_0_20px_rgba(220,38,38,0.35)] transition-all"
              >
                {appleMusicState?.is_playing ? (
                  <Pause className="w-6 h-6 fill-current" />
                ) : (
                  <Play className="w-6 h-6 fill-current ml-0.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => appleMusicCommand('next')}
                className="p-3 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all"
              >
                <SkipForward className="w-5 h-5" />
              </button>
            </div>
            <span className="text-[9px] text-white/25 font-mono mt-2">127.0.0.1:10767</span>
          </div>
        </div>
      </div>
      <a
        href={pluginStoreUrl('apple-music')}
        target="_blank"
        rel="noreferrer"
        className="inline-block mt-4 text-[9px] text-red-400/60 hover:text-red-300 font-black uppercase tracking-widest"
      >
        Store → Apple Music
      </a>
    </div>
  );
}
