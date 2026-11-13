import { useState } from 'react';
import { useLCU } from '../../contexts/LCUContext';
import { getChampIcon } from '../../utils/lolDisplay';
import LobbyTab from '../lobby/LobbyTab';
import HistoryTab from '../history/HistoryTab';

/**
 * Dedicated League of Legends page: draft/runes (lobby), history, and season stats.
 */
export default function LolPage() {
  const {
    sum, v, hist, champs, seasonStats, appData, updateSetting,
  } = useLCU();
  const [subTab, setSubTab] = useState<'draft' | 'stats' | 'history'>('draft');

  const validMatches = hist.filter((m) => m.gameDuration > 300);
  const recentWins = validMatches.filter((m) => m.stats?.win).length;
  const totalMatches = seasonStats ? seasonStats.wins + seasonStats.losses : validMatches.length;
  const wins = seasonStats ? seasonStats.wins : recentWins;
  const losses = seasonStats ? seasonStats.losses : validMatches.length - recentWins;

  return (
    <div className="h-full flex flex-col min-h-0 animate-in fade-in duration-500">
      <div className="flex justify-center mt-4 shrink-0 z-10 px-4">
        <div className="flex items-center bg-white/5 p-1 rounded-xl border border-white/5">
          {([
            ['draft', 'Draft / Runes'],
            ['stats', 'Stats'],
            ['history', 'Historique'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSubTab(id)}
              className={`px-6 py-2.5 rounded-lg text-xs font-black tracking-widest uppercase transition-all duration-300 ${
                subTab === id
                  ? 'bg-white/10 text-white shadow-lg shadow-black/50'
                  : 'text-white/40 hover:text-white/70'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col mt-2">
        {subTab === 'draft' && (
          <div className="flex-1 min-h-0 flex flex-col">
            <LobbyTab />
            <div className="shrink-0 max-w-[1600px] mx-auto w-full px-8 pb-6 space-y-3">
              <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">
                Automation
              </span>
              <div className="flex flex-wrap gap-4 items-center">
                <label className="flex items-center gap-3 text-[10px] font-black text-white/70 uppercase tracking-widest cursor-pointer">
                  <input
                    type="checkbox"
                    checked={appData?.autoAccept ?? true}
                    onChange={(e) => updateSetting('autoAccept', e.target.checked)}
                    className="rounded border-white/20"
                  />
                  Auto-Accept
                </label>
                <div className="flex items-center gap-2 text-xs text-white/50">
                  <span className="text-blue-400 font-black uppercase text-[9px] tracking-widest">Pick</span>
                  {appData?.autoPick ? (
                    <img src={getChampIcon(appData.autoPick, champs, v)} className="w-6 h-6 rounded-full" alt="" />
                  ) : null}
                  <span className="text-white font-bold">
                    {appData?.autoPick ? champs.find((c) => c.id === appData.autoPick)?.name : 'None'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-white/50">
                  <span className="text-red-400 font-black uppercase text-[9px] tracking-widest">Ban</span>
                  {appData?.autoBan ? (
                    <img src={getChampIcon(appData.autoBan, champs, v)} className="w-6 h-6 rounded-full" alt="" />
                  ) : null}
                  <span className="text-white font-bold">
                    {appData?.autoBan ? champs.find((c) => c.id === appData.autoBan)?.name : 'None'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {subTab === 'stats' && (
          <div className="flex-1 overflow-y-auto scrollbar-hide max-w-3xl mx-auto p-8 w-full">
            <div className="bg-[#0a0a0c] border border-white/5 rounded-2xl p-6 space-y-6">
              <div className="flex items-center gap-4">
                {sum ? (
                  <img
                    src={`https://ddragon.leagueoflegends.com/cdn/${v}/img/profileicon/${sum.profileIconId}.png`}
                    className="w-14 h-14 rounded-xl border border-white/10"
                    alt=""
                  />
                ) : (
                  <div className="w-14 h-14 bg-[#111115] border border-white/5 rounded-xl" />
                )}
                <div>
                  <span className="text-white/40 text-[9px] uppercase font-black tracking-widest">Summoner</span>
                  <p className="text-white font-bold text-lg">
                    {sum ? sum.displayName || sum.gameName : 'Offline'}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <span className="text-white/50 text-[10px] uppercase font-black tracking-widest">Matches</span>
                  <p className="text-white font-black text-xl mt-1">{totalMatches}</p>
                </div>
                <div>
                  <span className="text-white/50 text-[10px] uppercase font-black tracking-widest">W/L</span>
                  <p className="text-white font-black text-xl mt-1">
                    {wins}/<span className="text-red-500">{losses}</span>
                  </p>
                </div>
                <div>
                  <span className="text-white/50 text-[10px] uppercase font-black tracking-widest">WR</span>
                  <p className="text-white font-black text-xl mt-1">
                    {totalMatches > 0 ? Math.round((wins / totalMatches) * 100) : 0}%
                  </p>
                </div>
              </div>
              <div className="space-y-3 border-t border-white/5 pt-4">
                {hist.slice(0, 5).map((m, i) => {
                  const isWin = m.stats?.win;
                  return (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <img src={getChampIcon(m.championId, champs, v)} className="w-8 h-8 rounded-full border border-white/10" alt="" />
                        <span className="text-white font-bold text-sm">
                          {champs.find((c) => c.id === m.championId)?.name || 'Champ'}
                        </span>
                        <span className={`text-[10px] font-black uppercase ${isWin ? 'text-green-500' : 'text-red-500'}`}>
                          {isWin ? 'Victory' : 'Defeat'}
                        </span>
                      </div>
                      <span className="text-white/60 text-xs font-bold">
                        {m.stats?.kills}/{m.stats?.deaths}/{m.stats?.assists}
                      </span>
                    </div>
                  );
                })}
                {hist.length === 0 && (
                  <p className="text-white/30 text-sm">Aucun historique — lance League pour synchroniser.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {subTab === 'history' && (
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide max-w-[1600px] mx-auto p-8 w-full">
            <HistoryTab />
          </div>
        )}
      </div>
    </div>
  );
}
