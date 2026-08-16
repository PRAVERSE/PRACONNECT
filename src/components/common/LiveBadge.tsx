import React from 'react';

interface LiveBadgeProps {
  label?: string;
  className?: string;
  size?: 'sm' | 'md';
}

export const LiveBadge: React.FC<LiveBadgeProps> = ({
  label = 'LIVE',
  className = '',
  size = 'md'
}) => {
  const sizeClasses =
    size === 'sm'
      ? 'px-2 py-0.5 text-[9px] gap-1'
      : 'px-2.5 py-1 text-[10px] gap-1.5';

  return (
    <span
      className={`relative inline-flex items-center font-extrabold uppercase tracking-widest text-[var(--status-success)] bg-[var(--status-success-bg)] border border-[var(--status-success)]/30 rounded-full font-mono select-none animate-live-glow ${sizeClasses} ${className}`}
    >
      {/* Pulsing Dot */}
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-success)] animate-live-dot shrink-0" />
      <span>{label}</span>
    </span>
  );
};
