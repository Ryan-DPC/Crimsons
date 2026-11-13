import { Disc3, Laptop, Music, Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import { useLCU } from '../../contexts/LCUContext';
import { pluginStoreUrl } from '../../lib/pluginStore';

export default function SpotifyPage() {
  const { spotifyState, spotifyCommand } = useLCU();

  const openLyricsWindow = async () => {
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      new WebviewWindow('lyrics', {
        url: '/index.html?window=lyrics',
        title: 'Crimsons Lyrics',
        width: 1200,
        height: 800,
        fullscreen: false,
        transparent: false,
        decorations: false,
      });
    } catch (e) {
      console.error('Failed to open lyrics window', e);
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto pt-8 pb-12 px-2 animate-in fade-in duration-500">
      <div className="bg-[#0a0a0c] border border-white/5 rounded-2xl overflow-hidden">
        <div className="p-8 flex flex-col md:flex-row gap-8 items-center md:items-stretch">
          {spotifyState?.album_art ? (
            <img
              src={spotifyState.album_art}
              className="w-48 h-48 rounded-2xl object-cover shadow-2xl border border-white/10 shrink-0"
              alt=""
            />
          ) : (
            <div className="w-48 h-48 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center shrink-0">
              <Disc3 className="w-16 h-16 text-green-500/50" />
            </div>
          )}
          <div className="flex flex-col flex-1 min-w-0 justify-center gap-3">
            <span className="text-[10px] font-black text-green-500 uppercase tracking-widest">
              Spotify
            </span>
            <h1 className="text-2xl font-black text-white tracking-tight truncate">
              {spotifyState?.track_name || 'Aucune musique'}
            </h1>
            <p className="text-white/50 text-sm truncate">
              {spotifyState?.artist_name || 'En attente de lecture…'}
            </p>
            <div className="flex items-center gap-3 pt-4">
              <button
                type="button"
                onClick={() => spotifyCommand('previous')}
                className="p-3 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all"
                title="Précédent"
              >
                <SkipBack className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => spotifyCommand('play_pause')}
                className="p-4 rounded-2xl bg-green-600 hover:bg-green-500 text-white shadow-[0_0_20px_rgba(22,163,74,0.35)] transition-all"
                title="Lecture / Pause"
              >
                {spotifyState?.is_playing ? (
                  <Pause className="w-6 h-6 fill-current" />
                ) : (
                  <Play className="w-6 h-6 fill-current ml-0.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => spotifyCommand('next')}
                className="p-3 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all"
                title="Suivant"
              >
                <SkipForward className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        <div className="px-8 pb-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => spotifyCommand('transfer-to-crimson')}
            className="flex items-center justify-center gap-2 py-3.5 bg-green-600/10 hover:bg-green-600/20 text-green-500 rounded-xl border border-green-500/20 transition-all"
          >
            <Laptop className="w-4 h-4" />
            <span className="text-[10px] font-black tracking-widest uppercase">Écouter sur ce PC</span>
          </button>
          <button
            type="button"
            onClick={openLyricsWindow}
            className="flex items-center justify-center gap-2 py-3.5 bg-white/5 hover:bg-white/10 text-white rounded-xl border border-white/10 transition-all"
          >
            <Music className="w-4 h-4" />
            <span className="text-[10px] font-black tracking-widest uppercase">Lyrics Overlay</span>
          </button>
        </div>
      </div>
      <a
        href={pluginStoreUrl('spotify')}
        target="_blank"
        rel="noreferrer"
        className="inline-block mt-4 text-[9px] text-green-400/60 hover:text-green-300 font-black uppercase tracking-widest"
      >
        Store → Spotify
      </a>
    </div>
  );
}
