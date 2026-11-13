import { Crosshair, Map as MapIcon, RefreshCw, Swords } from 'lucide-react';
import { useLCU } from '../../contexts/LCUContext';
import { pluginStoreUrl } from '../../lib/pluginStore';

/**
 * Valorant dedicated page (MVP).
 * Shows: your draft (agent), map, and W-L / winrate when the sidecar provides match data.
 * Career WR from Riot official API is not wired yet — see note below.
 */
export default function ValorantPage() {
  const { valorantState, valorantCommand } = useLCU();

  const matches = valorantState?.matches ?? [];
  const idx = valorantState?.match_index ?? 0;
  const current = matches[idx];
  const wins = matches.filter((m) => m.won).length;
  const losses = matches.length - wins;
  const sampleWr = matches.length > 0 ? Math.round((wins / matches.length) * 100) : null;

  const draftAgent =
    (valorantState as { draft?: { agent?: string } } | null)?.draft?.agent ||
    current?.agent ||
    null;
  const mapName =
    (valorantState as { map?: string } | null)?.map ||
    (current as { map?: string } | undefined)?.map ||
    null;

  const career = (valorantState as {
    career?: { wins: number; losses: number; winrate?: number };
  } | null)?.career;
  const careerWr =
    career && (career.wins + career.losses) > 0
      ? career.winrate ?? Math.round((career.wins / (career.wins + career.losses)) * 100)
      : null;

  return (
    <div className="w-full max-w-4xl mx-auto pt-6 pb-12 px-2 space-y-8 animate-in fade-in duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Crosshair className="w-5 h-5 text-red-500" />
            <h1 className="text-xl font-black text-white uppercase tracking-wider">Valorant</h1>
          </div>
          <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest">
            Draft · Map · W/L
          </p>
        </div>
        <button
          type="button"
          onClick={() => valorantCommand('refresh')}
          className="flex items-center gap-2 px-3 py-2 bg-red-600/10 hover:bg-red-600/20 text-red-400 rounded-xl border border-red-500/20 text-[9px] font-black uppercase tracking-widest transition-all"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Rank strip */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-[#0a0a0c] border border-white/5 rounded-2xl p-5">
          <span className="text-[9px] font-black text-white/40 uppercase tracking-widest">Rang</span>
          <p className="text-white font-black text-lg mt-2">
            {valorantState?.rank?.tier || '—'}
          </p>
          <p className="text-white/50 text-xs font-bold mt-1">
            {typeof valorantState?.rank?.rr === 'number' ? `${valorantState.rank.rr} RR` : 'RR —'}
          </p>
        </div>
        <div className="bg-[#0a0a0c] border border-white/5 rounded-2xl p-5">
          <span className="text-[9px] font-black text-white/40 uppercase tracking-widest">W / L (session)</span>
          <p className="text-white font-black text-lg mt-2">
            {matches.length ? (
              <>
                {wins}/<span className="text-red-500">{losses}</span>
              </>
            ) : (
              '—'
            )}
          </p>
          <p className="text-white/50 text-xs font-bold mt-1">
            {sampleWr != null ? `${sampleWr}% WR (échantillon)` : 'Pas de matchs'}
          </p>
        </div>
        <div className="bg-[#0a0a0c] border border-white/5 rounded-2xl p-5">
          <span className="text-[9px] font-black text-white/40 uppercase tracking-widest">WR carrière</span>
          <p className="text-white font-black text-lg mt-2">
            {careerWr != null ? `${careerWr}%` : 'N/A'}
          </p>
          <p className="text-white/50 text-xs font-bold mt-1">
            {career
              ? `${career.wins}W / ${career.losses}L`
              : 'API carrière non branchée'}
          </p>
        </div>
      </div>

      {/* Draft + Map */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[#0a0a0c] border border-white/5 rounded-2xl p-6 flex flex-col gap-4 min-h-[180px]">
          <div className="flex items-center gap-2">
            <Swords className="w-4 h-4 text-red-400" />
            <span className="text-[10px] font-black text-white/50 uppercase tracking-widest">
              Ta draft
            </span>
          </div>
          <div className="flex-1 flex items-center gap-4">
            <div className="w-16 h-16 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
              <Crosshair className="w-7 h-7 text-red-500" />
            </div>
            <div>
              <p className="text-white font-black text-2xl tracking-wide">
                {draftAgent || 'En attente'}
              </p>
              <p className="text-white/35 text-[10px] uppercase font-bold tracking-widest mt-1">
                Agent sélectionné
              </p>
            </div>
          </div>
        </div>

        <div className="bg-[#0a0a0c] border border-white/5 rounded-2xl p-6 flex flex-col gap-4 min-h-[180px]">
          <div className="flex items-center gap-2">
            <MapIcon className="w-4 h-4 text-red-400" />
            <span className="text-[10px] font-black text-white/50 uppercase tracking-widest">Map</span>
          </div>
          <div className="flex-1 flex items-center">
            <div>
              <p className="text-white font-black text-2xl tracking-wide">
                {mapName || '—'}
              </p>
              <p className="text-white/35 text-[10px] uppercase font-bold tracking-widest mt-1">
                {valorantState?.mock || !valorantState ? 'Stub / mock sidecar' : 'Partie en cours'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Recent matches */}
      <div className="bg-[#0a0a0c] border border-white/5 rounded-2xl p-6">
        <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">
          Derniers matchs
        </span>
        {matches.length === 0 ? (
          <p className="text-white/30 text-sm mt-4 font-medium">
            Aucun match — active le plugin et le client Valorant (ou mock sidecar).
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {matches.slice(0, 8).map((m, i) => (
              <li
                key={m.match_id || i}
                className={`flex items-center justify-between py-2 border-b border-white/5 last:border-0 ${
                  i === idx ? 'opacity-100' : 'opacity-80'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`text-[10px] font-black uppercase tracking-widest w-6 ${
                      m.won ? 'text-green-500' : 'text-red-500'
                    }`}
                  >
                    {m.won ? 'W' : 'L'}
                  </span>
                  <span className="text-white font-bold text-sm">{m.agent}</span>
                  {(m as { map?: string }).map && (
                    <span className="text-white/30 text-xs">{(m as { map?: string }).map}</span>
                  )}
                </div>
                <span className="text-white/60 text-xs font-bold tabular-nums">
                  {m.kills}/{m.deaths}/{m.assists}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[10px] text-white/25 leading-relaxed max-w-2xl">
        Note WR API : le winrate carrière officiel Riot (Account / Match History) n’est pas encore
        branché côté sidecar. L’UI affiche le W/L sur l’échantillon local (
        <code className="text-white/40">valorantState.matches</code>
        ) et un champ optionnel <code className="text-white/40">career</code> quand l’API sera
        disponible.{' '}
        <a
          href={pluginStoreUrl('valorant')}
          target="_blank"
          rel="noreferrer"
          className="text-red-400/70 hover:text-red-300 underline-offset-2 hover:underline"
        >
          Store Valorant
        </a>
      </p>
    </div>
  );
}
