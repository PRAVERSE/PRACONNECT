import React, { useRef, useState } from 'react';
import {
  Tv,
  Compass,
  Gamepad2,
  MessageSquare,
  Library,
  Bell,
  Radio,
  Play
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { NavigationTab } from '../types';
import { UserAvatar } from './common/UserAvatar';
import { Tooltip } from './common/Tooltip';
import { ProfileMenu } from './profile/ProfileMenu';

export const Sidebar: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    currentRoom,
    notifications,
    setNotificationsOpen,
    userProfile,
    friends,
    friendRequests,
  } = useApp();

  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const avatarWrapRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const messageUnreadCount = friends.reduce(
    (sum, f) => sum + (typeof f.unreadCount === 'number' ? f.unreadCount : 0),
    0
  );
  const pendingRequestCount = friendRequests.incoming.length;

  const iconGlyphClass = 'w-5 h-5';

  const navItems: { id: NavigationTab; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: 'Home', icon: <Tv className={iconGlyphClass} strokeWidth={1.7} /> },
    { id: 'explore', label: 'Explore', icon: <Compass className={iconGlyphClass} strokeWidth={1.7} /> },
    { id: 'games', label: 'Games', icon: <Gamepad2 className={iconGlyphClass} strokeWidth={1.7} /> },
    { id: 'messages', label: 'Messages', icon: <MessageSquare className={iconGlyphClass} strokeWidth={1.7} /> },
    { id: 'library', label: 'Media Library', icon: <Library className={iconGlyphClass} strokeWidth={1.7} /> }
  ];

  const iconButtonClass =
    'relative w-11 h-11 rounded-full flex items-center justify-center cursor-pointer transition-transform duration-150 active:scale-95 group';

  const activePill = (isActive: boolean) =>
    isActive ? (
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full bg-[var(--emphasis-dim)]"
      />
    ) : null;

  const hoverWash = (
    <span
      aria-hidden="true"
      className="absolute inset-[3px] rounded-full bg-[var(--bg-glass)] opacity-0 group-hover:opacity-100 transition-opacity duration-150"
    />
  );

  const iconState = (isActive: boolean) =>
    isActive ? 'nav-icon nav-icon--active relative z-10' : 'nav-icon relative z-10';

  return (
    <aside className="h-full w-[84px] bg-[var(--bg)] border-r border-[var(--border-hairline)] text-[var(--text-primary)] flex flex-col items-center py-4 select-none shrink-0 z-30">
      {/* Brand */}
      <Tooltip label="PraConnect Home" side="right">
        <button
          onClick={() => setActiveTab(currentRoom ? 'room' : 'dashboard')}
          className="w-11 h-11 rounded-full bg-[var(--emphasis)] text-[var(--bg)] flex items-center justify-center shadow-[0_4px_20px_rgba(255,255,255,0.2)] transition-transform duration-200 hover:scale-105 active:scale-95 cursor-pointer"
          title="PraConnect Home"
        >
          <Play className="w-4 h-4 fill-current translate-x-0.5" />
        </button>
      </Tooltip>

      {/* Group A — main navigation */}
      <nav className="flex flex-col items-center gap-4 mt-6" aria-label="Primary">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          const isMessages = item.id === 'messages';
          const showBadge = isMessages && messageUnreadCount > 0;

          return (
            <Tooltip key={item.id} label={showBadge ? `${item.label} (${messageUnreadCount})` : item.label} side="right">
              <button
                onClick={() => setActiveTab(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={iconButtonClass}
              >
                {activePill(isActive)}
                {hoverWash}
                <span className={iconState(isActive)}>{item.icon}</span>
                {showBadge && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[var(--emphasis)] text-[var(--bg)] text-[9px] font-mono font-bold flex items-center justify-center shadow-[0_0_8px_var(--emphasis-glow)]">
                    {messageUnreadCount}
                  </span>
                )}
              </button>
            </Tooltip>
          );
        })}

        {/* Active Live Room */}
        {currentRoom && (
          <Tooltip label={`Active Watch Room — ${currentRoom.name}`} side="right">
            <button
              onClick={() => setActiveTab('room')}
              className={iconButtonClass}
            >
              {activePill(activeTab === 'room')}
              <span className={iconState(activeTab === 'room')}>
                <Radio className={iconGlyphClass} strokeWidth={1.7} />
              </span>
            </button>
          </Tooltip>
        )}
      </nav>

      {/* Group B — utilities, pinned to bottom */}
      <div className="flex flex-col items-center gap-4 mt-auto">
        {/* Notifications */}
        <Tooltip label={`Notifications${unreadCount > 0 ? ` (${unreadCount})` : ''}`} side="right">
          <button
            onClick={() => setNotificationsOpen(true)}
            className={iconButtonClass}
          >
            {hoverWash}
            <span className="nav-icon relative z-10">
              <Bell className={iconGlyphClass} strokeWidth={1.7} />
            </span>
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[var(--emphasis)] text-[var(--bg)] text-[9px] font-mono font-bold flex items-center justify-center shadow-[0_0_8px_var(--emphasis-glow)]">
                {unreadCount}
              </span>
            )}
          </button>
        </Tooltip>

        {/* Profile — single social/account entry point */}
        <Tooltip
          label={`${userProfile.name || 'Profile'} — @${userProfile.username || 'user'}${
            pendingRequestCount > 0
              ? ` · ${pendingRequestCount} pending request${pendingRequestCount > 1 ? 's' : ''}`
              : ''
          }`}
          side="right"
        >
          <div ref={avatarWrapRef} className="relative">
            <button
              onClick={() => setProfileMenuOpen((o) => !o)}
              aria-haspopup="dialog"
              aria-expanded={profileMenuOpen}
              aria-label="Open profile menu"
              className="relative w-11 h-11 rounded-full flex items-center justify-center cursor-pointer transition-transform duration-200 hover:scale-105 active:scale-95 group"
            >
              <UserAvatar
                avatar={userProfile.avatar}
                name={userProfile.name}
                className="w-11 h-11 font-bold text-sm shadow-[0_4px_16px_var(--emphasis-dim)]"
              />
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-[var(--text-primary)] rounded-full border-2 border-[var(--bg)]" />
            </button>
            {pendingRequestCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[var(--emphasis)] text-[var(--bg)] text-[9px] font-mono font-bold flex items-center justify-center shadow-[0_0_8px_var(--emphasis-glow)]">
                {pendingRequestCount}
              </span>
            )}
          </div>
        </Tooltip>
      </div>

      {/* Profile popover — profile, friends, requests, find friends, settings, logout */}
      <ProfileMenu
        open={profileMenuOpen}
        onClose={() => setProfileMenuOpen(false)}
        anchorRef={avatarWrapRef}
      />
    </aside>
  );
};
