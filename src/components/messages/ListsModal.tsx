// src/components/messages/ListsModal.tsx
// "Add to list" manager: create private conversation lists and delete them.
// Membership toggling happens per-conversation from the conversation menu
// submenu; this modal only manages the list containers. List state comes from
// AppContext so the menu submenu always mirrors the modal.

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ConfirmDialog } from '../common/ConfirmDialog';

interface ListsModalProps {
  open: boolean;
  onClose: () => void;
}

export function ListsModal({ open, onClose }: ListsModalProps) {
  const { conversationLists, createConversationList, deleteConversationList } = useApp();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setDeletingId(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    createConversationList(trimmed).then((ok) => {
      setCreating(false);
      if (ok) setName('');
    });
  };

  const handleDelete = (listId: string) => {
    deleteConversationList(listId).then(() => {
      setDeletingId(null);
    });
  };

  const deleting = conversationLists.find((l) => l.id === deletingId);

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 select-none animate-fade-in"
        onClick={onClose}
      >
        <div
          className="w-full max-w-md float-surface p-6 relative text-[var(--text-primary)] pop-in flex flex-col max-h-[80vh]"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Conversation lists"
        >
          <h2 className="font-display text-base font-semibold mb-4">Conversation lists</h2>
          <div className="flex gap-2.5 mb-4">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
              }}
              placeholder="New list name…"
              className="field flex-1 min-w-0 text-sm py-2.5"
              aria-label="New list name"
            />
            <button
              type="button"
              onClick={handleCreate}
              disabled={!name.trim() || creating}
              className="btn-primary text-xs px-4 py-2.5 shrink-0 disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
          <div className="overflow-y-auto no-scrollbar flex-1 min-h-0">
            {conversationLists.length === 0 ? (
              <p className="text-[13px] text-[var(--text-tertiary)] py-6 text-center">
                No lists yet. Create one, then use “Add to list” in a conversation menu.
              </p>
            ) : (
              conversationLists.map((list) => (
                <div
                  key={list.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--bg-glass)] transition-colors"
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-medium truncate">{list.name}</span>
                    <span className="block text-[11px] text-[var(--text-secondary)]">
                      {list.conversationIds.length === 0 ? 'No conversations' : `${list.conversationIds.length} conversation${list.conversationIds.length === 1 ? '' : 's'}`}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setDeletingId(list.id)}
                    className="shrink-0 p-1.5 rounded-full hover:bg-[var(--emphasis-dim)] text-[var(--text-tertiary)] hover:text-[var(--status-error)] transition-colors cursor-pointer"
                    aria-label={`Delete list ${list.name}`}
                    title="Delete list"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={deletingId !== null}
        title="Delete list?"
        message={
          deleting
            ? `“${deleting.name}” will be removed. Conversations stay in your chat list — only this grouping is deleted.`
            : ''
        }
        confirmLabel="Delete list"
        danger
        onConfirm={() => deletingId && handleDelete(deletingId)}
        onClose={() => setDeletingId(null)}
      />
    </>
  );
}