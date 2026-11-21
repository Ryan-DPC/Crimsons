import { useEffect, useRef } from 'react';
import { 
  Bell, 
  BellOff, 
  X, 
  CheckCheck, 
  Download, 
  CheckCircle2, 
  AlertCircle, 
  Info,
  Trash2
} from 'lucide-react';

export interface NotificationItem {
  id: string;
  type: 'update' | 'warning' | 'success' | 'info';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface NotificationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: NotificationItem[];
  onDismiss: (id: string) => void;
  onMarkAllAsRead: () => void;
  onClearAll: () => void;
}

export default function NotificationPanel({
  isOpen,
  onClose,
  notifications,
  onDismiss,
  onMarkAllAsRead,
  onClearAll,
}: NotificationPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current && panelRef.current.contains(e.target as Node)) {
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-notification-trigger]')) {
        return;
      }
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const unreadCount = notifications.filter(n => !n.read).length;

  const getIcon = (type: NotificationItem['type']) => {
    switch (type) {
      case 'update':
        return <Download className="w-4 h-4 text-red-400" />;
      case 'success':
        return <CheckCircle2 className="w-4 h-4 text-green-400" />;
      case 'warning':
        return <AlertCircle className="w-4 h-4 text-amber-400" />;
      case 'info':
      default:
        return <Info className="w-4 h-4 text-blue-400" />;
    }
  };

  const getBadgeBg = (type: NotificationItem['type']) => {
    switch (type) {
      case 'update':
        return 'bg-red-500/10 border-red-500/20';
      case 'success':
        return 'bg-green-500/10 border-green-500/20';
      case 'warning':
        return 'bg-amber-500/10 border-amber-500/20';
      case 'info':
      default:
        return 'bg-blue-500/10 border-blue-500/20';
    }
  };

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-2xl border border-white/10 bg-[#111115]/95 shadow-[0_16px_48px_rgba(0,0,0,0.7)] backdrop-blur-xl z-[90] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/[0.02]">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-red-600/15 border border-red-500/30 text-red-500">
            <Bell className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-white uppercase tracking-wider">Notifications</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 text-[9px] font-black uppercase bg-red-600 text-white rounded-full">
                  {unreadCount}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={onMarkAllAsRead}
              className="px-2 py-1 text-[10px] font-bold text-white/50 hover:text-white hover:bg-white/5 rounded-lg transition-colors flex items-center gap-1"
              title="Tout marquer comme lu"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Lu</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-colors"
            title="Fermer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Body / List */}
      <div className="max-h-80 overflow-y-auto divide-y divide-white/5 scrollbar-thin scrollbar-thumb-white/10">
        {notifications.length === 0 ? (
          <div className="py-12 px-6 text-center">
            <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/30">
              <BellOff className="w-5 h-5" />
            </div>
            <p className="text-xs font-bold text-white/70 uppercase tracking-wider">Aucune notification</p>
            <p className="text-[10px] text-white/30 mt-1 uppercase font-medium">Tout est calme et à jour</p>
          </div>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              className={`p-3.5 flex items-start gap-3 transition-colors relative group ${
                n.read ? 'bg-transparent hover:bg-white/[0.02]' : 'bg-white/[0.03] hover:bg-white/[0.05]'
              }`}
            >
              {/* Type Icon Badge */}
              <div className={`p-2 rounded-xl border shrink-0 mt-0.5 ${getBadgeBg(n.type)}`}>
                {getIcon(n.type)}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pr-6">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <h4 className="text-xs font-bold text-white truncate">{n.title}</h4>
                    {!n.read && (
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                    )}
                  </div>
                  <span className="text-[9px] font-mono text-white/30 shrink-0">{n.timestamp}</span>
                </div>
                <p className="text-[11px] text-white/60 mt-1 leading-snug break-words">
                  {n.message}
                </p>

                {n.action && (
                  <button
                    type="button"
                    onClick={() => {
                      n.action?.onClick();
                      onClose();
                    }}
                    className="mt-2.5 px-3 py-1 bg-red-600/80 hover:bg-red-500 text-white text-[10px] font-black uppercase tracking-wider rounded-lg transition-all shadow-[0_0_10px_rgba(220,38,38,0.3)] active:scale-95"
                  >
                    {n.action.label}
                  </button>
                )}
              </div>

              {/* Dismiss X */}
              <button
                type="button"
                onClick={() => onDismiss(n.id)}
                className="absolute right-2.5 top-2.5 p-1 rounded-md text-white/20 hover:text-white/80 hover:bg-white/10 transition-colors opacity-0 group-hover:opacity-100"
                title="Supprimer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      {notifications.length > 0 && (
        <div className="px-4 py-2.5 bg-black/40 border-t border-white/5 flex items-center justify-between text-[10px]">
          <span className="text-white/30 font-medium">
            {notifications.length} notification{notifications.length > 1 ? 's' : ''}
          </span>
          <button
            type="button"
            onClick={onClearAll}
            className="text-white/40 hover:text-red-400 font-bold uppercase tracking-wider transition-colors flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" />
            <span>Tout effacer</span>
          </button>
        </div>
      )}
    </div>
  );
}
