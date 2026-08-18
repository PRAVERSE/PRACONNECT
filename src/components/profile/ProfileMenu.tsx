import React, { useEffect, useRef } from 'react';
import { User, Users, Settings, LogOut, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { NavigationTab } from '../../types';
import { UserAvatar } from '../common/UserAvatar';

interface ProfileMenuProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLDivElement | null>;
}

interface MenuRowProps {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
}

const MenuRow: React.FC<MenuRowProps> = ({ icon: Icon, label, onClick }) => (
  <button
    onClick={onClick}
    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-glass)] transition-colors cursor-pointer text-left"
  >
    <span className="w-8 h-8 rounded-full bg-[var(--bg-glass)] flex items-center justify-center shrink-0">
      <Icon className="w-4 h-4 text-[var(--text-secondary)]" strokeWidth={1.7} aria-hidden="true" />
    </span>
    <span className="flex-1 min-w-0 truncate">{label}</span>
  </button>
);

export const ProfileMenu: React.FC<ProfileMenuProps> = ({ open, onClose, anchorRef }) => {
  const { userProfile, setActiveTab, logout } = useApp();

  const menuRef = useRef<HTMLDivElement>(null);

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

        <button
          onClick={onClose}
          className="p-1.5 rounded-full text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-glass)] transition-colors cursor-pointer"
          aria-label="Close profile menu"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-col gap-0.5 p-1.5 overflow-y-auto no-scrollbar">
        <MenuRow icon={User} label="Profile" onClick={() => navigate('profile')} />
        <MenuRow icon={Users} label="Friends" onClick={() => navigate('friends')} />
        <div className="my-1.5 mx-2 h-px bg-[var(--border-hairline)]" />
        <MenuRow icon={Settings} label="Settings" onClick={() => navigate('settings')} />
        <MenuRow icon={LogOut} label="Logout" onClick={handleLogout} />
      </div>
    </div>
  );
};