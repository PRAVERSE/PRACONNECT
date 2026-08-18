// src/components/messages/MessageInfoModal.tsx
// "Message info" dialog. This system has no read receipts or delivery
// confirmations — the only authoritative fact is the server timestamp, so
// the modal shows when the message was sent, plus reply/forward context.

import { useEffect } from 'react';
import type { DirectMessage } from '../../types';

interface MessageInfoModalProps {
  open: boolean;
  message: DirectMessage | null;
  onClose: () => void;
}

function formatFullDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** The UI keeps a locale `timestamp` and the server ISO `createdAt`; the
 *  info dialog wants the authoritative instant. */
function messageInstant(message: DirectMessage): string {
  return message.createdAt ?? message.timestamp;
}

export function MessageInfoModal({ open, message, onClose }: MessageInfoModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || !message) return null;

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
        aria-label="Message info"
      >
        <h2 className="font-display text-base font-semibold mb-4">Message info</h2>
        {!message.deletedForEveryone && message.text ? (
          <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed mb-4 break-words">{message.text}</p>
        ) : (
          <p className="text-[13px] text-[var(--text-tertiary)] mb-4 italic">This message was deleted.</p>
        )}
        {message.replyTo && !message.replyTo.deleted && (
          <p className="text-[12px] text-[var(--text-tertiary)] mb-2">
            In reply to: <span className="text-[var(--text-secondary)]">{message.replyTo.text}</span>
          </p>
        )}
        <div className="flex items-center justify-between border-t border-[var(--border-hairline)] pt-4">
          <span className="text-[12px] text-[var(--text-tertiary)]">Sent</span>
          <span className="text-[12px] text-[var(--text-secondary)] font-mono">{formatFullDate(messageInstant(message))}</span>
        </div>
        <div className="flex justify-end mt-5">
          <button type="button" className="btn-secondary text-xs px-4 py-2" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}