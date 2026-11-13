import { ChevronLeft, ChevronRight, Lightbulb } from 'lucide-react';
import { useLCU } from '../../contexts/LCUContext';
import { pluginStoreUrl } from '../../lib/pluginStore';

export default function HuePage() {
  const { hueState, hueCommand } = useLCU();
  const groups = hueState?.groups || [];
  const g = groups[hueState?.selected_group_index || 0];
  const scenes = (hueState?.scenes || []).filter(
    (s) => !s.group || s.group === g?.id,
  );
  const sc = scenes[hueState?.selected_scene_index || 0];

  return (
    <div className="w-full max-w-2xl mx-auto pt-8 pb-12 px-2 space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-xl font-black text-white uppercase tracking-wider flex items-center gap-2">
          <Lightbulb className={`w-5 h-5 ${g?.on ? 'text-amber-400' : 'text-white/30'}`} />
          Philips Hue
        </h1>
        <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest mt-1">
          Pièces · luminosité · scènes
        </p>
      </div>

      <div className="bg-[#0a0a0c] border border-white/5 rounded-2xl p-6 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <span className="text-[9px] font-black text-white/40 uppercase tracking-widest">Pièce</span>
            <p className="text-white font-black text-xl mt-1 truncate">
              {g?.name || (hueState?.mock || !hueState ? 'Stub · connecté' : 'Aucune pièce')}
            </p>
            <p className="text-white/45 text-sm mt-1">
              {g
                ? `${g.on ? 'ON' : 'OFF'} · ${Math.round(((g.bri || 0) / 254) * 100)}%`
                : hueState
                  ? '—'
                  : 'En attente WS · mock'}
              {hueState?.mock ? ' · mock' : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => hueCommand('toggle')}
            className="p-3 bg-amber-600/10 hover:bg-amber-600/20 text-amber-400 rounded-xl border border-amber-500/20"
            title="On/Off"
          >
            <Lightbulb className="w-5 h-5" />
          </button>
        </div>

        <div>
          <span className="text-[9px] font-black text-white/40 uppercase tracking-widest">Scène</span>
          <p className="text-white font-bold mt-1">{sc?.name || 'Aucune scène'}</p>
        </div>

        <div className="grid grid-cols-4 gap-2">
          <button type="button" onClick={() => hueCommand('room_prev')} className="flex items-center justify-center py-3 bg-white/5 hover:bg-white/10 text-white/70 rounded-xl border border-white/5" title="Pièce précédente">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => hueCommand('bri_down')} className="flex items-center justify-center py-3 bg-white/5 hover:bg-white/10 text-white/70 rounded-xl border border-white/5 text-[10px] font-black">−</button>
          <button type="button" onClick={() => hueCommand('bri_up')} className="flex items-center justify-center py-3 bg-white/5 hover:bg-white/10 text-white/70 rounded-xl border border-white/5 text-[10px] font-black">+</button>
          <button type="button" onClick={() => hueCommand('room_next')} className="flex items-center justify-center py-3 bg-white/5 hover:bg-white/10 text-white/70 rounded-xl border border-white/5" title="Pièce suivante">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <a href={pluginStoreUrl('philips-hue')} target="_blank" rel="noreferrer" className="text-[9px] text-amber-400/60 hover:text-amber-300 font-black uppercase tracking-widest">
        Store → Philips Hue
      </a>
    </div>
  );
}
