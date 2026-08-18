import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageSquare,
  Search,
  X,
  ArrowLeft,
  Users,
  Send,
  UserPlus,
  Play,
  Loader,
  Plus,
  Info,
  CornerUpLeft,
  Copy,
  Forward,
  Pin,
  Star,
  Square,
  Trash2,
  Archive,
  Lock,
  Unlock,
  Bookmark,
  MailOpen,
  MailCheck,
  List as ListIcon,
  Eraser,
  Check
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { UserAvatar } from '../common/UserAvatar';
import { ContextMenu } from '../common/ContextMenu';
import type { ContextMenuItem } from '../common/ContextMenu';
import type { ContextMenuItem as MenuItemModel } from '../../utils/contextMenu';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { ForwardModal } from '../messages/ForwardModal';
import { MessageInfoModal } from '../messages/MessageInfoModal';
import { StarredMessagesModal } from '../messages/StarredMessagesModal';
import { LockDialog } from '../messages/LockDialog';
import type { LockDialogMode } from '../messages/LockDialog';
import { ListsModal } from '../messages/ListsModal';
import { useLongPress } from '../../hooks/useLongPress';
import {
  buildMessageMenuItems,
  buildConversationMenuItems,
  toggleSelection,
  selectionCount,
  conversationKeyFor
} from '../../utils/contextMenu';
import { fetchStarredMessagesApi } from '../../api/social';
import { Friend, DirectMessage } from '../../types';

export const MessagesView: React.FC = () => {
  const {
    friends,
    conversations,
    activeDMId,
    setActiveDMId,
    dmConversations,
    sendDirectMessage,
    sendReply,
    openConversation,
    setActiveTab,
    currentRoom,
    sendWatchInvite,
    watchInvites,
    acceptWatchInvite,
    declineWatchInvite,
    currentUser,
    pinnedMessageIds,
    sendForward,
    pinMessage,
    unpinMessage,
    starMessage,
    unstarMessage,
    deleteMessageForMe,
    deleteMessageForEveryone,
    setConversationArchived,
    setConversationPinned,
    setConversationFavourite,
    markConversationRead,
    markConversationUnread,
    clearChat,
    deleteChat,
    setChatLockPin,
    unlockChat,
    verifyChatLock,
    isChatVerified,
    conversationLists,
    addConversationToList,
    removeConversationFromList
  } = useApp();

  const [messageInput, setMessageInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [newChatSearchQuery, setNewChatSearchQuery] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);
  const [acceptingInviteId, setAcceptingInviteId] = useState<string | null>(null);

  // ─── Context-menu state (message + conversation) ───────────────────────────
  const [messageMenu, setMessageMenu] = useState<{ x: number; y: number; message: DirectMessage } | null>(null);
  const [conversationMenu, setConversationMenu] = useState<{ x: number; y: number; friendId: string } | null>(null);
  const [forwardTarget, setForwardTarget] = useState<DirectMessage | null>(null);
  const [infoTarget, setInfoTarget] = useState<DirectMessage | null>(null);
  const [starredOpen, setStarredOpen] = useState(false);
  const [listsOpen, setListsOpen] = useState(false);
  const [lockDialog, setLockDialog] = useState<{ friendId: string; mode: LockDialogMode } | null>(null);
  const [lockError, setLockError] = useState<string | null>(null);
  const [lockBusy, setLockBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    kind: 'clear-chat' | 'delete-chat' | 'delete-for-me' | 'delete-for-everyone';
    friendId?: string;
    messageId?: string;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<DirectMessage | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [starredIds, setStarredIds] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const modalInputRef = useRef<HTMLInputElement>(null);
  const touchTargetRef = useRef<{ kind: 'message' | 'conversation'; message?: DirectMessage; friendId?: string } | null>(null);

  const activeConversation = conversations.find((c) => c.friendId === activeDMId) || null;
  const activeFriend = activeDMId ? friends.find((f) => f.id === activeDMId) || null : null;
  const messages = activeDMId ? dmConversations[activeDMId] || [] : [];

  // Pending watch invites from the active conversation's friend (incoming) or
  // to them (outgoing), oldest first.
  const activeInvites = activeDMId
    ? watchInvites.filter(
        (i) =>
          i.status === 'pending' &&
          (i.direction === 'incoming' ? i.sender.id === activeDMId : i.recipient.id === activeDMId)
      )
    : [];

  const filteredFriends = friends.filter(
    (f) =>
      f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredNewChatFriends = friends.filter(
    (f) =>
      f.name.toLowerCase().includes(newChatSearchQuery.toLowerCase()) ||
      f.username.toLowerCase().includes(newChatSearchQuery.toLowerCase())
  );

  useEffect(() => {
    if (activeDMId && messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeDMId, messages.length, activeInvites.length]);

  useEffect(() => {
    if (isNewChatOpen) {
      setTimeout(() => modalInputRef.current?.focus(), 50);
    } else {
      setNewChatSearchQuery('');
    }
  }, [isNewChatOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isNewChatOpen) {
        setIsNewChatOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isNewChatOpen]);

  const handleSelectConversation = async (friendId: string) => {
    setActiveDMId(friendId);
    const conv = conversations.find((c) => c.friendId === friendId);
    if (conv?.locked && !isChatVerified(friendId)) {
      const opened = await openConversation(friendId);
      if (!opened) {
        setLockDialog({ friendId, mode: 'verify' });
        return;
      }
    }
    openConversation(friendId);
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || !activeDMId) return;
    if (replyTo) {
      sendReply(activeDMId, messageInput.trim(), replyTo.id);
    } else {
      sendDirectMessage(activeDMId, messageInput.trim());
    }
    setReplyTo(null);
    setMessageInput('');
  };

  const handleSelectFriendForChat = (friend: Friend) => {
    handleSelectConversation(friend.id);
    setIsNewChatOpen(false);
    setNewChatSearchQuery('');
  };

  const handleInviteToWatch = async () => {
    if (!activeDMId || !currentRoom || sendingInvite) return;
    setSendingInvite(true);
    await sendWatchInvite(activeDMId, currentRoom.id);
    setSendingInvite(false);
  };

  const handleAcceptInvite = async (inviteId: string) => {
    if (acceptingInviteId) return;
    setAcceptingInviteId(inviteId);
    await acceptWatchInvite(inviteId);
    setAcceptingInviteId(null);
  };

  // ─── Context-menu helpers ──────────────────────────────────────────────────

  const refreshStarredIds = useCallback(() => {
    fetchStarredMessagesApi().then((res) => {
      if (res.ok && res.data) setStarredIds(res.data.starred.map((s) => s.message.id));
    });
  }, []);

  useEffect(() => {
    if (currentUser?.id) refreshStarredIds();
  }, [currentUser?.id, refreshStarredIds]);

  const isMessagePinned = (messageId: string) =>
    Boolean(activeDMId && (pinnedMessageIds[activeDMId] ?? []).includes(messageId));

  const openMessageMenu = (message: DirectMessage, x: number, y: number) => {
    setMessageMenu({ x, y, message });
  };

  const openConversationMenu = (friendId: string, x: number, y: number) => {
    setConversationMenu({ x, y, friendId });
  };

  const messageLongPress = useLongPress((x, y) => {
    const target = touchTargetRef.current;
    if (target?.kind === 'message' && target.message) openMessageMenu(target.message, x, y);
  });

  const conversationLongPress = useLongPress((x, y) => {
    const target = touchTargetRef.current;
    if (target?.kind === 'conversation' && target.friendId) openConversationMenu(target.friendId, x, y);
  });

  const messageMenuItems: ContextMenuItem[] = (() => {
    if (!messageMenu) return [];
    const msg = messageMenu.message;
    const opts = {
      myId: currentUser?.id ?? '',
      nowMs: Date.now(),
      isPinned: isMessagePinned(msg.id),
      isStarred: starredIds.includes(msg.id),
    };
    const icons: Record<string, LucideIcon> = {
      info: Info,
      reply: CornerUpLeft,
      copy: Copy,
      forward: Forward,
      pin: Pin,
      star: Star,
      select: Square,
      delete: Trash2,
      'delete-for-me': Trash2,
      'delete-for-everyone': Trash2,
    };
    const withIcons = (items: MenuItemModel[]): ContextMenuItem[] =>
      items.map((item) => ({
        ...item,
        icon: icons[item.id] ?? Info,
        submenu: item.submenu ? withIcons(item.submenu) : undefined,
      }));
    return withIcons(buildMessageMenuItems(msg, opts));
  })();

  const conversationMenuItems: ContextMenuItem[] = (() => {
    if (!conversationMenu) return [];
    const conv = conversations.find((c) => c.friendId === conversationMenu.friendId);
    if (!conv) return [];
    const icons: Record<string, LucideIcon> = {
      archive: Archive,
      lock: conv.locked ? Unlock : Lock,
      pin: Pin,
      read: conv.unreadCount && conv.unreadCount > 0 ? MailOpen : MailCheck,
      favourite: Bookmark,
      lists: ListIcon,
      clear: Eraser,
      delete: Trash2,
      'list:new': Plus,
    };
    const withIcons = (items: MenuItemModel[]): ContextMenuItem[] =>
      items.map((item) => ({
        ...item,
        icon: item.id.startsWith('list:') && item.id !== 'list:new' ? ListIcon : (icons[item.id] ?? Info),
        submenu: item.submenu ? withIcons(item.submenu) : undefined,
      }));
    return withIcons(
      buildConversationMenuItems(
        {
          friendId: conv.friendId,
          name: conv.name,
          archived: Boolean(conv.archived),
          pinned: Boolean(conv.pinned),
          favourite: Boolean(conv.favourite),
          locked: Boolean(conv.locked),
          unreadCount: conv.unreadCount ?? 0,
        },
        {
          conversationKey: conversationKeyFor(conv.friendId, currentUser?.id ?? ''),
          lists: conversationLists.map((l) => ({ id: l.id, name: l.name, conversationIds: l.conversationIds })),
        }
      )
    );
  })();

  const handleMessageMenuSelect = (item: ContextMenuItem) => {
    if (!messageMenu) return;
    const msg = messageMenu.message;
    switch (item.id) {
      case 'info':
        setInfoTarget(msg);
        break;
      case 'reply':
        setReplyTo(msg);
        break;
      case 'copy': {
        void navigator.clipboard?.writeText(msg.text).catch(() => {});
        break;
      }
      case 'forward':
        setForwardTarget(msg);
        break;
      case 'pin':
        if (isMessagePinned(msg.id)) {
          void unpinMessage(msg.id);
        } else {
          void pinMessage(msg.id);
        }
        break;
      case 'star':
        if (starredIds.includes(msg.id)) {
          void unstarMessage(msg.id).then((ok) => ok && refreshStarredIds());
        } else {
          void starMessage(msg.id).then((ok) => ok && refreshStarredIds());
        }
        break;
      case 'select':
        setSelectionMode(true);
        setSelectedIds((prev) => toggleSelection(msg.id, prev));
        break;
      case 'delete-for-me':
        setConfirmAction({ kind: 'delete-for-me', messageId: msg.id });
        break;
      case 'delete-for-everyone':
        setConfirmAction({ kind: 'delete-for-everyone', messageId: msg.id });
        break;
    }
  };

  const handleConversationMenuSelect = (item: ContextMenuItem) => {
    if (!conversationMenu) return;
    const friendId = conversationMenu.friendId;
    const conv = conversations.find((c) => c.friendId === friendId);
    switch (item.id) {
      case 'archive':
        if (conv) void setConversationArchived(friendId, !conv.archived);
        break;
      case 'lock':
        setLockDialog({ friendId, mode: conv?.locked ? 'remove' : 'set' });
        break;
      case 'pin':
        if (conv) void setConversationPinned(friendId, !conv.pinned);
        break;
      case 'read':
        if (conv && (conv.unreadCount ?? 0) > 0) {
          void markConversationRead(friendId);
        } else {
          void markConversationUnread(friendId);
        }
        break;
      case 'favourite':
        if (conv) void setConversationFavourite(friendId, !conv.favourite);
        break;
      case 'list:new':
        setListsOpen(true);
        break;
      case 'clear':
        setConfirmAction({ kind: 'clear-chat', friendId });
        break;
      case 'delete':
        setConfirmAction({ kind: 'delete-chat', friendId });
        break;
      default: {
        if (item.id.startsWith('list:')) {
          const listId = item.id.slice(5);
          const list = conversationLists.find((l) => l.id === listId);
          const key = conversationKeyFor(friendId, currentUser?.id ?? '');
          const isMember = Boolean(list && list.conversationIds.includes(key));
          if (isMember) {
            void removeConversationFromList(listId, friendId);
          } else {
            void addConversationToList(listId, friendId);
          }
        }
        break;
      }
    }
  };

  const handleLockSubmit = (pin: string) => {
    if (!lockDialog) return;
    setLockBusy(true);
    setLockError(null);
    const { friendId, mode } = lockDialog;
    const done = (ok: boolean) => {
      setLockBusy(false);
      if (ok) {
        setLockDialog(null);
      }
    };
    if (mode === 'set') {
      setChatLockPin(friendId, pin).then(done);
    } else if (mode === 'verify') {
      verifyChatLock(friendId, pin).then((ok) => {
        done(ok);
        if (ok) setActiveDMId(friendId);
      });
    } else {
      unlockChat(friendId, pin).then(done);
    }
  };

  const handleConfirm = () => {
    if (!confirmAction) return;
    setConfirmBusy(true);
    const finish = () => setConfirmBusy(false);
    switch (confirmAction.kind) {
      case 'clear-chat':
        if (confirmAction.friendId) void clearChat(confirmAction.friendId).then(() => setConfirmAction(null));
        break;
      case 'delete-chat': {
        const friendId = confirmAction.friendId;
        if (friendId) {
          void deleteChat(friendId).then(() => {
            setConfirmAction(null);
            setActiveDMId(null);
          });
        }
        break;
      }
      case 'delete-for-me':
        if (confirmAction.messageId) {
          void deleteMessageForMe(confirmAction.messageId).then(() => {
            setConfirmAction(null);
            setSelectedIds((prev) => prev.filter((id) => id !== confirmAction.messageId));
          });
        }
        break;
      case 'delete-for-everyone':
        if (confirmAction.messageId) {
          void deleteMessageForEveryone(confirmAction.messageId).then(() => {
            setConfirmAction(null);
            setSelectedIds((prev) => prev.filter((id) => id !== confirmAction.messageId));
          });
        }
        break;
    }
    finish();
  };

  const confirmCopy = (() => {
    switch (confirmAction?.kind) {
      case 'clear-chat':
        return { title: 'Clear chat?', message: 'Messages will be removed for you only. This cannot be undone.', label: 'Clear chat' };
      case 'delete-chat':
        return { title: 'Delete chat?', message: 'This conversation will be removed from your list. This cannot be undone.', label: 'Delete chat' };
      case 'delete-for-me':
        return { title: 'Delete message?', message: 'The message will be removed for you only. The other person can still see it.', label: 'Delete for me' };
      case 'delete-for-everyone':
        return { title: 'Delete for everyone?', message: 'The message will be deleted for both of you. This cannot be undone.', label: 'Delete for everyone' };
      default:
        return { title: '', message: '', label: '' };
    }
  })();

  const toggleSelectMessage = (messageId: string) => {
    if (!selectionMode) {
      setSelectionMode(true);
    }
    setSelectedIds((prev) => toggleSelection(messageId, prev));
  };

  const handleSelectionDelete = () => {
    for (const id of selectedIds) {
      void deleteMessageForMe(id);
    }
    setSelectedIds([]);
    setSelectionMode(false);
  };

  const handleSelectionCopy = () => {
    const texts = selectedIds
      .map((id) => (activeDMId ? dmConversations[activeDMId] ?? [] : []).find((m) => m.id === id))
      .filter((m) => m && !m.deletedForEveryone && m.text)
      .map((m) => m!.text)
      .join('\n');
    if (texts) void navigator.clipboard?.writeText(texts).catch(() => {});
    setSelectedIds([]);
    setSelectionMode(false);
  };

  const hasNoConversations = conversations.length === 0 && friends.length === 0;
  const hasSearchQuery = searchQuery.trim().length > 0;
  const isSearchEmpty = !hasNoConversations && hasSearchQuery && filteredFriends.length === 0;

  const inviteStatusLabel = (inviteId: string) =>
    watchInvites.find((i) => i.id === inviteId)?.status ?? 'pending';

  return (
    <div className="w-full h-full min-h-0 flex flex-col pt-8 md:pt-10 px-4 sm:px-8 md:px-16 text-[var(--text-primary)] font-['Inter',sans-serif] select-none">
      {/* ─── PAGE HEADER — same rhythm as Friends/Explore ──────────────────── */}
      <header
        className={`flex items-center justify-between gap-4 mb-6 shrink-0 ${
          activeConversation ? 'hidden md:flex' : 'flex'
        }`}
        style={{ animation: 'rise 640ms var(--ease) both' }}
      >
        <div className="min-w-0">
          <h1
            className="font-display font-bold tracking-[-0.02em] text-[clamp(1.75rem,2.8vw,2.4rem)] leading-[1.1]"
            style={{ animation: 'rise 640ms var(--ease) 80ms both' }}
          >
            Messages
          </h1>
          <p
            className="text-[15px] leading-relaxed text-[var(--text-secondary)] mt-2"
            style={{ animation: 'rise 640ms var(--ease) 150ms both' }}
          >
            Chat with your squad and send watch invites straight from the room.
          </p>
        </div>

        <button
          onClick={() => setIsNewChatOpen(true)}
          className="btn-primary text-sm shrink-0"
          style={{ animation: 'rise 640ms var(--ease) 220ms both' }}
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          <span className="hidden sm:inline">New Message</span>
        </button>
      </header>

      {/* ─── Thin section divider, matching the rest of the app ─────────────── */}
      <div
        className={`h-px w-full bg-[var(--border-hairline)] shrink-0 ${
          activeConversation ? 'hidden md:block' : 'block'
        }`}
      />

      {/* ─── MESSAGING WORKSPACE — fills the remaining page height ─────────── */}
      <div className="flex-1 min-h-0 w-full flex overflow-hidden">
        {/* ─── LEFT: Conversation rail — quiet section, contrast not boxes ─── */}
        <aside
          className={`w-full md:w-[280px] lg:w-[320px] shrink-0 h-full min-h-0 bg-[var(--bg-surface-2)] flex flex-col ${
            activeConversation ? 'hidden md:flex' : 'flex'
          }`}
        >
          {!hasNoConversations && (
            <div className="px-4 pt-4 pb-3 shrink-0 relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search conversations..."
                className="field w-full pl-12 pr-10"
                aria-label="Search conversations"
              />
              <Search
                className="w-4 h-4 text-[var(--text-tertiary)] absolute left-[18px] top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              {hasSearchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-4 top-1/2 -translate-y-1/2 p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors rounded-full cursor-pointer"
                  aria-label="Clear search query"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar flex flex-col">
            {hasNoConversations ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-8">
                <div className="breath mb-4 text-[var(--text-tertiary)]">
                  <MessageSquare className="w-8 h-8" strokeWidth={1.5} aria-hidden="true" />
                </div>
                <h3 className="font-display text-[15px] font-semibold text-[var(--text-primary)] mb-1.5">
                  No conversations yet
                </h3>
                <p className="text-xs text-[var(--text-secondary)] mb-5 leading-relaxed max-w-[220px]">
                  Add friends from the Friends tab to start chatting.
                </p>
                <button
                  onClick={() => setActiveTab('friends')}
                  className="btn-primary text-xs px-4 py-2"
                >
                  Go to Friends
                </button>
              </div>
            ) : isSearchEmpty ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
                <Search className="w-7 h-7 text-[var(--text-tertiary)] mb-3" strokeWidth={1.5} aria-hidden="true" />
                <p className="text-xs text-[var(--text-primary)] font-semibold mb-2">
                  No results for &ldquo;{searchQuery}&rdquo;
                </p>
                <button
                  onClick={() => setSearchQuery('')}
                  className="arrow-link text-xs"
                >
                  Clear search
                </button>
              </div>
            ) : (
              <div className="flex flex-col pb-2">
                {conversations.length > 0 &&
                  conversations
                    .filter((c) => {
                      if (!searchQuery) return true;
                      return (
                        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        c.username.toLowerCase().includes(searchQuery.toLowerCase())
                      );
                    })
                    .map((conv, i) => {
                      const isSelected = conv.friendId === activeConversation?.friendId;
                      const lastMsg = conv.lastMessage;
                      const unread = conv.unreadCount ?? 0;
                      return (
                        <button
                          key={conv.friendId}
                          onClick={() => handleSelectConversation(conv.friendId)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            touchTargetRef.current = { kind: 'conversation', friendId: conv.friendId };
                            openConversationMenu(conv.friendId, e.clientX, e.clientY);
                          }}
                          onTouchStart={(e) => {
                            touchTargetRef.current = { kind: 'conversation', friendId: conv.friendId };
                            conversationLongPress.onTouchStart(e);
                          }}
                          onTouchMove={conversationLongPress.onTouchMove}
                          onTouchEnd={conversationLongPress.onTouchEnd}
                          onTouchCancel={conversationLongPress.onTouchCancel}
                          onClickCapture={conversationLongPress.onClickCapture}
                          className={`w-full px-4 py-3 flex items-center gap-3 text-left transition-colors cursor-pointer ${
                            i > 0 ? 'border-t border-[var(--border-hairline)]' : ''
                          } ${
                            isSelected ? 'bg-[var(--emphasis-dim)]' : 'hover:bg-[var(--bg-glass)]'
                          }`}
                        >
                          <div className="relative shrink-0">
                            <UserAvatar
                              avatar={conv.avatar}
                              name={conv.name}
                              className="w-9 h-9 font-bold text-xs"
                            />
                            <span
                              className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-[var(--bg)] ${
                                conv.online
                                  ? 'bg-[var(--text-primary)] live-dot shadow-[0_0_6px_var(--emphasis-glow)]'
                                  : 'bg-[var(--text-tertiary)]'
                              }`}
                            />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-display text-[13px] font-semibold text-[var(--text-primary)] truncate">
                                {conv.name}
                              </span>
                              <span className="flex items-center gap-1.5 shrink-0">
                                {conv.locked && <Lock className="w-3 h-3 text-[var(--text-tertiary)]" aria-hidden="true" />}
                                {conv.pinned && <Pin className="w-3 h-3 text-[var(--text-tertiary)]" aria-hidden="true" />}
                                {lastMsg && (
                                  <span className="text-[10px] text-[var(--text-tertiary)] font-mono shrink-0">
                                    {new Date(lastMsg.createdAt).toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </span>
                                )}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2 mt-0.5">
                              <p className="text-[11px] text-[var(--text-secondary)] truncate">
                                {lastMsg
                                  ? `${lastMsg.senderId === currentUser?.id ? 'You: ' : ''}${conv.locked && !isChatVerified(conv.friendId) ? 'Locked conversation' : lastMsg.text}`
                                  : `Start chatting with @${conv.username}`}
                              </p>
                              {unread > 0 && (
                                <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-[var(--emphasis)] text-[var(--bg)] text-[10px] font-semibold flex items-center justify-center shrink-0">
                                  {unread > 99 ? '99+' : unread}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}

                {conversations.length === 0 &&
                  friends
                    .filter((f) => {
                      if (!searchQuery) return true;
                      return (
                        f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        f.username.toLowerCase().includes(searchQuery.toLowerCase())
                      );
                    })
                    .map((friend, i) => {
                      const isSelected = friend.id === activeConversation?.friendId;
                      return (
                        <button
                          key={friend.id}
                          onClick={() => handleSelectConversation(friend.id)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            touchTargetRef.current = { kind: 'conversation', friendId: friend.id };
                            openConversationMenu(friend.id, e.clientX, e.clientY);
                          }}
                          onTouchStart={(e) => {
                            touchTargetRef.current = { kind: 'conversation', friendId: friend.id };
                            conversationLongPress.onTouchStart(e);
                          }}
                          onTouchMove={conversationLongPress.onTouchMove}
                          onTouchEnd={conversationLongPress.onTouchEnd}
                          onTouchCancel={conversationLongPress.onTouchCancel}
                          onClickCapture={conversationLongPress.onClickCapture}
                          className={`w-full px-4 py-3 flex items-center gap-3 text-left transition-colors cursor-pointer ${
                            i > 0 ? 'border-t border-[var(--border-hairline)]' : ''
                          } ${
                            isSelected ? 'bg-[var(--emphasis-dim)]' : 'hover:bg-[var(--bg-glass)]'
                          }`}
                        >
                          <div className="relative shrink-0">
                            <UserAvatar
                              avatar={friend.avatar}
                              name={friend.name}
                              className="w-9 h-9 font-bold text-xs"
                            />
                            <span
                              className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-[var(--bg)] ${
                                friend.status === 'online'
                                  ? 'bg-[var(--text-primary)] live-dot shadow-[0_0_6px_var(--emphasis-glow)]'
                                  : 'bg-[var(--text-tertiary)]'
                              }`}
                            />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="font-display text-[13px] font-semibold text-[var(--text-primary)] truncate">
                              {friend.name}
                            </div>
                            <div className="text-[11px] text-[var(--text-secondary)] truncate">
                              Start chatting with @{friend.username}
                            </div>
                          </div>
                        </button>
                      );
                    })}
              </div>
            )}
          </div>
        </aside>

        {/* ─── RIGHT: Chat area — page surface, no box ─────────────────────── */}
        <section
          className={`flex-1 min-w-0 min-h-0 bg-[var(--bg-canvas)] flex flex-col ${
            activeFriend ? 'flex' : 'hidden md:flex'
          }`}
        >
          {activeFriend ? (
            <>
              {/* Conversation header — friend identity + Invite to Watch */}
              <header className="shrink-0 px-4 sm:px-6 py-4 border-b border-[var(--border-hairline)] flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    onClick={() => setActiveDMId(null)}
                    className="md:hidden p-1.5 -ml-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-glass)] rounded-full transition-colors cursor-pointer"
                    aria-label="Back to conversations"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>

                  <UserAvatar
                    avatar={activeFriend.avatar}
                    name={activeFriend.name}
                    className="w-9 h-9 font-bold text-xs"
                  />
                  <div className="min-w-0">
                    <h2 className="font-display text-sm font-semibold text-[var(--text-primary)] leading-none mb-1 truncate">
                      {activeFriend.name}
                    </h2>
                    <div className="text-[11px] text-[var(--text-secondary)] flex items-center gap-1.5">
                      <span className="truncate">@{activeFriend.username}</span>
                      <span>·</span>
                      <span className="flex items-center gap-1.5">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            activeFriend.status === 'online'
                              ? 'bg-[var(--text-primary)] live-dot shadow-[0_0_6px_var(--emphasis-glow)]'
                              : 'bg-[var(--text-tertiary)]'
                          }`}
                        />
                        {activeFriend.status === 'online' ? 'Online' : 'Offline'}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleInviteToWatch}
                  disabled={!currentRoom || sendingInvite}
                  className="btn-primary text-xs px-3.5 py-2 shrink-0 disabled:opacity-40"
                  title={currentRoom ? `Invite ${activeFriend.name} to ${currentRoom.name}` : 'Join or create a room first'}
                >
                  {sendingInvite ? (
                    <Loader className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Play className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span>Invite to Watch</span>
                </button>
                <button
                  onClick={() => setStarredOpen(true)}
                  className="shrink-0 p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-glass)] rounded-full transition-colors cursor-pointer"
                  aria-label="Starred messages"
                  title="Starred messages"
                >
                  <Star className="w-4 h-4" aria-hidden="true" />
                </button>
                <button
                  onClick={() => setListsOpen(true)}
                  className="shrink-0 p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-glass)] rounded-full transition-colors cursor-pointer"
                  aria-label="Conversation lists"
                  title="Conversation lists"
                >
                  <ListIcon className="w-4 h-4" aria-hidden="true" />
                </button>
              </header>

              {/* Message stream — the only scrollable region on the right */}
              {selectionMode && (
                <div className="shrink-0 px-4 sm:px-6 py-2.5 border-b border-[var(--border-hairline)] flex items-center justify-between gap-3">
                  <span className="text-[12px] text-[var(--text-secondary)]">
                    <span className="font-semibold text-[var(--text-primary)]">{selectionCount(selectedIds)}</span> selected
                  </span>
                  <span className="flex items-center gap-1.5">
                    <button
                      onClick={handleSelectionCopy}
                      disabled={selectedIds.length === 0}
                      className="btn-secondary text-[11px] px-3 py-1.5 disabled:opacity-40"
                      title="Copy selected messages"
                    >
                      <Copy className="w-3 h-3" aria-hidden="true" />
                      <span className="hidden sm:inline ml-1">Copy</span>
                    </button>
                    <button
                      onClick={() => {
                        const first = selectedIds
                          .map((id) => (activeDMId ? dmConversations[activeDMId] ?? [] : []).find((m) => m.id === id))
                          .find(Boolean);
                        if (first) setForwardTarget(first);
                      }}
                      disabled={selectedIds.length === 0}
                      className="btn-secondary text-[11px] px-3 py-1.5 disabled:opacity-40"
                      title="Forward selected messages"
                    >
                      <Forward className="w-3 h-3" aria-hidden="true" />
                      <span className="hidden sm:inline ml-1">Forward</span>
                    </button>
                    <button
                      onClick={handleSelectionDelete}
                      disabled={selectedIds.length === 0}
                      className="btn-secondary text-[11px] px-3 py-1.5 text-[var(--status-error)] disabled:opacity-40"
                      title="Delete selected messages"
                    >
                      <Trash2 className="w-3 h-3" aria-hidden="true" />
                      <span className="hidden sm:inline ml-1">Delete</span>
                    </button>
                    <button
                      onClick={() => {
                        setSelectedIds([]);
                        setSelectionMode(false);
                      }}
                      className="btn-secondary text-[11px] px-3 py-1.5"
                      title="Exit selection mode"
                    >
                      <X className="w-3 h-3" aria-hidden="true" />
                      <span className="hidden sm:inline ml-1">Cancel</span>
                    </button>
                  </span>
                </div>
              )}

              {activeDMId && (pinnedMessageIds[activeDMId] ?? []).length > 0 && (
                <div className="shrink-0 px-4 sm:px-6 py-2 border-b border-[var(--border-hairline)] flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                  <Pin className="w-3 h-3 text-[var(--text-tertiary)] shrink-0" aria-hidden="true" />
                  <span className="text-[11px] text-[var(--text-secondary)] whitespace-nowrap">
                    {(pinnedMessageIds[activeDMId] ?? []).length} pinned message{(pinnedMessageIds[activeDMId] ?? []).length === 1 ? '' : 's'}
                  </span>
                </div>
              )}

              <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-4 sm:px-6 py-5 space-y-3">
                {activeInvites.length > 0 &&
                  activeInvites.map((invite) => {
                    const status = inviteStatusLabel(invite.id);
                    const isIncoming = invite.direction === 'incoming';
                    return (
                      <div
                        key={invite.id}
                        className={`flex flex-col ${isIncoming ? 'items-start' : 'items-end'}`}
                      >
                        <div
                          className={`max-w-[85%] sm:max-w-[70%] px-4 py-3 rounded-2xl text-[13px] leading-relaxed break-words ${
                            isIncoming
                              ? 'bg-[var(--bg-glass)] text-[var(--text-primary)]'
                              : 'bg-[var(--emphasis)] text-[var(--bg)] font-medium'
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="w-6 h-6 rounded-full bg-[var(--bg)]/20 flex items-center justify-center">
                              <Play className="w-3 h-3" aria-hidden="true" />
                            </span>
                            <span className="font-semibold">
                              {isIncoming ? 'Watch invitation' : 'You invited them to watch'}
                            </span>
                          </div>
                          <p className={isIncoming ? 'text-[var(--text-secondary)]' : 'text-[var(--bg)]/80'}>
                            {isIncoming
                              ? `${invite.sender.name} invited you to "${invite.roomName}".`
                              : `Invitation to "${invite.roomName}" sent — awaiting reply.`}
                          </p>
                          {isIncoming && status === 'pending' && (
                            <div className="flex items-center gap-2 mt-2.5">
                              <button
                                onClick={() => handleAcceptInvite(invite.id)}
                                disabled={Boolean(acceptingInviteId)}
                                className="btn-primary text-xs px-3.5 py-1.5 disabled:opacity-60"
                              >
                                {acceptingInviteId === invite.id ? 'Joining...' : 'Join Now'}
                              </button>
                              <button
                                onClick={() => declineWatchInvite(invite.id)}
                                className="btn-secondary text-xs px-3.5 py-1.5"
                              >
                                Decline
                              </button>
                            </div>
                          )}
                          {isIncoming && status !== 'pending' && (
                            <p className="text-[11px] mt-1.5 opacity-70">
                              {status === 'accepted' ? 'You joined.' : 'Invitation declined.'}
                            </p>
                          )}
                        </div>
                        <span className="text-[10px] text-[var(--text-tertiary)] mt-1 px-1 font-mono">
                          {new Date(invite.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    );
                  })}

                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center px-8">
                    <p className="text-xs text-[var(--text-tertiary)]">
                      Start a conversation with {activeFriend.name}.
                    </p>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isMe = msg.senderId === currentUser?.id;
                    const isSelected = selectedIds.includes(msg.id);
                    const isPinned = isMessagePinned(msg.id);
                    const deleted = Boolean(msg.deletedForEveryone);
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                      >
                        <div
                          role="button"
                          tabIndex={0}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            touchTargetRef.current = { kind: 'message', message: msg };
                            openMessageMenu(msg, e.clientX, e.clientY);
                          }}
                          onTouchStart={(e) => {
                            touchTargetRef.current = { kind: 'message', message: msg };
                            messageLongPress.onTouchStart(e);
                          }}
                          onTouchMove={messageLongPress.onTouchMove}
                          onTouchEnd={messageLongPress.onTouchEnd}
                          onTouchCancel={messageLongPress.onTouchCancel}
                          onClickCapture={messageLongPress.onClickCapture}
                          onClick={() => {
                            if (selectionMode) toggleSelectMessage(msg.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && selectionMode) toggleSelectMessage(msg.id);
                          }}
                          className={`max-w-[85%] sm:max-w-[70%] px-4 py-2.5 rounded-full text-[13px] leading-relaxed break-words transition-shadow ${
                            isSelected ? 'shadow-[0_0_0_2px_var(--emphasis-strong)]' : ''
                          } ${
                            isMe
                              ? 'bg-[var(--emphasis)] text-[var(--bg)] font-medium'
                              : 'bg-[var(--bg-glass)] text-[var(--text-primary)]'
                          }`}
                        >
                          {selectionMode && (
                            <span
                              className={`inline-flex items-center justify-center w-4 h-4 rounded-full border align-middle mr-2 ${
                                isSelected
                                  ? 'bg-[var(--emphasis-strong)] border-[var(--emphasis-strong)] text-[var(--bg)]'
                                  : 'border-[var(--border-strong)]'
                              }`}
                              aria-hidden="true"
                            >
                              {isSelected && <Check className="w-3 h-3" />}
                            </span>
                          )}
                          {msg.replyTo && !msg.replyTo.deleted && (
                            <span className="block text-[11px] leading-snug opacity-80 mb-1 border-s-2 border-[var(--border-strong)] ps-2">
                              <span className="font-semibold">Replied to:</span> {msg.replyTo.text}
                            </span>
                          )}
                          {msg.forwardedFrom && (
                            <span className="block text-[10px] font-semibold tracking-wide uppercase opacity-70 mb-1">
                              Forwarded
                            </span>
                          )}
                          {deleted ? (
                            <span className="italic opacity-70">This message was deleted.</span>
                          ) : (
                            msg.text
                          )}
                          {isPinned && (
                            <Pin className="inline-block w-3 h-3 ml-1.5 text-[var(--text-tertiary)]" aria-hidden="true" />
                          )}
                        </div>
                        <span className="text-[10px] text-[var(--text-tertiary)] mt-1 px-1 font-mono">
                          {msg.timestamp}
                        </span>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Composer — integrated bottom control, thin top separator */}
              {replyTo && (
                <div className="flex items-center gap-2.5 mb-2.5 px-4 py-2.5 rounded-2xl bg-[var(--bg-glass)] border border-[var(--border-hairline)]">
                  <CornerUpLeft className="w-3.5 h-3.5 text-[var(--text-tertiary)] shrink-0" aria-hidden="true" />
                  <span className="flex-1 min-w-0 text-[12px] text-[var(--text-secondary)] truncate">
                    Replying to <span className="font-semibold text-[var(--text-primary)]">{replyTo.senderId === currentUser?.id ? 'yourself' : activeFriend?.name}</span>
                    {replyTo.deletedForEveryone || !replyTo.text ? ' — message deleted' : `: ${replyTo.text}`}
                  </span>
                  <button
                    onClick={() => setReplyTo(null)}
                    className="p-1 rounded-full text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--emphasis-dim)] transition-colors cursor-pointer shrink-0"
                    aria-label="Cancel reply"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <footer className="shrink-0 px-4 sm:px-6 pt-3 pb-4 border-t border-[var(--border-hairline)]">
                <form onSubmit={handleSend} className="flex gap-2.5">
                  <input
                    type="text"
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    placeholder={`Message @${activeFriend.username}...`}
                    className="field flex-1 min-w-0 text-sm py-2.5"
                    aria-label={`Message @${activeFriend.username}`}
                  />
                  <button
                    type="submit"
                    disabled={!messageInput.trim()}
                    className="btn-primary text-xs px-4 sm:px-5 py-2.5 shrink-0 disabled:opacity-40"
                    aria-label="Send message"
                  >
                    <span className="hidden sm:inline">Send</span>
                    <Send className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </form>
              </footer>
            </>
          ) : (
            <div className="flex-1 min-h-0 flex items-center justify-center text-center px-8">
              <div className="max-w-[300px]">
                <div className="breath mb-4 text-[var(--text-tertiary)]">
                  <MessageSquare className="w-8 h-8" strokeWidth={1.25} aria-hidden="true" />
                </div>
                <h3 className="font-display text-[15px] font-semibold text-[var(--text-primary)] mb-1.5 leading-tight">
                  Select a conversation
                </h3>
                <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
                  Choose a friend from the left, or{' '}
                  <button
                    onClick={() => setIsNewChatOpen(true)}
                    className="text-[var(--text-primary)] underline underline-offset-2 decoration-[var(--border-strong)] font-medium cursor-pointer inline"
                  >
                    start a new conversation
                  </button>
                </p>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ─── START NEW CHAT MODAL — floating surface, no stroke ─────────────── */}
      {isNewChatOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-chat-title"
          onClick={() => setIsNewChatOpen(false)}
        >
          <div
            className="w-full max-w-md float-surface p-6 relative text-[var(--text-primary)] pop-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-full bg-[var(--emphasis-dim)] flex items-center justify-center">
                  <Users className="w-4 h-4 text-[var(--text-primary)]" aria-hidden="true" />
                </span>
                <h2 id="new-chat-title" className="font-display text-[15px] font-semibold text-[var(--text-primary)]">
                  New Direct Message
                </h2>
              </div>
              <button
                onClick={() => setIsNewChatOpen(false)}
                className="p-1.5 rounded-full text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-glass)] transition-colors cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {friends.length === 0 ? (
              <div className="py-8 px-4 text-center">
                <UserPlus className="w-8 h-8 text-[var(--text-tertiary)] mx-auto mb-3" strokeWidth={1.5} aria-hidden="true" />
                <h3 className="font-display text-sm font-semibold text-[var(--text-primary)] mb-1.5">
                  No friends on your squad yet
                </h3>
                <p className="text-xs text-[var(--text-secondary)] max-w-[260px] mx-auto mb-5 leading-relaxed">
                  Add friends from the Friends tab to start chatting with them.
                </p>
                <button
                  onClick={() => {
                    setIsNewChatOpen(false);
                    setActiveTab('friends');
                  }}
                  className="btn-primary text-xs px-4 py-2"
                >
                  Go to Friends
                </button>
              </div>
            ) : (
              <>
                <div className="mb-3 relative">
                  <input
                    ref={modalInputRef}
                    type="text"
                    value={newChatSearchQuery}
                    onChange={(e) => setNewChatSearchQuery(e.target.value)}
                    placeholder="Search friends by name or username..."
                    className="field w-full pl-11 pr-4 text-[13px] py-2.5"
                    aria-label="Search friends"
                  />
                  <Search
                    className="w-3.5 h-3.5 text-[var(--text-tertiary)] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                </div>

                <div className="max-h-60 overflow-y-auto no-scrollbar">
                  {filteredNewChatFriends.length > 0 ? (
                    filteredNewChatFriends.map((friend) => (
                      <button
                        key={friend.id}
                        onClick={() => handleSelectFriendForChat(friend)}
                        className="w-full py-2.5 px-2 flex items-center justify-between gap-3 text-left hover:bg-[var(--bg-glass)] transition-colors cursor-pointer rounded-full group"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="relative shrink-0">
                            <UserAvatar
                              avatar={friend.avatar}
                              name={friend.name}
                              className="w-8 h-8 font-bold text-xs"
                            />
                            <span
                              className={`absolute bottom-0 right-0 w-2 h-2 rounded-full ring-2 ring-[var(--bg-elevated)] ${
                                friend.status === 'online'
                                  ? 'bg-[var(--text-primary)] shadow-[0_0_6px_var(--emphasis-glow)]'
                                  : 'bg-[var(--text-tertiary)]'
                              }`}
                            />
                          </div>

                          <div className="min-w-0">
                            <div className="font-display text-xs font-semibold text-[var(--text-primary)] truncate">
                              {friend.name}
                            </div>
                            <div className="text-[10px] text-[var(--text-tertiary)] font-mono truncate">
                              @{friend.username}
                            </div>
                          </div>
                        </div>

                        <span className="text-[11px] text-[var(--text-primary)] font-semibold opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          Chat →
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="py-8 text-center text-xs text-[var(--text-tertiary)]">
                      No friends matching &ldquo;{newChatSearchQuery}&rdquo;
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {forwardTarget && (
        <ForwardModal
          open
          friends={friends}
          onForward={(friendId) => {
            void sendForward(forwardTarget.id, friendId);
            setForwardTarget(null);
          }}
          onClose={() => setForwardTarget(null)}
        />
      )}

      {infoTarget && <MessageInfoModal open message={infoTarget} onClose={() => setInfoTarget(null)} />}

      <StarredMessagesModal
        open={starredOpen}
        onClose={() => setStarredOpen(false)}
      />

      <ListsModal
        open={listsOpen}
        onClose={() => setListsOpen(false)}
      />

      <LockDialog
        open={Boolean(lockDialog)}
        mode={lockDialog?.mode ?? 'verify'}
        error={lockError}
        busy={lockBusy}
        onSubmit={handleLockSubmit}
        onClose={() => setLockDialog(null)}
      />

      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={confirmCopy.title}
        message={confirmCopy.message}
        confirmLabel={confirmCopy.label}
        danger
        busy={confirmBusy}
        onConfirm={handleConfirm}
        onClose={() => setConfirmAction(null)}
      />

      {messageMenu && (
        <ContextMenu
          x={messageMenu.x}
          y={messageMenu.y}
          items={messageMenuItems}
          onClose={() => setMessageMenu(null)}
          onSelect={(item) => {
            handleMessageMenuSelect(item);
            setMessageMenu(null);
          }}
        />
      )}

      {conversationMenu && (
        <ContextMenu
          x={conversationMenu.x}
          y={conversationMenu.y}
          items={conversationMenuItems}
          onClose={() => setConversationMenu(null)}
          onSelect={(item) => {
            handleConversationMenuSelect(item);
            setConversationMenu(null);
          }}
        />
      )}
    </div>
  );
};
