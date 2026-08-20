// src/components/messages/MessageInfoModal.tsx
// "Message info" dialog with 3-state WhatsApp-style timestamps (Sent, Delivered, Read)
// and reaction list breakdown.

import { useEffect } from 'react';
import { Check, CheckCheck } from 'lucide-react';
import type { DirectMessage } from '../../types';

interface MessageInfoModalProps {
  open: boolean;
  message: DirectMessage | null;
  onClose: () => void;
}

function formatFullDate(iso?: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

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

  const sentTime = formatFullDate(messageInstant(message));
  const isDelivered = message.status === 'delivered' || message.status === 'read';
  const isRead = message.status === 'read';
  const deliveredTime = message.deliveredAt ? formatFullDate(message.deliveredAt) : isDelivered ? sentTime : '—';
  const readTime = message.readAt ? formatFullDate(message.readAt) : isRead ? sentTime : '—';

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

        {/* ─── 3-State Delivery & Read Status Timestamps ─────────────────────── */}
        <div className="border-t border-[var(--border-hairline)] pt-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-[var(--text-tertiary)] flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5 text-white/60" aria-hidden="true" />
              <span>Sent</span>
            </span>
            <span className="text-[12px] text-[var(--text-secondary)] font-mono">{sentTime}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[12px] text-[var(--text-tertiary)] flex items-center gap-1.5">
              <CheckCheck className={`w-3.5 h-3.5 ${isDelivered ? 'text-white/80' : 'text-white/30'}`} aria-hidden="true" />
              <span>Delivered</span>
            </span>
            <span className={`text-[12px] font-mono ${isDelivered ? 'text-[var(--text-secondary)]' : 'text-[var(--text-tertiary)]'}`}>
              {deliveredTime}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[12px] text-[var(--text-tertiary)] flex items-center gap-1.5">
              <CheckCheck className={`w-3.5 h-3.5 ${isRead ? 'text-cyan-400' : 'text-white/30'}`} aria-hidden="true" />
              <span>Read</span>
            </span>
            <span className={`text-[12px] font-mono ${isRead ? 'text-cyan-400 font-semibold' : 'text-[var(--text-tertiary)]'}`}>
              {readTime}
            </span>
          </div>
        </div>

        {/* ─── Reactions List if present ─────────────────────────────────────── */}
        {message.reactions && message.reactions.length > 0 && (
          <div className="border-t border-[var(--border-hairline)] mt-3.5 pt-3.5">
            <span className="text-[11px] text-[var(--text-tertiary)] font-medium block mb-2">Reactions</span>
            <div className="flex flex-wrap gap-1.5">
              {message.reactions.map((r) => (
                <span
                  key={r.emoji}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--bg-glass)] border border-[var(--border-hairline)] text-xs"
                >
                  <span>{r.emoji}</span>
                  <span className="font-semibold text-[11px] text-[var(--text-secondary)]">{r.count}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end mt-5">
          <button type="button" className="btn-secondary text-xs px-4 py-2" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}