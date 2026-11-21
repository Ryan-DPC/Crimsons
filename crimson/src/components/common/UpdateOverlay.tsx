import { RefreshCw, CheckCircle2 } from 'lucide-react';
import logoMark from '../../assets/logos/logo_mark_only.png';

interface UpdateOverlayProps {
  version: string;
  progress: number;
}

export default function UpdateOverlay({ version, progress }: UpdateOverlayProps) {
  const isFinalizing = progress >= 98;

  return (
    <div className="fixed inset-0 z-[10000] bg-[#050508]/95 backdrop-blur-2xl flex flex-col items-center justify-center p-8 select-none animate-in fade-in duration-300">
      {/* Background ambient red glow */}
      <div className="absolute w-[450px] h-[450px] bg-red-600/10 rounded-full blur-[140px] pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center max-w-md w-full text-center">
        {/* Animated Brand Mark */}
        <div className="relative mb-8">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-red-600/20 to-black/60 border border-red-500/30 flex items-center justify-center shadow-[0_0_50px_rgba(220,38,38,0.3)]">
            <img src={logoMark} alt="CRIMSONS" className="w-12 h-12 object-contain" />
          </div>
          <div className="absolute -bottom-1 -right-1 p-1.5 rounded-full bg-red-600 border-2 border-[#050508] text-white">
            {isFinalizing ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            )}
          </div>
        </div>

        {/* Title & Version */}
        <h2 className="text-xl font-black text-white uppercase tracking-widest mb-1.5 font-mono">
          {isFinalizing ? 'Finalisation de la mise à jour' : 'Mise à jour de Crimsons'}
        </h2>
        <p className="text-xs font-bold text-red-500/80 uppercase tracking-widest mb-8">
          Version {version}
        </p>

        {/* Progress Bar Container */}
        <div className="w-full bg-white/5 border border-white/10 rounded-2xl p-1.5 mb-4 shadow-inner">
          <div className="relative w-full h-3 bg-black/60 rounded-xl overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-red-600 to-red-500 transition-all duration-300 rounded-xl shadow-[0_0_15px_rgba(239,68,68,0.5)]"
              style={{ width: `${Math.max(progress, 4)}%` }}
            />
          </div>
        </div>

        {/* Status text & percentage */}
        <div className="flex items-center justify-between w-full px-1 text-[11px] font-mono text-white/50 uppercase tracking-wider mb-8">
          <span>
            {isFinalizing
              ? 'Relance automatique...'
              : 'Téléchargement des composants...'}
          </span>
          <span className="font-black text-white">{progress}%</span>
        </div>

        {/* Explanatory Reassurance Note */}
        <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 text-[11px] text-white/40 leading-relaxed uppercase tracking-wider font-semibold">
          {isFinalizing ? (
            <p className="text-white/80 animate-pulse">
              L'application va redémarrer automatiquement dans quelques secondes avec la nouvelle version.
            </p>
          ) : (
            <p>
              Téléchargement en cours. Crimsons appliquera la mise à jour et se relancera automatiquement sans interruption de vos configurations.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
