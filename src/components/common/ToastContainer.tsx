import React, { useState, useEffect } from 'react';
import { X, Bell, UserCheck, Play, Sparkles } from 'lucide-react';
import { NotificationItem } from '../../types';

interface ToastContainerProps {
  notifications: NotificationItem[];
  onDismiss: (id: string) => void;
  onAction?: (notification: NotificationItem) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({
  notifications,
  onDismiss,
  onAction
}) => {
  // Only display unread toasts
  const activeToasts = notifications.filter((n) => !n.read).slice(0, 3);

  return (
    <div className="fixed top-5 right-5 z-50 flex flex-col gap-3 max-w-sm w-full pointer-events-none select-none">
      {activeToasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onDismiss={() => onDismiss(toast.id)}
          onAction={() => onAction && onAction(toast)}
        />
      ))}
    </div>
  );
};

const ToastItem: React.FC<{
  toast: NotificationItem;
  onDismiss: () => void;
  onAction: () => void;
}> = ({ toast, onDismiss, onAction }) => {
  const [isPaused, setIsPaused] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (isPaused) return;

    const timer = setTimeout(() => {
      handleClose();
    }, 5000);

    return () => clearTimeout(timer);
  }, [isPaused]);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onDismiss();
    }, 150);
  };

  const icons = {
    invite: <Play className="w-4 h-4 text-[var(--text-primary)]" />,
    friend_request: <UserCheck className="w-4 h-4 text-[var(--text-primary)]" />,
    system: <Bell className="w-4 h-4 text-[var(--text-primary)]" />
  }[toast.type] || <Sparkles className="w-4 h-4 text-[var(--text-primary)]" />;

  return (
    <div
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className={`pointer-events-auto p-4 rounded-2xl bg-[var(--bg-surface-1)] border border-[var(--border-strong)] shadow-2xl backdrop-blur-md flex items-start gap-3 transition-all duration-150 text-[var(--text-primary)] ${
        isClosing ? 'scale-90 opacity-0' : 'animate-toast-in'
      }`}
    >
      <div className="w-8 h-8 rounded-xl bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] flex items-center justify-center shrink-0">
        {icons}
      </div>

      <div className="flex-1 space-y-1 min-w-0">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-[var(--text-primary)] font-heading">{toast.title}</h4>
          <span className="text-[9px] text-[var(--text-tertiary)] font-mono">{toast.time}</span>
        </div>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed line-clamp-2">{toast.message}</p>

        {toast.roomCode && (
          <button
            onClick={() => {
              onAction();
              handleClose();
            }}
            className="mt-2 text-[11px] font-bold text-[var(--text-primary)] underline underline-offset-2 decoration-[var(--border-strong)] flex items-center gap-1 cursor-pointer"
          >
            Join Watch Room Now &rarr;
          </button>
        )}
      </div>

      <button
        onClick={handleClose}
        className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] p-1 rounded-lg hover:bg-[var(--bg-surface-2)] transition-colors shrink-0 cursor-pointer"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
