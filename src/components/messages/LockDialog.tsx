// src/components/messages/LockDialog.tsx
// PIN dialog for chat locks. Modes:
//   set    — create the lock PIN (conversation menu → Lock chat)
//   verify — unlock this session (opening a locked conversation)
//   remove — verify the PIN, then remove the lock (Unlock chat)
// PINs are 4–64 characters and are only ever verified server-side (argon2
// hash); nothing here persists the PIN.

import { useEffect, useState } from 'react';

export type LockDialogMode = 'set' | 'verify' | 'remove';

interface LockDialogProps {
  open: boolean;
  mode: LockDialogMode;
  /** Server error surfaced from the last submit attempt (e.g. LOCK_INVALID). */
  error?: string | null;
  busy?: boolean;
  onSubmit: (pin: string) => void;
  onClose: () => void;
}

function copyFor(mode: LockDialogMode): { title: string; message: string; confirm: string } {
  switch (mode) {
    case 'set':
      return {
        title: 'Lock chat',
        message: 'Set a PIN to lock this conversation. The PIN is stored as a one-way hash — it cannot be recovered.',
        confirm: 'Lock chat',
      };
    case 'verify':
      return {
        title: 'Unlock conversation',
        message: 'Enter the PIN to view this conversation.',
        confirm: 'Unlock',
      };
    case 'remove':
      return {
        title: 'Unlock chat',
        message: 'Enter the current PIN to remove the lock from this conversation.',
        confirm: 'Remove lock',
      };
  }
}

export function LockDialog({ open, mode, error, busy, onSubmit, onClose }: LockDialogProps) {
  const [pin, setPin] = useState('');

  useEffect(() => {
    if (!open) return;
    setPin('');
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const copy = copyFor(mode);
  const valid = pin.length >= 4;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 select-none animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm float-surface p-6 relative text-[var(--text-primary)] pop-in"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={copy.title}
      >
        <h2 className="font-display text-base font-semibold mb-2">{copy.title}</h2>
        <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed mb-4">{copy.message}</p>
        <input
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN (4+ characters)"
          className="field w-full text-sm py-2.5 mb-2"
          aria-label="PIN"
          autoFocus
          maxLength={64}
        />
        {error && <p className="text-[12px] text-[var(--status-error)] mb-2">{error}</p>}
        <div className="flex items-center justify-end gap-2.5 mt-2">
          <button type="button" className="btn-secondary text-xs px-4 py-2" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn-primary text-xs px-4 py-2 disabled:opacity-40" onClick={() => onSubmit(pin)} disabled={!valid || busy}>
            {busy ? 'Working…' : copy.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}