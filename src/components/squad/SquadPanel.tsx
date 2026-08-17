import React, { useEffect, useState } from 'react';
import { Link as LinkIcon, Check, Users, Search, UserPlus, X, UserCog } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { UserAvatar } from '../common/UserAvatar';
import { SlidingTabs } from '../common/SlidingTabs';

const TABS = ['Online', 'Offline', 'Requests', 'Suggestions'] as const;

interface SquadPanelProps {
  open: boolean;
  onClose: () => void;
}

export const SquadPanel: React.FC<SquadPanelProps> = ({ open, onClose }) => {
  const {
    friends,
    setActiveTab,
    startDm,
    addFriend,
    acceptFriendRequest,
    joinRoom
  } = useApp();

  const [activeTabSection, setActiveTabSection] = useState<string>('Online');
  const [searchQuery, setSearchQuery] = useState('');
  const [addInput, setAddInput] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    if (open) {
      setActiveTabSection('Online');
      setSearchQuery('');
      setAddInput('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleCopyInviteLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/invite/praconnect`);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleManageFriends = () => {
    setActiveTab('friends');
    onClose();
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
    return matchesSearch && matchesTab(f, activeTabSection);
  });

  const emptyTitle =
    activeTabSection === 'Online'
      ? "No one's around yet."
      : activeTabSection === 'Requests'
      ? 'No pending friend requests.'
      : activeTabSection === 'Suggestions'
      ? 'No suggestions right now.'
      : 'No offline friends.';

  return (
    <div className="fixed inset-0 z-50 select-none" role="dialog" aria-modal="true" aria-label="Squad">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-xs animate-fade-in"
        onClick={onClose}
      />

      {/* Right-side drawer — full-width sheet on mobile, anchored panel on desktop */}
      <div
        className="absolute inset-y-0 right-0 w-full sm:w-[380px] lg:w-[420px] bg-[var(--bg-elevated)] border-l border-[var(--border-hairline)] text-[var(--text-primary)] flex flex-col shadow-[-12px_0_40px_rgba(0,0,0,0.5)]"
        style={{ animation: 'drawer-in 240ms var(--ease) both' }}
      >
        {/* Drawer Header */}
        <div className="px-5 pt-5 pb-4 border-b border-[var(--border-hairline)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-full bg-[var(--emphasis-dim)] flex items-center justify-center">
              <Users className="w-4 h-4" aria-hidden="true" />
            </span>
            <h2 className="font-display text-[15px] font-semibold text-[var(--text-primary)]">
              Squad
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-glass)] transition-colors cursor-pointer"
            aria-label="Close squad panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search + Add Friend */}
        <div className="px-5 pt-4 space-y-3 shrink-0">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search friends..."
              className="field w-full pl-11 pr-9 text-[13px] py-2.5"
              aria-label="Search friends"
            />
            <Search
              className="w-3.5 h-3.5 text-[var(--text-tertiary)] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors rounded-full cursor-pointer"
                aria-label="Clear search query"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (addInput.trim()) {
                addFriend(addInput.trim());
                setAddInput('');
              }
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={addInput}
              onChange={(e) => setAddInput(e.target.value)}
              placeholder="Add @handle..."
              className="field flex-1 min-w-0 text-[13px] py-2.5"
              aria-label="Friend handle to add"
            />
            <button
              type="submit"
              disabled={!addInput.trim()}
              className="btn-primary text-xs px-3.5 py-2.5 shrink-0 disabled:opacity-40"
            >
              <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Add</span>
            </button>
          </form>
        </div>

        {/* Tabs */}
        <div className="px-5 mt-4 border-b border-[var(--border-hairline)] shrink-0">
          <SlidingTabs
            items={TABS.map((t) => ({ id: t, label: t, count: countFor(t) }))}
            activeId={activeTabSection}
            onChange={setActiveTabSection}
          />
        </div>

        {/* Friends List */}
        <div className="flex-1 overflow-y-auto no-scrollbar min-h-0 px-3 py-3">
          {filteredFriends.length > 0 ? (
            <div className="flex flex-col">
              {filteredFriends.map((friend) => (
                <div
                  key={friend.id}
                  className="flex items-center justify-between gap-2.5 px-2 py-2.5 rounded-xl hover:bg-[var(--bg-glass)] transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative shrink-0">
                      <UserAvatar
                        avatar={friend.avatar}
                        name={friend.name}
                        className="w-9 h-9 font-bold text-xs"
                      />
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-[var(--bg-elevated)] ${
                          friend.status === 'online'
                            ? 'bg-[var(--text-primary)] live-dot shadow-[0_0_6px_var(--emphasis-glow)]'
                            : 'bg-[var(--text-tertiary)]'
                        }`}
                      />
                    </div>

                    <div className="min-w-0">
                      <div className="font-display text-xs font-semibold text-[var(--text-primary)] truncate">
                        {friend.name}
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)] truncate">
                        {friend.currentRoomName ? (
                          <span className="text-[var(--text-primary)] font-medium">
                            In {friend.currentRoomName}
                          </span>
                        ) : (
                          <span>@{friend.username}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {activeTabSection === 'Requests' ? (
                      <button
                        onClick={() => acceptFriendRequest(friend.id)}
                        className="btn-primary text-[11px] px-3 py-1.5"
                      >
                        Accept
                      </button>
                    ) : activeTabSection === 'Suggestions' ? (
                      <button
                        onClick={() => addFriend(friend.name)}
                        className="btn-primary text-[11px] px-3 py-1.5"
                      >
                        Add
                      </button>
                    ) : (
                      <>
                        {friend.currentRoomCode && (
                          <button
                            onClick={() => {
                              joinRoom(friend.currentRoomCode!);
                              onClose();
                            }}
                            className="btn-secondary text-[11px] px-2.5 py-1.5"
                          >
                            Join
                          </button>
                        )}
                        <button
                          onClick={() => {
                            startDm(friend.id);
                            onClose();
                          }}
                          className="btn-secondary text-[11px] px-2.5 py-1.5"
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
            /* Centered empty state */
            <div className="h-full flex flex-col items-center justify-center text-center px-6">
              <Users className="w-8 h-8 text-[var(--text-tertiary)] mb-3" strokeWidth={1.5} aria-hidden="true" />
              <p className="text-xs text-[var(--text-primary)] font-semibold mb-1.5">
                {searchQuery ? `No friends found for "${searchQuery}"` : emptyTitle}
              </p>
              <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed max-w-[220px]">
                {searchQuery
                  ? 'Try a different name or clear the search.'
                  : 'Share your invite link to build your circle.'}
              </p>
            </div>
          )}
        </div>

        {/* Footer — invite link + manage */}
        <div className="px-5 py-4 border-t border-[var(--border-hairline)] shrink-0 flex flex-col gap-2">
          <button onClick={handleCopyInviteLink} className="btn-secondary text-xs w-full">
            {copiedLink ? (
              <>
                <Check className="w-3.5 h-3.5 text-[var(--text-primary)]" aria-hidden="true" />
                <span className="text-[var(--text-primary)]">Link Copied!</span>
              </>
            ) : (
              <>
                <LinkIcon className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Copy Invite Link</span>
              </>
            )}
          </button>
          <button onClick={handleManageFriends} className="btn-secondary text-xs w-full">
            <UserCog className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Manage Friends</span>
          </button>
        </div>
      </div>
    </div>
  );
};
