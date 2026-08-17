import React, { useEffect, useRef, useState } from 'react';
import { Link as LinkIcon, Check, Users, Search, UserPlus, UserCheck, Loader } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { UserAvatar } from '../common/UserAvatar';
import { EmptyState } from '../common/EmptyState';
import { SlidingTabs } from '../common/SlidingTabs';
import { SocialUser } from '../../api/social';
import {
  directoryRelationship,
  relationshipActions,
  relationshipLabel,
  directoryEmptyCopy,
} from '../../social/directory';

const TABS = ['Online', 'Offline', 'Requests', 'Find Friends'] as const;

export const FriendsView: React.FC = () => {
  const {
    friends,
    friendRequests,
    startDm,
    addFriend,
    acceptFriendRequest,
    rejectFriendRequest,
    joinRoom,
    searchResults,
    searchTotal,
    searchNextOffset,
    searchUsers,
    sendFriendRequestToUser
  } = useApp();

  const [activeTabSection, setActiveTabSection] = useState<string>('Online');
  const [searchQuery, setSearchQuery] = useState('');
  const [addInput, setAddInput] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  const [contentTab, setContentTab] = useState<string>(activeTabSection);
  const [contentFading, setContentFading] = useState(false);

  const [directoryQuery, setDirectoryQuery] = useState('');
  const [directorySearching, setDirectorySearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pendingAdds, setPendingAdds] = useState<Record<string, boolean>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const incomingRequests = friendRequests.incoming;
  const outgoingRequests = friendRequests.outgoing;

  useEffect(() => {
    if (activeTabSection === contentTab) return;
    setContentFading(true);
    const t = setTimeout(() => {
      setContentTab(activeTabSection);
      setContentFading(false);
    }, 150);
    return () => clearTimeout(t);
  }, [activeTabSection, contentTab]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!directoryQuery.trim()) {
      // Empty query still searches: the server treats q="" as "first page of
      // the whole directory", so Find Friends shows people immediately.
      setDirectorySearching(true);
      debounceRef.current = setTimeout(() => {
        searchUsers('', 0).finally(() => setDirectorySearching(false));
      }, 0);
      return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
    }
    setDirectorySearching(true);
    debounceRef.current = setTimeout(() => {
      searchUsers(directoryQuery, 0).finally(() => setDirectorySearching(false));
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [directoryQuery, searchUsers]);

  const handleCopyInviteLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/invite/praconnect`);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const matchesTab = (f: (typeof friends)[number], tab: string) => {
    if (tab === 'Online') return f.status === 'online';
    if (tab === 'Offline') return f.status === 'offline';
    return true;
  };

  const countFor = (tab: string) => {
    if (tab === 'Requests') return incomingRequests.length;
    if (tab === 'Online' || tab === 'Offline') return friends.filter((f) => matchesTab(f, tab)).length;
    return 0;
  };

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
      : contentTab === 'Find Friends'
      ? 'Find people to watch with.'
      : 'No offline friends.';

  // ─── Find Friends: relationship-aware button state ───────────────────────
  const incomingFrom = (userId: string) => incomingRequests.find((r) => r.user.id === userId);
  const outgoingTo = (userId: string) => outgoingRequests.find((r) => r.user.id === userId);

  const handleDirectoryAdd = async (user: SocialUser) => {
    if (pendingAdds[user.id]) return;
    setPendingAdds((prev) => ({ ...prev, [user.id]: true }));
    await sendFriendRequestToUser(user.id);
    setPendingAdds((prev) => ({ ...prev, [user.id]: false }));
  };

  const handleLoadMore = async () => {
    setLoadingMore(true);
    await searchUsers(directoryQuery, searchNextOffset);
    setLoadingMore(false);
  };

  const renderFriendActions = (friend: (typeof friends)[number]) => (
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
        onClick={() => startDm(friend.id)}
        className="btn-secondary text-xs px-3.5 py-2"
      >
        Message
      </button>
    </>
  );

  const renderDirectoryRow = (user: SocialUser) => {
    const relationship = directoryRelationship(user.id, friends, incomingRequests, outgoingRequests);
    const actions = relationshipActions(relationship);
    const incoming = relationship === 'incoming_pending' ? incomingFrom(user.id) : undefined;
    const outgoing = relationship === 'outgoing_pending' ? outgoingTo(user.id) : undefined;
    const busy = Boolean(pendingAdds[user.id]);

    console.log('[FRIENDS UX]', {
      userId: user.id,
      username: user.username,
      relationshipStatus: relationship,
      showMessage: actions.showMessage,
      showAccept: actions.showAccept,
      showRequested: actions.showRequested,
      showAddFriend: actions.showAddFriend,
    });

    return (
      <div
        key={user.id}
        className="flex items-center justify-between gap-4 py-4 group border-t border-[var(--border-hairline)] first:border-t-0"
      >
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="relative shrink-0">
            <UserAvatar
              avatar={user.avatarUrl || user.name.charAt(0).toUpperCase()}
              name={user.name}
              className="w-10 h-10 font-bold text-sm"
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="font-display text-[15px] font-semibold text-[var(--text-primary)] truncate">
                {user.name}
              </span>
              <span className="text-xs text-[var(--text-tertiary)] font-mono">@{user.username}</span>
            </div>
            <div className="text-xs text-[var(--text-secondary)] mt-0.5 truncate">
              {relationshipLabel(relationship)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {actions.showMessage ? (
            <>
              <span className="btn-secondary text-xs px-4 py-2 opacity-60 cursor-default">
                <UserCheck className="w-3.5 h-3.5" aria-hidden="true" />
                Friends
              </span>
              <button
                onClick={() => startDm(user.id)}
                className="btn-secondary text-xs px-4 py-2"
              >
                Message
              </button>
            </>
          ) : actions.showAccept && incoming ? (
            <button
              onClick={() => acceptFriendRequest(incoming!.id)}
              className="btn-primary text-xs px-4 py-2"
            >
              Accept
            </button>
          ) : actions.showRequested && outgoing ? (
            <span className="btn-secondary text-xs px-4 py-2 opacity-60 cursor-default">
              Requested
            </span>
          ) : actions.showAddFriend ? (
            <button
              onClick={() => handleDirectoryAdd(user)}
              disabled={busy}
              className="btn-primary text-xs px-4 py-2 disabled:opacity-60"
            >
              {busy ? (
                <Loader className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              Add Friend
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  const renderRequests = () => (
    <div className="w-full" style={{ animation: 'rise 640ms var(--ease) 350ms both' }}>
      {incomingRequests.length > 0 && (
        <>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-1 pt-2">
            Incoming
          </h3>
          {incomingRequests.map((req) => (
            <div
              key={req.id}
              className="flex items-center justify-between gap-4 py-4 group border-b border-[var(--border-hairline)]"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <UserAvatar
                  avatar={req.user.avatarUrl || req.user.name.charAt(0).toUpperCase()}
                  name={req.user.name}
                  className="w-10 h-10 font-bold text-sm"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="font-display text-[15px] font-semibold text-[var(--text-primary)] truncate">
                      {req.user.name}
                    </span>
                    <span className="text-xs text-[var(--text-tertiary)] font-mono">@{req.user.username}</span>
                  </div>
                  <div className="text-xs text-[var(--text-secondary)] mt-0.5">Sent you a friend request</div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => rejectFriendRequest(req.id)}
                  className="btn-secondary text-xs px-4 py-2"
                >
                  Decline
                </button>
                <button
                  onClick={() => acceptFriendRequest(req.id)}
                  className="btn-primary text-xs px-4 py-2"
                >
                  Accept
                </button>
              </div>
            </div>
          ))}
        </>
      )}
      {outgoingRequests.length > 0 && (
        <>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-1 pt-4">
            Outgoing
          </h3>
          {outgoingRequests.map((req) => (
            <div
              key={req.id}
              className="flex items-center justify-between gap-4 py-4 group border-b border-[var(--border-hairline)]"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <UserAvatar
                  avatar={req.user.avatarUrl || req.user.name.charAt(0).toUpperCase()}
                  name={req.user.name}
                  className="w-10 h-10 font-bold text-sm"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="font-display text-[15px] font-semibold text-[var(--text-primary)] truncate">
                      {req.user.name}
                    </span>
                    <span className="text-xs text-[var(--text-tertiary)] font-mono">@{req.user.username}</span>
                  </div>
                  <div className="text-xs text-[var(--text-secondary)] mt-0.5">Request sent — awaiting response</div>
                </div>
              </div>
              <span className="text-xs text-[var(--text-tertiary)] shrink-0">Requested</span>
            </div>
          ))}
        </>
      )}
    </div>
  );

  const renderDirectory = () => (
    <div className="w-full" style={{ animation: 'rise 640ms var(--ease) 350ms both' }}>
      {searchResults.length > 0 ? (
        <>
          {searchResults.map(renderDirectoryRow)}
          {searchNextOffset < searchTotal && (
            <div className="pt-4 flex justify-center">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="btn-secondary text-xs px-5 py-2 disabled:opacity-60"
              >
                {loadingMore ? 'Loading...' : `Load more (${searchTotal - searchNextOffset} left)`}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="py-10 text-center">
          {directorySearching ? (
            <div className="flex items-center justify-center gap-2 text-xs text-[var(--text-tertiary)]">
              <Loader className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              Searching the directory...
            </div>
          ) : (
            <EmptyState
              icon={Users}
              title={directoryEmptyCopy(directoryQuery, false) ?? 'Find people to watch with'}
              description={
                directoryQuery
                  ? 'Try a different name or @username.'
                  : 'Invite friends to PraConnect or check back later.'
              }
              action={
                directoryQuery ? (
                  <button onClick={() => setDirectoryQuery('')} className="btn-secondary text-sm">
                    Clear search
                  </button>
                ) : (
                  <button onClick={handleCopyInviteLink} className="btn-primary text-sm">
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
      )}
    </div>
  );

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
            Connect with your circle, send friend requests, and jump into live watch parties.
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

      {/* ─── CONTENT ────────────────────────────────────────────────────────── */}
      <div
        className="w-full"
        style={{
          opacity: contentFading ? 0 : 1,
          transition: 'opacity 150ms var(--ease)',
        }}
      >
        {contentTab === 'Requests' ? (
          incomingRequests.length > 0 || outgoingRequests.length > 0 ? (
            renderRequests()
          ) : (
            <EmptyState
              icon={Users}
              title="No pending friend requests."
              description="Requests from other users will appear here."
            />
          )
        ) : contentTab === 'Find Friends' ? (
          <div className="pt-2 mb-5 relative max-w-[420px]">
            <input
              type="text"
              value={directoryQuery}
              onChange={(e) => setDirectoryQuery(e.target.value)}
              placeholder="Search the directory: name or @username..."
              className="field w-full pl-12 pr-4"
              aria-label="Search people directory"
              autoFocus
            />
            <Search
              className="w-4 h-4 text-[var(--text-tertiary)] absolute left-[18px] top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
          </div>
        ) : null}

        {contentTab === 'Requests' ? null : contentTab === 'Find Friends' ? (
          renderDirectory()
        ) : filteredFriends.length > 0 ? (
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

                <div className="flex items-center gap-2 shrink-0">{renderFriendActions(friend)}</div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Users}
            title={searchQuery ? `No friends found for "${searchQuery}"` : emptyTitle}
            description={
              searchQuery
                ? 'Try a different name or clear the search.'
                : 'Use Find Friends to build your circle.'
            }
            action={
              searchQuery ? (
                <button onClick={() => setSearchQuery('')} className="btn-secondary text-sm">
                  Clear search
                </button>
              ) : undefined
            }
          />
        )}
      </div>
    </div>
  );
};
