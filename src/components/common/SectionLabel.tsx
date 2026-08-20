import React from 'react';

interface SectionLabelProps {
  children: React.ReactNode;
  count?: number | string;
  action?: React.ReactNode;
  dim?: boolean;
  className?: string;
  as?: 'h2' | 'h3' | 'p' | 'div';
}

export const SectionLabel: React.FC<SectionLabelProps> = ({
  children,
  count,
  action,
  dim = false,
  className = 'mb-4',
  as: Component = 'h2',
}) => {
  return (
    <div className={`flex items-center justify-between gap-4 ${className}`}>
      <Component className={`${dim ? 'eyebrow-dim' : 'eyebrow'} flex items-center gap-2`}>
        <span>{children}</span>
        {count !== undefined && (
          <span className="opacity-70 font-mono">({count})</span>
        )}
      </Component>
      {action}
    </div>
  );
};
