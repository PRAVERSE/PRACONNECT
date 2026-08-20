import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  eyebrow?: {
    text: string;
    icon?: LucideIcon;
  };
  actions?: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  eyebrow,
  actions,
  className = 'mb-10',
}) => {
  const EyebrowIcon = eyebrow?.icon;

  return (
    <header
      className={`flex flex-col md:flex-row md:items-start justify-between gap-6 ${className}`}
      style={{ animation: 'rise 640ms var(--ease) both' }}
    >
      <div className="max-w-[620px]">
        {eyebrow && (
          <span
            className="pill-glass inline-flex items-center gap-2 px-3.5 py-1.5 text-[11px] font-mono font-medium uppercase tracking-[0.08em] text-[var(--text-secondary)] mb-4"
            style={{ animation: 'rise 640ms var(--ease) 0ms both' }}
          >
            {EyebrowIcon && <EyebrowIcon className="w-3.5 h-3.5 text-[var(--text-secondary)]" aria-hidden="true" />}
            {eyebrow.text}
          </span>
        )}

        <h1
          className="font-display font-bold tracking-[-0.02em] text-[clamp(2rem,3.4vw,2.7rem)] leading-[1.1] mb-3"
          style={{ animation: 'rise 640ms var(--ease) 80ms both' }}
        >
          {title}
        </h1>

        {subtitle && (
          <p
            className="text-[15px] leading-relaxed text-[var(--text-secondary)] max-w-[520px]"
            style={{ animation: 'rise 640ms var(--ease) 150ms both' }}
          >
            {subtitle}
          </p>
        )}
      </div>

      {actions && (
        <div
          className="flex flex-wrap items-center gap-3 shrink-0"
          style={{ animation: 'rise 640ms var(--ease) 220ms both' }}
        >
          {actions}
        </div>
      )}
    </header>
  );
};
