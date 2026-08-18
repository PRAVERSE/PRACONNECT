// src/components/common/ConfirmDialog.tsx
// Modal confirmation for destructive context-menu actions (delete chat,
// clear chat, delete message, remove list). Uses the standard modal shell
// (fixed overlay + float-surface pop-in) shared by the app's dialogs.

import { useEffect } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({ open, title, message, confirmLabel, danger, busy, onConfirm, onClose }: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 select-none animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm float-surface p-6 relative text-[var(--text-primary)] pop-in"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
      >
        <h2 className="font-display text-base font-semibold mb-2">{title}</h2>
        <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed mb-6">{message}</p>
        <div className="flex items-center justify-end gap-2.5">
          <button type="button" className="btn-secondary text-xs px-4 py-2" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`text-xs px-4 py-2 rounded-full disabled:opacity-40 ${danger ? 'bg-[var(--status-error)] text-white' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}