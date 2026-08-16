import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Search,
  Plus,
  X,
  ArrowLeft,
  Users,
  Send,
  UserPlus
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { UserAvatar } from '../common/UserAvatar';
import { Friend } from '../../types';

export const MessagesView: React.FC = () => {
  const {
    friends,
    activeDMId,
    setActiveDMId,
    dmConversations,
    sendDirectMessage,
    setActiveTab
  } = useApp();

  const [messageInput, setMessageInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [newChatSearchQuery, setNewChatSearchQuery] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const modalInputRef = useRef<HTMLInputElement>(null);

  const activeFriend = activeDMId ? friends.find((f) => f.id === activeDMId) || null : null;
  const messages = activeFriend ? dmConversations[activeFriend.id] || [] : [];

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
    if (activeFriend && messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeFriend, messages.length]);

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

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || !activeFriend) return;
    sendDirectMessage(activeFriend.id, messageInput.trim());
    setMessageInput('');
  };

  const handleSelectFriendForChat = (friend: Friend) => {
    setActiveDMId(friend.id);
    setIsNewChatOpen(false);
    setNewChatSearchQuery('');
  };

  const hasNoConversations = friends.length === 0;
  const hasSearchQuery = searchQuery.trim().length > 0;
  const isSearchEmpty = !hasNoConversations && hasSearchQuery && filteredFriends.length === 0;

  return (
    <div className="w-full text-[var(--text-primary)] font-['Inter',sans-serif] select-none h-[calc(100vh-104px)] min-h-[560px] flex flex-col">
      {/* ─── PAGE HEADER ──────────────────────────────────────────────────────── */}
      <header
        className="mb-6 shrink-0 flex items-end justify-between"
        style={{ animation: 'rise 640ms var(--ease) both' }}
      >
        <div>
          <h1
            className="font-display font-bold tracking-[-0.02em] text-[clamp(2rem,3.4vw,2.7rem)] leading-[1.1] mb-2"
            style={{ animation: 'rise 640ms var(--ease) 80ms both' }}
          >
            Direct Messages
          </h1>
          <p
            className="text-[15px] text-[var(--text-secondary)] max-w-[520px]"
            style={{ animation: 'rise 640ms var(--ease) 150ms both' }}
          >
            Chat directly with your friends and squad members.
          </p>
        </div>

        {!hasNoConversations && (
          <button
            onClick={() => setIsNewChatOpen(true)}
            className="btn-secondary text-sm shrink-0 hidden sm:inline-flex"
            style={{ animation: 'rise 640ms var(--ease) 220ms both' }}
            title="Start new conversation"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>New Chat</span>
          </button>
        )}
      </header>

      {/* ─── TWO-PANE LAYOUT — hairline as the only separator ───────────────── */}
      <div
        className="flex-1 flex overflow-hidden min-h-0 border-t border-[var(--border-hairline)]"
        style={{ animation: 'rise 640ms var(--ease) 220ms both' }}
      >
        {/* ─── LEFT PANE: Conversation List ──────────────────────────────────── */}
        <div
          className={`w-full md:w-72 lg:w-80 border-r border-[var(--border-hairline)] flex flex-col shrink-0 pr-0 md:pr-5 py-5 min-h-0 ${
            activeFriend ? 'hidden md:flex' : 'flex'
          }`}
        >
          {!hasNoConversations && (
            <div className="mb-4 relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search conversations..."
                className="field w-full pl-11 pr-9 text-[13px] py-2.5"
                aria-label="Search conversations"
              />
              <Search
                className="w-3.5 h-3.5 text-[var(--text-tertiary)] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              {hasSearchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors rounded-full cursor-pointer"
                  aria-label="Clear search query"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto no-scrollbar min-h-0 flex flex-col">
            {hasNoConversations ? (
              /* Empty state centered within the left pane's bounds */
              <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
                <div className="breath mb-4 text-[var(--text-tertiary)]">
                  <MessageSquare className="w-8 h-8" strokeWidth={1.5} aria-hidden="true" />
                </div>
                <h3 className="font-display text-[15px] font-semibold text-[var(--text-primary)] mb-1.5">
                  No conversations yet
                </h3>
                <p className="text-xs text-[var(--text-secondary)] mb-5 leading-relaxed max-w-[220px]">
                  Start chatting with your friends and squad members
                </p>
                <button
                  onClick={() => setIsNewChatOpen(true)}
                  className="btn-primary text-xs px-4 py-2"
                >
                  Start New Chat
                </button>
              </div>
            ) : isSearchEmpty ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
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
              <div className="flex flex-col">
                {filteredFriends.map((friend, i) => {
                  const isSelected = friend.id === activeFriend?.id;
                  const friendMsgs = dmConversations[friend.id] || [];
                  const lastMsg = friendMsgs[friendMsgs.length - 1];
                  const hasUnread = typeof friend.unreadCount === 'number' && friend.unreadCount > 0;

                  return (
                    <button
                      key={friend.id}
                      onClick={() => setActiveDMId(friend.id)}
                      className={`w-full py-3 px-3 flex items-center gap-3 text-left transition-colors cursor-pointer rounded-full ${
                        i > 0 ? '' : ''
                      } ${isSelected ? 'bg-[var(--emphasis-dim)]' : 'hover:bg-[var(--bg-glass)]'}`}
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
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-display text-xs font-semibold text-[var(--text-primary)] truncate">
                            {friend.name}
                          </span>
                          {lastMsg && (
                            <span className="text-[10px] text-[var(--text-tertiary)] font-mono shrink-0">
                              {lastMsg.timestamp}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <p className="text-[11px] text-[var(--text-secondary)] truncate">
                            {lastMsg ? lastMsg.text : `Start chatting with @${friend.username}`}
                          </p>
                          {hasUnread && (
                            <span className="min-w-[16px] h-4 px-1 text-[9px] font-mono font-bold bg-[var(--emphasis)] text-[var(--bg)] rounded-full flex items-center justify-center shrink-0 shadow-[0_0_8px_var(--emphasis-glow)]">
                              {friend.unreadCount}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ─── RIGHT PANE: Active Conversation OR Prompt ─────────────────────── */}
        <div className={`flex-1 flex flex-col min-w-0 min-h-0 ${activeFriend ? 'flex md:pl-6 py-5' : 'hidden md:flex md:pl-6 py-5'}`}>
          {activeFriend ? (
            <div className="flex-1 flex flex-col min-w-0 min-h-0">
              {/* Active Friend Top Bar */}
              <div className="pb-3 border-b border-[var(--border-hairline)] flex items-center justify-between shrink-0 mb-4">
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
              </div>

              {/* Message Stream */}
              <div className="flex-1 overflow-y-auto space-y-3 pr-2 py-2 no-scrollbar min-h-0">
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center px-8">
                    <p className="text-xs text-[var(--text-tertiary)]">
                      Start a conversation with {activeFriend.name}.
                    </p>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isMe = msg.senderId === 'user';
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                      >
                        <div
                          className={`max-w-[85%] sm:max-w-[70%] px-4 py-2.5 rounded-full text-[13px] leading-relaxed break-words ${
                            isMe
                              ? 'bg-[var(--emphasis)] text-[var(--bg)] font-medium shadow-[0_4px_16px_rgba(255,255,255,0.2)]'
                              : 'bg-[var(--bg-glass)] text-[var(--text-primary)]'
                          }`}
                        >
                          {msg.text}
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

              {/* Message Input */}
              <form onSubmit={handleSend} className="pt-3 border-t border-[var(--border-hairline)] flex gap-2.5 shrink-0 mt-3">
                <input
                  type="text"
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  placeholder={`Message @${activeFriend.username}...`}
                  className="field flex-1 text-[13px] py-2.5"
                  aria-label={`Message @${activeFriend.username}`}
                />
                <button
                  type="submit"
                  disabled={!messageInput.trim()}
                  className="btn-primary text-xs px-4 sm:px-5 py-2.5 disabled:opacity-40"
                  aria-label="Send message"
                >
                  <span className="hidden sm:inline">Send</span>
                  <Send className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </form>
            </div>
          ) : (
            /* RIGHT PANE PROMPT — centered */
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
              <div className="breath mb-5 text-[var(--text-tertiary)]">
                <MessageSquare className="w-10 h-10" strokeWidth={1.25} aria-hidden="true" />
              </div>
              <h3 className="font-display text-[17px] font-semibold text-[var(--text-primary)] mb-2 leading-tight">
                Select a conversation
              </h3>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed max-w-[280px]">
                Choose a friend from the left, or{' '}
                <button
                  onClick={() => setIsNewChatOpen(true)}
                  className="text-[var(--text-primary)] underline underline-offset-2 decoration-[var(--border-strong)] font-medium cursor-pointer inline"
                >
                  start a new conversation
                </button>
              </p>
            </div>
          )}
        </div>
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
            {/* Modal Header */}
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
    </div>
  );
};