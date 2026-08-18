import React, { useEffect, useRef, useState } from 'react';
import { Users, Search, UserPlus, Loader, Bell } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { UserAvatar } from '../common/UserAvatar';
import { EmptyState } from '../common/EmptyState';
import { SlidingTabs } from '../common/SlidingTabs';
import { SocialUser } from '../../api/social';
import {
  directoryRelationship,
  relationshipActions,
  directoryEmptyCopy,
  FRIENDS_TABS,
  FriendsTab,
  directorySearchRequest,
} from '../../social/directory';

interface FriendsViewProps {
  initialTab?: FriendsTab;
}

export const FriendsView: React.FC<FriendsViewProps> = ({ initialTab = 'friends' }) => {
  const {
    friends,
    friendRequests,
    startDm,
    acceptFriendRequest,
    rejectFriendRequest,
    searchResults,
    searchTotal,
    searchNextOffset,
    searchUsers,
    sendFriendRequestToUser,
    currentUser,
  } = useApp();

  const [activeTab, setActiveTab] = useState<FriendsTab>(initialTab);
  const [directoryQuery, setDirectoryQuery] = useState('');
  const [directorySearching, setDirectorySearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pendingAdds, setPendingAdds] = useState<Record<string, boolean>>({});
  const [requestsOpen, setRequestsOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const incomingRequests = friendRequests.incoming;
  const outgoingRequests = friendRequests.outgoing;
  const pendingRequestCount = incomingRequests.length;

  // The server excludes the current user, but we keep a defensive filter so a
  // directory row can never resolve to the signed-in account.
  const directoryUsers = searchResults.filter((u) => u.id !== currentUser?.id);

  // Find Friends is the ONLY search surface. An empty query loads page 1 of
  // every registered user (server treats q="" as the whole directory); typed
  // queries debounce and reset to page 1. The Friends tab never searches.
  useEffect(() => {
    if (activeTab !== 'find-friends') return;
    const plan = directorySearchRequest(activeTab, directoryQuery);
    if (!plan) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setDirectorySearching(true);
    debounceRef.current = setTimeout(() => {
      searchUsers(plan.query, plan.offset).finally(() => setDirectorySearching(false));
    }, plan.delayMs);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [activeTab, directoryQuery, searchUsers]);

  const incomingFrom = (userId: string) => incomingRequests.find((r) => r.user.id === userId);
  const outgoingTo = (userId: string) => outgoingRequests.find((r) => r.user.id === userId);

  const renderDirectoryRow = (user: SocialUser) => {
    const relationship = directoryRelationship(user.id, friends, incomingRequests, outgoingRequests);
    const actions = relationshipActions(relationship);
    const incoming = relationship === 'incoming_pending' ? incomingFrom(user.id) : undefined;
    const outgoing = relationship === 'outgoing_pending' ? outgoingTo(user.id) : undefined;
    const busy = Boolean(pendingAdds[user.id]);

    return (
      <div
        key={user.id}
        className="flex items-center justify-between gap-4 py-4 group border-t border-[var(--border-hairline)] first:border-t-0"
      >
        <div className="flex items-center gap-3.5 min-w-0">
          <UserAvatar
            avatar={user.avatarUrl || user.name.charAt(0).toUpperCase()}
            name={user.name}
            className="w-10 h-10 font-bold text-sm"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="font-display text-[15px] font-semibold text-[var(--text-primary)] truncate">
                {user.name}
              </span>
              <span className="text-xs text-[var(--text-tertiary)] font-mono">@{user.username}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {actions.showMessage ? (
            <>
              <span className="btn-secondary text-xs px-3.5 py-2 opacity-60 cursor-default">
                Friends
              </span>
              <button
                onClick={() => startDm(user.id)}
                className="btn-secondary text-xs px-3.5 py-2"
              >
                Message
              </button>
            </>
          ) : actions.showAccept && incoming ? (
            <button
              onClick={() => acceptFriendRequest(incoming.id)}
              className="btn-primary text-xs px-4 py-2"
            >
              Accept
            </button>
          ) : actions.showRequested && outgoing ? (
            <span className="btn-secondary text-xs px-3.5 py-2 opacity-60 cursor-default">
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

  return (
    <div className="w-full text-[var(--text-primary)] font-['Inter',sans-serif] select-none">
      {/* ─── HEADER — title + small pending-requests bell (never a tab) ─────── */}
      <header
        className="flex items-center justify-between gap-4 mb-6"
        style={{ animation: 'rise 640ms var(--ease) both' }}
      >
        <h1
          className="font-display font-bold tracking-[-0.02em] text-[clamp(1.75rem,2.8vw,2.4rem)] leading-[1.1]"
          style={{ animation: 'rise 640ms var(--ease) 80ms both' }}
        >
          Friends
        </h1>

        <div className="relative shrink-0">
          <button
            onClick={() => setRequestsOpen((o) => !o)}
            className="relative p-2 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-glass)] transition-colors cursor-pointer"
            aria-label={`Friend requests${pendingRequestCount > 0 ? ` (${pendingRequestCount} pending)` : ''}`}
            aria-expanded={requestsOpen}
          >
            <Bell className="w-4 h-4" strokeWidth={1.7} aria-hidden="true" />
            {pendingRequestCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[var(--emphasis)] text-[var(--bg)] text-[9px] font-mono font-bold flex items-center justify-center shadow-[0_0_8px_var(--emphasis-glow)]">
                {pendingRequestCount}
              </span>
            )}
          </button>

          {requestsOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setRequestsOpen(false)}
                aria-hidden="true"
              />
              <div className="absolute right-0 top-full mt-2 z-50 w-72 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-hairline)] shadow-[0_20px_50px_rgba(0,0,0,0.45)] overflow-hidden pop-in">
                <div className="px-4 pt-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                  Friend Requests
                </div>
                <div className="max-h-72 overflow-y-auto no-scrollbar pb-2">
                  {incomingRequests.length > 0 ? (
                    incomingRequests.map((req) => (
                      <div
                        key={req.id}
                        className="flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-[var(--bg-glass)] transition-colors"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <UserAvatar
                            avatar={req.user.avatarUrl || req.user.name.charAt(0).toUpperCase()}
                            name={req.user.name}
                            className="w-8 h-8 font-bold text-xs"
                          />
                          <div className="min-w-0">
                            <div className="font-display text-xs font-semibold text-[var(--text-primary)] truncate">
                              {req.user.name}
                            </div>
                            <div className="text-[11px] text-[var(--text-secondary)] truncate">
                              @{req.user.username}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => rejectFriendRequest(req.id)}
                            className="btn-secondary text-[11px] px-2.5 py-1.5"
                          >
                            Decline
                          </button>
                          <button
                            onClick={() => acceptFriendRequest(req.id)}
                            className="btn-primary text-[11px] px-2.5 py-1.5"
                          >
                            Accept
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="px-4 py-6 text-center text-xs text-[var(--text-tertiary)]">
                      No pending friend requests.
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </header>

      {/* ─── TABS — exactly two: Friends | Find Friends ─────────────────────── */}
      <div
        className="border-b border-[var(--border-hairline)] mb-2"
        style={{ animation: 'rise 640ms var(--ease) 150ms both' }}
      >
        <SlidingTabs
          items={FRIENDS_TABS.map((t) => ({ id: t.id, label: t.label }))}
          activeId={activeTab}
          onChange={(id) => setActiveTab(id as FriendsTab)}
        />
      </div>

      {/* ─── CONTENT ────────────────────────────────────────────────────────── */}
      {/* FRIENDS TAB — accepted friends list, no search */}
      {activeTab === 'friends' ? (
        friends.length > 0 ? (
          <div className="w-full" style={{ animation: 'rise 640ms var(--ease) 220ms both' }}>
            {friends.map((friend, i) => (
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
                    <div className="font-display text-[15px] font-semibold text-[var(--text-primary)] truncate">
                      {friend.name}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] mt-0.5 truncate">
                      <span>@{friend.username}</span>
                      {friend.currentRoomName && (
                        <span className="text-[var(--text-primary)] font-medium">
                          · In {friend.currentRoomName}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => startDm(friend.id)}
                  className="btn-secondary text-xs px-3.5 py-2 shrink-0"
                >
                  Message
                </button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Users}
            title="No friends yet."
            description="Find people to watch with, then send a friend request."
            action={
              <button
                onClick={() => setActiveTab('find-friends')}
                className="btn-primary text-sm"
              >
                Find Friends
              </button>
            }
          />
        )
      ) : (
        <>
          {/* FIND FRIENDS TAB — search + directory */}
          <div
            className="pt-2 mb-5 relative max-w-[420px]"
            style={{ animation: 'rise 640ms var(--ease) 220ms both' }}
          >
            <input
              type="text"
              value={directoryQuery}
              onChange={(e) => setDirectoryQuery(e.target.value)}
              placeholder="Search any PraConnect user..."
              className="field w-full pl-12 pr-4"
              aria-label="Search any PraConnect user"
              autoFocus
            />
            <Search
              className="w-4 h-4 text-[var(--text-tertiary)] absolute left-[18px] top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
          </div>

          {directoryUsers.length > 0 ? (
            <div className="w-full" style={{ animation: 'rise 640ms var(--ease) 260ms both' }}>
              {directoryUsers.map(renderDirectoryRow)}
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
            </div>
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
                    directoryQuery.trim()
                      ? 'Try a different name or @username.'
                      : 'Registered PraConnect users will appear here.'
                  }
                  action={
                    directoryQuery.trim() ? (
                      <button onClick={() => setDirectoryQuery('')} className="btn-secondary text-sm">
                        Clear search
                      </button>
                    ) : undefined
                  }
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};