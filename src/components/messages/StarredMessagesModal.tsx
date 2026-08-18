// src/components/messages/StarredMessagesModal.tsx
// "Starred messages" browser: the user's own starred list, fetched on open
// (the server keeps this list per-user). Unstarring removes the row live.

import { useCallback, useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { fetchStarredMessagesApi, unstarMessageApi } from '../../api/social';
import type { StarredMessageItem } from '../../api/social';
import { UserAvatar } from '../common/UserAvatar';

interface StarredMessagesModalProps {
  open: boolean;
  onClose: () => void;
}

export function StarredMessagesModal({ open, onClose }: StarredMessagesModalProps) {
  const [items, setItems] = useState<StarredMessageItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetchStarredMessagesApi().then((res) => {
      setLoading(false);
      if (res.ok && res.data) setItems(res.data.starred);
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    setItems([]);
    load();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, load]);

  if (!open) return null;

  const handleUnstar = (item: StarredMessageItem) => {
    unstarMessageApi(item.message.id).then((res) => {
      if (res.ok) setItems((prev) => prev.filter((i) => i.message.id !== item.message.id));
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 select-none animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md float-surface p-6 relative text-[var(--text-primary)] pop-in flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Starred messages"
      >
        <h2 className="font-display text-base font-semibold mb-4">Starred messages</h2>
        <div className="overflow-y-auto no-scrollbar flex-1 min-h-0">
          {loading ? (
            <p className="text-[13px] text-[var(--text-tertiary)] py-6 text-center">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-[13px] text-[var(--text-tertiary)] py-6 text-center">
              No starred messages yet. Star messages from the message menu to find them here.
            </p>
          ) : (
            items.map((item) => (
              <div key={item.message.id} className="flex items-start gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--bg-glass)] transition-colors">
                <UserAvatar name={item.peerName} className="w-8 h-8 font-bold text-xs shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-medium text-[var(--text-secondary)] truncate">
                      {item.peerName} · @{item.peerUsername}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleUnstar(item)}
                      className="shrink-0 p-1.5 rounded-full hover:bg-[var(--emphasis-dim)] text-[var(--text-tertiary)] transition-colors cursor-pointer"
                      aria-label="Unstar message"
                      title="Unstar"
                    >
                      <Star className="w-4 h-4 fill-current" aria-hidden="true" />
                    </button>
                  </div>
                  <p className="text-[13px] text-[var(--text-primary)] leading-relaxed break-words mt-0.5">
                    {item.message.deletedForEveryone || !item.message.text ? (
                      <span className="italic text-[var(--text-tertiary)]">This message was deleted.</span>
                    ) : (
                      item.message.text
                    )}
                  </p>
                  <span className="text-[10px] text-[var(--text-tertiary)] font-mono mt-1 block">
                    {new Date(item.message.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}