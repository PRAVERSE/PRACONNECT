import React, { useState, useEffect } from 'react';

interface UserAvatarProps {
  avatar?: string;
  name?: string;
  className?: string;
  fallbackBg?: string;
  alt?: string;
}

export const isImageUrl = (url?: string): boolean => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('data:image') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('/') ||
    /\.(png|jpe?g|webp|gif|svg|avif)(\?.*)?$/i.test(trimmed)
  );
};

export const getAvatarFallback = (name?: string, avatar?: string): string => {
  // If avatar is already a single letter or emoji, return it
  if (avatar && typeof avatar === 'string') {
    const trimmed = avatar.trim();
    if (!isImageUrl(trimmed) && trimmed.length <= 3) {
      return trimmed;
    }
  }

  // Fallback to name initial
  if (name && typeof name === 'string' && name.trim()) {
    const trimmedName = name.trim();
    const parts = trimmedName.split(/\s+/);
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return trimmedName.charAt(0).toUpperCase();
  }

  return 'U';
};

export const UserAvatar: React.FC<UserAvatarProps> = ({
  avatar,
  name,
  className = 'w-8 h-8 text-xs font-bold',
  fallbackBg = 'bg-[var(--emphasis)] text-[var(--bg)]',
  alt
}) => {
  const [imageError, setImageError] = useState(false);
  const isImage = isImageUrl(avatar) && !imageError;

  // Reset error if avatar URL changes
  useEffect(() => {
    setImageError(false);
  }, [avatar]);

  const fallbackText = getAvatarFallback(name, avatar);

  return (
    <div
      className={`rounded-full flex items-center justify-center shrink-0 overflow-hidden select-none relative ${
        isImage ? 'bg-[var(--bg-surface-2)]' : fallbackBg
      } ${className}`}
      title={name || alt || 'User'}
    >
      {isImage ? (
        <img
          src={avatar}
          alt={alt || name || 'Avatar'}
          className="w-full h-full object-cover rounded-full"
          onError={() => setImageError(true)}
          loading="lazy"
        />
      ) : (
        <span className="leading-none flex items-center justify-center">{fallbackText}</span>
      )}
    </div>
  );
};
