import React, { useEffect, useRef, useState } from 'react';
import {
  User,
  Users,
  Inbox,
  UserPlus,
  Settings,
  LogOut,
  X,
  ChevronLeft,
  Link as LinkIcon,
  Check,
  Search,
  Maximize2
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { NavigationTab } from '../../types';
import { UserAvatar } from '../common/UserAvatar';
import { SlidingTabs } from '../common/SlidingTabs';

const FRIENDS_TABS = ['Online', 'Offline', 'Requests', 'Suggestions'] as const;
type FriendsTab = (typeof FRIENDS_TABS)[number];

interface ProfileMenuProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLDivElement | null>;
}

interface MenuRowProps {
  icon: React.ElementType;
  label: string;
  badge?: number;
  onClick: () => void;
}

const MenuRow: React.FC<MenuRowProps> = ({ icon: Icon, label, badge, onClick }) => (
  <button
    onClick={onClick}
    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-glass)] transition-colors cursor-pointer text-left"
  >
    <span className="w-8 h-8 rounded-full bg-[var(--bg-glass)] flex items-center justify-center shrink-0">
      <Icon className="w-4 h-4 text-[var(--text-secondary)]" strokeWidth={1.7} aria-hidden="true" />
    </span>
    <span className="flex-1 min-w-0 truncate">{label}</span>
    {typeof badge === 'number' && badge > 0 && (
      <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--emphasis)] text-[var(--bg)] text-[10px] font-mono font-bold flex items-center justify-center shadow-[0_0_8px_var(--emphasis-glow)]">
        {badge}
      </span>
    )}
  </button>
);

interface FriendsPanelBodyProps {
  initialTab: FriendsTab;
  onClose: () => void;
  onManageFull: () => void;
}

const FriendsPanelBody: React.FC<FriendsPanelBodyProps> = ({ initialTab, onClose, onManageFull }) => {
  const {
    friends,
    setActiveTab,
    setActiveDMId,
    addFriend,
    acceptFriendRequest,
    joinRoom
  } = useApp();

  const [activeTabSection, setActiveTabSection] = useState<FriendsTab>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [addInput, setAddInput] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  const handleCopyInviteLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/invite/praconnect`);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const matchesTab = (f: (typeof friends)[number], tab: FriendsTab) => {
    if (tab === 'Online') return f.status === 'online' && !f.requestPending && !f.isSuggestion;
    if (tab === 'Offline') return f.status === 'offline' && !f.requestPending && !f.isSuggestion;
    if (tab === 'Requests') return Boolean(f.requestPending);
    if (tab === 'Suggestions') return Boolean(f.isSuggestion);
    return true;
  };

  const countFor = (tab: FriendsTab) => friends.filter((f) => matchesTab(f, tab)).length;

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
    <div className="flex-1 min-h-0 flex flex-col overflow-y-auto no-scrollbar">
      {/* Search + Add Friend */}
      <div className="px-4 pt-3 space-y-2.5 shrink-0">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search friends..."
            className="field w-full pl-10 pr-8 text-[13px] py-2"
            aria-label="Search friends"
          />
          <Search
            className="w-3.5 h-3.5 text-[var(--text-tertiary)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors rounded-full cursor-pointer"
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
            className="field flex-1 min-w-0 text-[13px] py-2"
            aria-label="Friend handle to add"
          />
          <button
            type="submit"
            disabled={!addInput.trim()}
            className="btn-primary text-xs px-3 py-2 shrink-0 disabled:opacity-40"
          >
            <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Add</span>
          </button>
        </form>
      </div>

      {/* Tabs */}
      <div className="px-4 mt-3 border-b border-[var(--border-hairline)] shrink-0">
        <SlidingTabs
          items={FRIENDS_TABS.map((t) => ({ id: t, label: t, count: countFor(t) }))}
          activeId={activeTabSection}
          onChange={(id) => setActiveTabSection(id as FriendsTab)}
        />
      </div>

      {/* Friends List */}
      <div className="flex-1 min-h-0 px-2 py-2">
        {filteredFriends.length > 0 ? (
          <div className="flex flex-col">
            {filteredFriends.map((friend) => (
              <div
                key={friend.id}
                className="flex items-center justify-between gap-2 px-2 py-2.5 rounded-xl hover:bg-[var(--bg-glass)] transition-colors"
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
                          setActiveDMId(friend.id);
                          setActiveTab('messages');
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
          <div className="h-full min-h-[140px] flex flex-col items-center justify-center text-center px-6">
            <Users
              className="w-7 h-7 text-[var(--text-tertiary)] mb-2.5"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <p className="text-xs text-[var(--text-primary)] font-semibold mb-1">
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

      {/* Footer — invite link + full directory */}
      <div className="px-4 py-3 border-t border-[var(--border-hairline)] shrink-0 flex flex-col gap-2">
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
        <button onClick={onManageFull} className="btn-secondary text-xs w-full">
          <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Open Full Friends Directory</span>
        </button>
      </div>
    </div>
  );
};

export const ProfileMenu: React.FC<ProfileMenuProps> = ({ open, onClose, anchorRef }) => {
  const { userProfile, friends, setActiveTab, logout } = useApp();

  const menuRef = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState<'menu' | 'friends'>('menu');
  const [friendsTab, setFriendsTab] = useState<FriendsTab>('Online');

  const pendingRequestCount = friends.filter((f) => f.requestPending).length;

  useEffect(() => {
    if (open) setSection('menu');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  const navigate = (tab: NavigationTab) => {
    setActiveTab(tab);
    onClose();
  };

  const openFriends = (tab: FriendsTab) => {
    setFriendsTab(tab);
    setSection('friends');
  };

  const handleLogout = () => {
    onClose();
    logout();
  };

  return (
    <div
      ref={menuRef}
      role="dialog"
      aria-modal="false"
      aria-label="Profile menu"
      className="fixed z-50 select-none flex flex-col overflow-hidden bg-[var(--bg-elevated)] text-[var(--text-primary)] inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl border-t border-[var(--border-hairline)] shadow-[0_-12px_40px_rgba(0,0,0,0.4)] sm:inset-x-auto sm:bottom-5 sm:left-[100px] sm:w-[300px] sm:max-h-[calc(100vh-32px)] sm:rounded-2xl sm:border sm:shadow-[0_20px_50px_rgba(0,0,0,0.45)]"
      style={{ animation: 'rise 300ms var(--ease) both' }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-hairline)] shrink-0">
        {section === 'menu' ? (
          <>
            <UserAvatar
              avatar={userProfile.avatar}
              name={userProfile.name}
              className="w-10 h-10 font-bold text-sm"
            />
            <div className="min-w-0 flex-1">
              <div className="font-display text-[13px] font-semibold truncate">
                {userProfile.name}
              </div>
              <div className="text-[11px] text-[var(--text-secondary)] truncate">
                @{userProfile.username}
              </div>
            </div>
          </>
        ) : (
          <>
            <button
              onClick={() => setSection('menu')}
              className="p-1.5 -ml-1.5 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-glass)] transition-colors cursor-pointer"
              aria-label="Back to profile menu"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="font-display text-[13px] font-semibold">Friends</div>
            <div className="flex-1" />
          </>
        )}

        <button
          onClick={onClose}
          className="p-1.5 rounded-full text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-glass)] transition-colors cursor-pointer"
          aria-label="Close profile menu"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {section === 'menu' ? (
        <div className="flex flex-col gap-0.5 p-1.5 overflow-y-auto no-scrollbar">
          <MenuRow icon={User} label="Profile" onClick={() => navigate('profile')} />
          <MenuRow icon={Users} label="Friends" onClick={() => openFriends('Online')} />
          <MenuRow
            icon={Inbox}
            label="Requests"
            badge={pendingRequestCount}
            onClick={() => openFriends('Requests')}
          />
          <MenuRow icon={UserPlus} label="Find Friends" onClick={() => openFriends('Suggestions')} />
          <div className="my-1.5 mx-2 h-px bg-[var(--border-hairline)]" />
          <MenuRow icon={Settings} label="Settings" onClick={() => navigate('settings')} />
          <MenuRow icon={LogOut} label="Logout" onClick={handleLogout} />
        </div>
      ) : (
        <FriendsPanelBody
          initialTab={friendsTab}
          onClose={onClose}
          onManageFull={() => navigate('friends')}
        />
      )}
    </div>
  );
};
