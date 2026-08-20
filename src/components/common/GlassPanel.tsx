import React from 'react';

interface GlassPanelProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  style?: React.CSSProperties;
  as?: 'div' | 'section' | 'article';
}

export const GlassPanel: React.FC<GlassPanelProps> = ({
  children,
  className = '',
  hover = false,
  style,
  as: Component = 'div',
}) => {
  return (
    <Component
      style={style}
      className={`bg-[var(--bg-glass)] backdrop-blur-[16px] border border-[var(--border-hairline)] rounded-2xl ${
        hover ? 'hover:border-[var(--border-strong)] transition-colors' : ''
      } ${className}`}
    >
      {children}
    </Component>
  );
};
