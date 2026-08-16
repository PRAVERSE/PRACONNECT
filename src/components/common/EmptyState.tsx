import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  action,
  className = 'min-h-[60vh]'
}) => (
  <div
    className={`flex flex-col items-center justify-center text-center mx-auto max-w-[380px] ${className}`}
    style={{ animation: 'rise 640ms var(--ease) 250ms both' }}
  >
    <div className="breath mb-5 text-[var(--text-tertiary)]">
      <Icon className="w-10 h-10" strokeWidth={1.5} aria-hidden="true" />
    </div>
    <h3 className="font-display text-[19px] font-semibold text-[var(--text-primary)] mb-2 tracking-tight">
      {title}
    </h3>
    {description && (
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-6 max-w-[300px]">
        {description}
      </p>
    )}
    {action}
  </div>
);