import {
  Disc3,
  ExternalLink,
  Headphones,
  MessageSquare,
  Mic,
  MicOff,
  MonitorPlay,
  ShoppingBag,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useLCU } from '../../contexts/LCUContext';
import { PLUGIN_STORE_BASE_URL, pluginStoreUrl } from '../../lib/pluginStore';
import { getVisibleHubNav, type HubView } from '../../lib/hubViews';

/** Module row: Store deep-link + activation toggle. */
const ModuleStoreRow = ({
  label,
  slug,
  value,
  onChange,
  disabled,
}: {
  label: string;
  slug: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) => {
  const storeHref = pluginStoreUrl(slug);
  return (
    <div className={`flex items-center justify-between gap-3 group ${disabled ? 'opacity-40' : ''}`}>
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <a
          href={storeHref}
          target="_blank"
          rel="noreferrer"
          className="text-[10px] font-black text-white/70 uppercase tracking-widest truncate hover:text-white transition-colors"
          title={`Ouvrir ${label} sur le Store`}
        >
          {label}
        </a>
        <a
          href={storeHref}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 p-1 rounded-md text-white/25 hover:text-white/80 hover:bg-white/5 transition-colors"
          title="Page Store"
          aria-label={`Ouvrir la page Store ${label}`}
        >
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
      <button
        onClick={() => !disabled && onChange(!value)}
        disabled={disabled}
        aria-label={`${value ? 'Désactiver' : 'Activer'} ${label}`}
        className={`relative w-9 h-5 rounded-full transition-all duration-500 focus:outline-none shrink-0 ${
          disabled
            ? 'bg-white/5 cursor-not-allowed'
            : value
              ? 'bg-red-600 shadow-[0_0_10px_rgba(220,38,38,0.4)]'
              : 'bg-white/10'
        }`}
      >
        <div
          className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-md transition-all duration-500 ${
            value && !disabled ? 'left-4 scale-110' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
};

export default function HomeTab() {
  const {
    appData,
    togglePlugin,
    setTab,
    discordState,
    discordCommand,
    discordConnected,
  } = useLCU();
  const { isPremium } = useAuth();

  const isLolEnabled = appData?.plugins?.leagueOfLegends ?? false;
  const isSpotifyEnabled = isPremium && (appData?.plugins?.spotify ?? false);
  const isDiscordEnabled = isPremium && (appData?.plugins?.discord ?? false);
  const isAppleMusicEnabled =
    isPremium && (appData?.plugins?.apple_music ?? appData?.plugins?.appleMusic ?? false);
  const isHueEnabled = isPremium && (appData?.plugins?.hue ?? false);
  const isTwitchEnabled = isPremium && (appData?.plugins?.twitch ?? false);
  const isObsEnabled = isPremium && (appData?.plugins?.obs ?? false);
  const isVolumeEnabled = isPremium && (appData?.plugins?.volume ?? false);
  const isValorantEnabled = isPremium && (appData?.plugins?.valorant ?? false);

  const activePages = getVisibleHubNav(appData?.plugins, isPremium).filter((i) => i.id !== 'home');

  return (
    <div className="w-full max-w-3xl mx-auto pt-10 pb-12 px-2 space-y-8 animate-in fade-in duration-500">
      <div className="bg-[#0a0a0c] border border-white/5 rounded-2xl p-8 space-y-6">
        <div className="flex items-center border-b border-white/5 pb-6">
          <div>
            <h2 className="text-lg font-black text-white uppercase tracking-wider">HUB</h2>
            <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest mt-0.5">
              Store · pages actives · modules
            </p>
          </div>
        </div>

        <a
          href={PLUGIN_STORE_BASE_URL}
          target="_blank"
          rel="noreferrer"
          className="bg-[#111115] hover:bg-white/[0.04] border border-white/5 hover:border-white/15 px-5 py-4 rounded-xl flex items-center gap-4 transition-all group cursor-pointer w-full"
        >
          <div className="w-10 h-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white/50 group-hover:text-white shrink-0">
            <ShoppingBag className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-[11px] font-black text-white uppercase tracking-wider block">
              Store de Plugins
            </span>
            <span className="text-[9px] text-white/40 uppercase font-bold tracking-widest mt-0.5 block">
              Catalogue StreamDock
            </span>
          </div>
          <ExternalLink className="w-4 h-4 text-white/30 group-hover:text-white shrink-0" />
        </a>

        {/* Quick nav to enabled plugin pages */}
        {activePages.length > 0 ? (
          <div className="space-y-3">
            <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">
              Pages actives
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {activePages.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id as HubView)}
                    className="flex items-center gap-2.5 px-3 py-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/5 hover:border-white/15 text-left transition-all"
                  >
                    <Icon className="w-4 h-4 text-red-400/80 shrink-0" />
                    <span className="text-[10px] font-black text-white/80 uppercase tracking-widest truncate">
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-white/35 font-medium leading-relaxed">
            Aucune page plugin active — active un module ci-dessous pour l’ouvrir dans la navigation.
          </p>
        )}

        <div className="p-4 bg-white/[0.02] border border-white/5 rounded-xl flex items-center justify-between gap-3">
          <span className="text-[10px] text-white/40 uppercase font-black tracking-widest">
            Gérer plugins et identifiants
          </span>
          <button
            type="button"
            onClick={() => setTab('settings')}
            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-white text-[9px] font-black uppercase tracking-widest transition-all shrink-0"
          >
            Paramètres
          </button>
        </div>
      </div>

      {/* Module toggles — enable/disable only; content lives on dedicated pages */}
      <div className="bg-[#0a0a0c] border border-white/5 rounded-2xl p-6 space-y-4">
        <span className="text-[10px] font-black text-white/40 uppercase tracking-widest border-b border-white/5 pb-2 block">
          Modules
        </span>
        <div className="space-y-3">
          <ModuleStoreRow
            label="Apple Music"
            slug="apple-music"
            value={isAppleMusicEnabled}
            onChange={(v) => togglePlugin('apple_music', v)}
            disabled={!isPremium}
          />
          <ModuleStoreRow
            label="League of Legends"
            slug="league-of-legends"
            value={isLolEnabled}
            onChange={(v) => togglePlugin('leagueOfLegends', v)}
          />
          <ModuleStoreRow
            label="Spotify"
            slug="spotify"
            value={isSpotifyEnabled}
            onChange={(v) => togglePlugin('spotify', v)}
            disabled={!isPremium}
          />
          <ModuleStoreRow
            label="Discord"
            slug="discord"
            value={isDiscordEnabled}
            onChange={(v) => togglePlugin('discord', v)}
            disabled={!isPremium}
          />
          <ModuleStoreRow
            label="Philips Hue"
            slug="philips-hue"
            value={isHueEnabled}
            onChange={(v) => togglePlugin('hue', v)}
            disabled={!isPremium}
          />
          <ModuleStoreRow
            label="Twitch"
            slug="twitch"
            value={isTwitchEnabled}
            onChange={(v) => togglePlugin('twitch', v)}
            disabled={!isPremium}
          />
          <ModuleStoreRow
            label="OBS Studio"
            slug="obs-studio"
            value={isObsEnabled}
            onChange={(v) => togglePlugin('obs', v)}
            disabled={!isPremium}
          />
          <ModuleStoreRow
            label="Volume"
            slug="volume"
            value={isVolumeEnabled}
            onChange={(v) => togglePlugin('volume', v)}
            disabled={!isPremium}
          />
          <ModuleStoreRow
            label="Valorant"
            slug="valorant"
            value={isValorantEnabled}
            onChange={(v) => togglePlugin('valorant', v)}
            disabled={!isPremium}
          />
        </div>
      </div>

      {/* Discord stays as compact controls on Home (no dedicated hub view yet) */}
      {isDiscordEnabled && (
        <div className="bg-[#0a0a0c] border border-white/5 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-500/10 rounded-lg flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-indigo-500" />
            </div>
            <div className="min-w-0">
              <span className="text-white font-bold text-xs truncate block">
                {discordState?.username ? `@${discordState.username}` : 'Discord'}
              </span>
              <span className="text-white/50 text-[10px] uppercase font-bold tracking-widest">
                {discordState?.error
                  ? 'Erreur'
                  : !discordState?.connected
                    ? 'Introuvable'
                    : discordState?.in_voice
                      ? 'En vocal'
                      : 'Connecté'}
              </span>
            </div>
          </div>
          <div
            className={`grid grid-cols-3 gap-2 transition-all ${
              discordConnected || discordState?.connected
                ? 'opacity-100'
                : 'opacity-40 pointer-events-none'
            }`}
          >
            <button
              type="button"
              onClick={() => discordCommand('toggleMute')}
              className={`flex items-center justify-center gap-2 py-3 rounded-xl border transition-all ${
                discordState?.is_muted
                  ? 'bg-red-500/10 border-red-500/20 text-red-500'
                  : 'bg-white/5 border-white/5 text-white/70 hover:bg-white/10'
              }`}
            >
              {discordState?.is_muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              <span className="text-[9px] font-black uppercase tracking-wider">
                {discordState?.is_muted ? 'Muet' : 'Mic'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => discordCommand('toggleDeafen')}
              className={`flex items-center justify-center gap-2 py-3 rounded-xl border transition-all ${
                discordState?.is_deaf
                  ? 'bg-red-500/10 border-red-500/20 text-red-500'
                  : 'bg-white/5 border-white/5 text-white/70 hover:bg-white/10'
              }`}
            >
              <Headphones className="w-4 h-4" />
              <span className="text-[9px] font-black uppercase tracking-wider">
                {discordState?.is_deaf ? 'Sourd' : 'Casque'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => discordCommand('toggleCamera')}
              className={`flex items-center justify-center gap-2 py-3 rounded-xl border transition-all ${
                discordState?.is_camera_on
                  ? 'bg-green-500/10 border-green-500/20 text-green-500'
                  : 'bg-white/5 border-white/5 text-white/70 hover:bg-white/10'
              }`}
            >
              <MonitorPlay className="w-4 h-4" />
              <span className="text-[9px] font-black uppercase tracking-wider">
                {discordState?.is_camera_on ? 'Cam ON' : 'Cam OFF'}
              </span>
            </button>
          </div>
        </div>
      )}

      {isSpotifyEnabled && (
        <button
          type="button"
          onClick={() => setTab('spotify')}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-green-600/5 hover:bg-green-600/10 border border-green-500/15 text-left transition-all"
        >
          <Disc3 className="w-4 h-4 text-green-500" />
          <span className="text-[10px] font-black text-green-400/90 uppercase tracking-widest">
            Ouvrir Spotify →
          </span>
        </button>
      )}
    </div>
  );
}
