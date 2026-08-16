import React, { useState } from 'react';
import { UserAvatar } from './UserAvatar';

export interface StackUser {
  id?: string;
  name: string;
  avatar: string;
  isWatching?: boolean;
  mediaPoster?: string;
  isOnline?: boolean;
}

interface AvatarStackProps {
  users: StackUser[];
  maxDisplay?: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const AvatarStack: React.FC<AvatarStackProps> = ({
  users,
  maxDisplay = 4,
  size = 'md',
  className = ''
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const displayUsers = users.slice(0, maxDisplay);
  const overflowCount = users.length - maxDisplay;

  const sizeDimensions = {
    sm: { avatar: 'w-7 h-7 text-[10px]', overlap: '-ml-2', spread: 'hover:ml-1' },
    md: { avatar: 'w-9 h-9 text-xs', overlap: '-ml-2.5', spread: 'hover:ml-1.5' },
    lg: { avatar: 'w-11 h-11 text-sm', overlap: '-ml-3', spread: 'hover:ml-2' }
  }[size];

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`inline-flex items-center select-none py-1 ${className}`}
    >
      {displayUsers.map((user, idx) => {
        const isFirst = idx === 0;
        const isOffline = user.isOnline === false;

        return (
          <div
            key={user.id || idx}
            className={`relative transition-all duration-200 ease-out group ${
              !isFirst ? (isHovered ? 'ml-1.5' : sizeDimensions.overlap) : ''
            } ${isOffline ? 'opacity-60' : 'opacity-100'}`}
            style={{ zIndex: displayUsers.length - idx }}
            title={user.name}
          >
            {/* Avatar Container with Ring */}
            <div
              className={`rounded-full overflow-hidden flex items-center justify-center font-extrabold text-[var(--text-primary)] shadow-md border-2 border-[var(--bg-canvas)] ${
                sizeDimensions.avatar
              } ${
                user.isWatching
                  ? 'ring-2 ring-[var(--accent)] bg-[var(--bg-surface-2)]'
                  : user.isOnline
                  ? 'ring-2 ring-[var(--status-success)] bg-[var(--bg-surface-2)]'
                  : 'bg-[var(--bg-surface-3)]'
              }`}
            >
              <UserAvatar
                avatar={user.avatar}
                name={user.name}
                className="w-full h-full text-inherit"
                fallbackBg="bg-transparent"
              />
            </div>

            {/* Watching Media Tiny Thumbnail Badge */}
            {user.isWatching && (
              <div
                className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[var(--bg-canvas)] border border-[var(--accent)] overflow-hidden flex items-center justify-center shadow-xs"
                title={`Watching media`}
              >
                {user.mediaPoster ? (
                  <img src={user.mediaPoster} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                )}
              </div>
            )}
          </div>
        );
      })}

      {overflowCount > 0 && (
        <div
          className={`relative rounded-full bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border-2 border-[var(--bg-canvas)] flex items-center justify-center font-mono font-bold text-[10px] shadow-md transition-all duration-200 ${
            sizeDimensions.avatar
          } ${isHovered ? 'ml-1.5' : sizeDimensions.overlap}`}
          style={{ zIndex: 0 }}
        >
          +{overflowCount}
        </div>
      )}
    </div>
  );
};
