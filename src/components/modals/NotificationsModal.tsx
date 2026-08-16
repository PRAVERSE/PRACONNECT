import React from 'react';
import { useApp } from '../../context/AppContext';

export const NotificationsModal: React.FC = () => {
  const {
    notificationsOpen,
    setNotificationsOpen,
    notifications,
    markNotificationRead,
    clearAllNotifications,
    joinRoom
  } = useApp();

  if (!notificationsOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 select-none animate-fade-in">
      <div className="w-full max-w-md float-surface p-6 relative text-[var(--text-primary)] pop-in">
        <button
          onClick={() => setNotificationsOpen(false)}
          className="absolute top-4 right-4 text-[#5C5C64] hover:text-[#EDEDEF] transition-colors cursor-pointer"
        >
          ✕
        </button>

        <div className="flex items-center justify-between mb-4 border-b border-white/[0.07] pb-3">
          <h2 className="font-['Sora',sans-serif] text-base font-bold text-[#EDEDEF]">Notifications</h2>

          {notifications.length > 0 && (
            <button
              onClick={clearAllNotifications}
              className="text-xs text-[#9A9AA2] hover:text-[#EDEDEF] transition-colors font-semibold cursor-pointer bg-transparent border-none p-0"
            >
              Clear All
            </button>
          )}
        </div>

        {notifications.length === 0 ? (
          <div className="py-10 text-center text-xs text-[#5C5C64]">
            No new notifications. You're all caught up!
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto divide-y divide-white/[0.07] pr-1 no-scrollbar">
            {notifications.map((notif) => (
              <div key={notif.id} className="py-3.5 flex items-start justify-between gap-3">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-['Sora',sans-serif] text-xs font-semibold text-[#EDEDEF] flex items-center gap-1.5">
                      {!notif.read && <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-primary)] shadow-[0_0_6px_var(--emphasis-glow)]" />}
                      {notif.title}
                    </span>
                    <span className="text-[10px] text-[#5C5C64] font-mono">{notif.time}</span>
                  </div>
                  <p className="text-xs text-[#9A9AA2] leading-relaxed">{notif.message}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {!notif.read && (
                    <button
                      onClick={() => markNotificationRead(notif.id)}
                      className="text-xs text-[#9A9AA2] hover:text-[#EDEDEF] transition-colors cursor-pointer bg-transparent border-none"
                    >
                      ✓
                    </button>
                  )}

                  {notif.type === 'invite' && notif.roomCode && (
                    <button
                      onClick={() => {
                        markNotificationRead(notif.id);
                        setNotificationsOpen(false);
                        joinRoom(notif.roomCode!);
                      }}
                      className="btn-primary text-xs px-3 py-1 rounded-[6px]"
                    >
                      Join →
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
