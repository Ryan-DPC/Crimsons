import { useEffect, useRef, useState } from 'react';
import { PLUGIN_STORE_BASE_URL } from '../../lib/pluginStore';
import { useLCU } from '../../contexts/LCUContext';
import { useAuth } from '../../contexts/AuthContext';
import { getVisibleHubNav, type HubView } from '../../lib/hubViews';

type MenuId = 'file' | 'view' | 'help' | null;

interface TitlebarMenusProps {
  appVersion: string;
  onOpenSettings: () => void;
  onFocusHub: () => void;
  onQuit: () => void;
}

function openExternal(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export default function TitlebarMenus({
  appVersion,
  onOpenSettings,
  onFocusHub,
  onQuit,
}: TitlebarMenusProps) {
  const [openMenu, setOpenMenu] = useState<MenuId>(null);
  const [showAbout, setShowAbout] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { setTab, appData } = useLCU();
  const { isPremium } = useAuth();
  const hubPages = getVisibleHubNav(appData?.plugins, isPremium);

  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenu]);

  const toggle = (id: Exclude<MenuId, null>) => {
    setOpenMenu((prev) => (prev === id ? null : id));
  };

  const run = (action: () => void) => {
    setOpenMenu(null);
    action();
  };

  const menus: {
    id: Exclude<MenuId, null>;
    label: string;
    items: { label: string; shortcut?: string; action: () => void; danger?: boolean }[];
  }[] = [
    {
      id: 'file',
      label: 'File',
      items: [
        { label: 'Settings', action: () => run(onOpenSettings) },
        { label: 'Open Store', action: () => run(() => openExternal(PLUGIN_STORE_BASE_URL)) },
        { label: 'Quit', action: () => run(onQuit), danger: true },
      ],
    },
    {
      id: 'view',
      label: 'View',
      items: [
        ...hubPages.map((item) => ({
          label: item.id === 'home' ? 'Hub' : item.label,
          action: () =>
            run(() => {
              if (item.id === 'home') onFocusHub();
              else setTab(item.id as HubView);
            }),
        })),
        { label: 'Refresh', action: () => run(() => window.location.reload()) },
      ],
    },
    {
      id: 'help',
      label: 'Help',
      items: [
        {
          label: 'About Crimsons',
          action: () =>
            run(() => {
              setShowAbout(true);
            }),
        },
        { label: 'Plugin Store', action: () => run(() => openExternal(PLUGIN_STORE_BASE_URL)) },
      ],
    },
  ];

  return (
    <>
      <div ref={rootRef} className="flex items-center gap-0.5" data-tauri-drag-region="false">
        {menus.map((menu) => (
          <div key={menu.id} className="relative">
            <button
              type="button"
              onClick={() => toggle(menu.id)}
              onMouseEnter={() => {
                if (openMenu && openMenu !== menu.id) setOpenMenu(menu.id);
              }}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold tracking-wide transition-colors ${
                openMenu === menu.id
                  ? 'bg-white/10 text-white'
                  : 'text-white/55 hover:text-white hover:bg-white/5'
              }`}
            >
              {menu.label}
            </button>
            {openMenu === menu.id && (
              <div className="absolute left-0 top-full mt-1 min-w-[168px] py-1 rounded-lg border border-white/10 bg-[#121216]/98 shadow-[0_12px_40px_rgba(0,0,0,0.55)] backdrop-blur-md z-[80]">
                {menu.items.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={item.action}
                    className={`w-full px-3 py-1.5 text-left text-[11px] font-medium tracking-wide transition-colors ${
                      item.danger
                        ? 'text-red-400/90 hover:bg-red-500/15 hover:text-red-300'
                        : 'text-white/70 hover:bg-white/8 hover:text-white'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {showAbout && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#111115] border border-white/10 p-6 rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.8)] max-w-xs w-full mx-4">
            <h2 className="text-lg font-black text-white uppercase tracking-widest mb-1">Crimsons</h2>
            <p className="text-white/45 text-xs font-bold mb-5">Version {appVersion}</p>
            <p className="text-white/35 text-[11px] leading-relaxed mb-6">
              Desktop hub for StreamDock plugins, League Client tools, and media controls.
            </p>
            <button
              type="button"
              onClick={() => setShowAbout(false)}
              className="w-full py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white/80 hover:text-white text-[10px] font-black uppercase tracking-widest transition-all"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
