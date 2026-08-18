// src/components/messages/ForwardModal.tsx
// Friend picker for the message context menu's Forward action. The list is
// the authenticated user's accepted friends (the server re-checks the
// friendship before forwarding anyway).

import { useEffect, useMemo, useState } from 'react';
import type { Friend } from '../../types';
import { UserAvatar } from '../common/UserAvatar';

interface ForwardModalProps {
  open: boolean;
  friends: Friend[];
  onForward: (friendId: string) => void;
  onClose: () => void;
}

export function ForwardModal({ open, friends, onForward, onClose }: ForwardModalProps) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(
    () =>
      friends.filter((f) => {
        const q = query.trim().toLowerCase();
        if (!q) return true;
        return f.name.toLowerCase().includes(q) || f.username.toLowerCase().includes(q);
      }),
    [friends, query]
  );

  useEffect(() => {
    if (!open) return;
    setQuery('');
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
        className="w-full max-w-md float-surface p-6 relative text-[var(--text-primary)] pop-in flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Forward message"
      >
        <h2 className="font-display text-base font-semibold mb-4">Forward message</h2>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search friends…"
          className="field flex-1 min-w-0 text-sm py-2.5 mb-3"
          aria-label="Search friends"
          autoFocus
        />
        <div className="overflow-y-auto no-scrollbar flex-1 min-h-0">
          {filtered.length === 0 ? (
            <p className="text-[13px] text-[var(--text-tertiary)] py-6 text-center">
              {friends.length === 0 ? 'No friends yet to forward to.' : 'No friends match your search.'}
            </p>
          ) : (
            filtered.map((friend) => (
              <button
                key={friend.id}
                type="button"
                onClick={() => onForward(friend.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-[var(--bg-glass)] transition-colors cursor-pointer"
              >
                <UserAvatar avatar={friend.avatar} name={friend.name} className="w-9 h-9 font-bold text-xs" />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-medium truncate">{friend.name}</span>
                  <span className="block text-[11px] text-[var(--text-secondary)] truncate">@{friend.username}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}