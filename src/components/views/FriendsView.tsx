import React, { useEffect, useState } from 'react';
import { Link as LinkIcon, Check, Users, Search, UserPlus } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { UserAvatar } from '../common/UserAvatar';
import { EmptyState } from '../common/EmptyState';
import { SlidingTabs } from '../common/SlidingTabs';

const TABS = ['Online', 'Offline', 'Requests', 'Suggestions'] as const;

export const FriendsView: React.FC = () => {
  const {
    friends,
    setActiveTab,
    setActiveDMId,
    addFriend,
    acceptFriendRequest,
    joinRoom
  } = useApp();

  const [activeTabSection, setActiveTabSection] = useState<string>('Online');
  const [searchQuery, setSearchQuery] = useState('');
  const [addInput, setAddInput] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  const [contentTab, setContentTab] = useState<string>(activeTabSection);
  const [contentFading, setContentFading] = useState(false);

  useEffect(() => {
    if (activeTabSection === contentTab) return;
    setContentFading(true);
    const t = setTimeout(() => {
      setContentTab(activeTabSection);
      setContentFading(false);
    }, 150);
    return () => clearTimeout(t);
  }, [activeTabSection, contentTab]);

  const handleCopyInviteLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/invite/praconnect`);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const matchesTab = (f: (typeof friends)[number], tab: string) => {
    if (tab === 'Online') return f.status === 'online' && !f.requestPending && !f.isSuggestion;
    if (tab === 'Offline') return f.status === 'offline' && !f.requestPending && !f.isSuggestion;
    if (tab === 'Requests') return Boolean(f.requestPending);
    if (tab === 'Suggestions') return Boolean(f.isSuggestion);
    return true;
  };

  const countFor = (tab: string) => friends.filter((f) => matchesTab(f, tab)).length;

  const filteredFriends = friends.filter((f) => {
    const matchesSearch =
      searchQuery === '' ||
      f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.username.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch && matchesTab(f, contentTab);
  });

  const emptyTitle =
    contentTab === 'Online'
      ? "No one's around yet."
      : contentTab === 'Requests'
      ? 'No pending friend requests.'
      : contentTab === 'Suggestions'
      ? 'No suggestions right now.'
      : 'No offline friends.';

  return (
    <div className="w-full text-[var(--text-primary)] font-['Inter',sans-serif] select-none">
      {/* ─── PAGE HEADER ──────────────────────────────────────────────────────── */}
      <header
        className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8"
        style={{ animation: 'rise 640ms var(--ease) both' }}
      >
        <div className="max-w-[620px]">
          <h1
            className="font-display font-bold tracking-[-0.02em] text-[clamp(2rem,3.4vw,2.7rem)] leading-[1.1] mb-3"
            style={{ animation: 'rise 640ms var(--ease) 80ms both' }}
          >
            Friends Directory
          </h1>
          <p
            className="text-[15px] leading-relaxed text-[var(--text-secondary)] max-w-[520px]"
            style={{ animation: 'rise 640ms var(--ease) 150ms both' }}
          >
            Connect with squad members and jump into live watch parties.
          </p>
        </div>

        <button
          onClick={handleCopyInviteLink}
          className="btn-secondary text-sm shrink-0"
          style={{ animation: 'rise 640ms var(--ease) 220ms both' }}
        >
          {copiedLink ? (
            <>
              <Check className="w-4 h-4 text-[var(--text-primary)]" aria-hidden="true" />
              <span className="text-[var(--text-primary)]">Link Copied!</span>
            </>
          ) : (
            <>
              <LinkIcon className="w-4 h-4" aria-hidden="true" />
              <span>Copy Invite Link</span>
            </>
          )}
        </button>
      </header>

      {/* ─── SEARCH + ADD CONTROLS ──────────────────────────────────────────── */}
      <div
        className="flex flex-col sm:flex-row gap-3 mb-8"
        style={{ animation: 'rise 640ms var(--ease) 220ms both' }}
      >
        <div className="relative flex-1 max-w-[420px]">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search friends by name or handle..."
            className="field w-full pl-12 pr-4"
            aria-label="Search friends"
          />
          <Search
            className="w-4 h-4 text-[var(--text-tertiary)] absolute left-[18px] top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (addInput.trim()) {
              addFriend(addInput.trim());
              setAddInput('');
            }
          }}
          className="flex gap-2.5 shrink-0"
        >
          <input
            type="text"
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            placeholder="Add @handle..."
            className="field w-40 sm:w-48"
            aria-label="Friend handle to add"
          />
          <button
            type="submit"
            disabled={!addInput.trim()}
            className="btn-primary text-sm px-5"
          >
            <UserPlus className="w-4 h-4" aria-hidden="true" />
            <span>Add</span>
          </button>
        </form>
      </div>

      {/* ─── SLIDING-UNDERLINE TABS ─────────────────────────────────────────── */}
      <div
        className="border-b border-[var(--border-hairline)] mb-2"
        style={{ animation: 'rise 640ms var(--ease) 300ms both' }}
      >
        <SlidingTabs
          items={TABS.map((t) => ({ id: t, label: t, count: countFor(t) }))}
          activeId={activeTabSection}
          onChange={setActiveTabSection}
        />
      </div>

      {/* ─── FRIENDS LIST ───────────────────────────────────────────────────── */}
      <div
        className="w-full"
        style={{
          opacity: contentFading ? 0 : 1,
          transition: 'opacity 150ms var(--ease)',
        }}
      >
        {filteredFriends.length > 0 ? (
          <div className="w-full" style={{ animation: 'rise 640ms var(--ease) 350ms both' }}>
            {filteredFriends.map((friend, i) => (
            <div
              key={friend.id}
              className={`flex items-center justify-between gap-4 py-4 group ${
                i > 0 ? 'border-t border-[var(--border-hairline)]' : ''
              }`}
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="relative shrink-0">
                  <UserAvatar
                    avatar={friend.avatar}
                    name={friend.name}
                    className="w-10 h-10 font-bold text-sm"
                  />
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-[var(--bg)] ${
                      friend.status === 'online'
                        ? 'bg-[var(--text-primary)] live-dot shadow-[0_0_6px_var(--emphasis-glow)]'
                        : 'bg-[var(--text-tertiary)]'
                    }`}
                  />
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="font-display text-[15px] font-semibold text-[var(--text-primary)] truncate">
                      {friend.name}
                    </span>
                    <span className="text-xs text-[var(--text-tertiary)] font-mono">
                      @{friend.username}
                    </span>
                  </div>

                  <div className="text-xs text-[var(--text-secondary)] mt-0.5 truncate">
                    {friend.currentRoomName ? (
                      <span className="text-[var(--text-primary)] font-medium">In {friend.currentRoomName}</span>
                    ) : (
                      <span>{friend.status === 'online' ? 'Online' : 'Offline'}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Action Controls */}
              <div className="flex items-center gap-2 shrink-0">
                {contentTab === 'Requests' ? (
                  <button
                    onClick={() => acceptFriendRequest(friend.id)}
                    className="btn-primary text-xs px-4 py-2"
                  >
                    Accept
                  </button>
                ) : contentTab === 'Suggestions' ? (
                  <button
                    onClick={() => addFriend(friend.name)}
                    className="btn-primary text-xs px-4 py-2"
                  >
                    Add Friend
                  </button>
                ) : (
                  <>
                    {friend.currentRoomCode && (
                      <button
                        onClick={() => joinRoom(friend.currentRoomCode!)}
                        className="btn-secondary text-xs px-3.5 py-2"
                      >
                        Join Room
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setActiveDMId(friend.id);
                        setActiveTab('messages');
                      }}
                      className="btn-secondary text-xs px-3.5 py-2"
                    >
                      Message
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
          </div>
        ) : (
          /* CENTERED EMPTY STATE */
          <EmptyState
            icon={Users}
            title={searchQuery ? `No friends found for "${searchQuery}"` : emptyTitle}
            description={
              searchQuery
                ? 'Try a different name or clear the search.'
                : 'Share your invite link to build your circle.'
            }
            action={
              searchQuery ? (
                <button
                  onClick={() => setSearchQuery('')}
                  className="btn-secondary text-sm"
                >
                  Clear search
                </button>
              ) : (
                <button
                  onClick={handleCopyInviteLink}
                  className="btn-primary text-sm"
                >
                  {copiedLink ? (
                    <>
                      <Check className="w-4 h-4" aria-hidden="true" />
                      Link Copied!
                    </>
                  ) : (
                    <>
                      <LinkIcon className="w-4 h-4" aria-hidden="true" />
                      Copy Invite Link
                    </>
                  )}
                </button>
              )
            }
          />
        )}
      </div>
    </div>
  );
};