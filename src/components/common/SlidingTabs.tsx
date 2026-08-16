import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

interface SlidingTabsProps {
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
}

export const SlidingTabs: React.FC<SlidingTabsProps> = ({ items, activeId, onChange, className = '' }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [underline, setUnderline] = useState<{ x: number; width: number } | null>(null);

  const measure = () => {
    const activeIndex = items.findIndex((t) => t.id === activeId);
    const el = tabRefs.current[activeIndex];
    const container = containerRef.current;
    if (el && container) {
      setUnderline({
        x: el.offsetLeft,
        width: el.offsetWidth,
      });
    }
  };

  useLayoutEffect(() => {
    measure();
  }, [activeId, items]);

  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [activeId]);

  return (
    <div ref={containerRef} className={`relative flex items-center gap-6 sm:gap-8 overflow-x-auto no-scrollbar ${className}`}>
      {items.map((tab, i) => {
        const isActive = tab.id === activeId;
        return (
          <button
            key={tab.id}
            ref={(el) => { tabRefs.current[i] = el; }}
            onClick={() => onChange(tab.id)}
            className={`relative pb-3 text-[13px] whitespace-nowrap cursor-pointer flex items-center gap-2 transition-colors duration-150 ${
              isActive ? 'text-[var(--text-primary)] font-semibold' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <span>{tab.label}</span>
            {typeof tab.count === 'number' && (
              <span className="text-[11px] font-mono text-[var(--text-tertiary)]">({tab.count})</span>
            )}
          </button>
        );
      })}

      {underline && (
        <span
          className="absolute bottom-0 left-0 h-[2px] bg-[var(--text-primary)] rounded-full shadow-[0_0_10px_var(--emphasis-glow)] pointer-events-none"
          style={{
            width: underline.width,
            transform: `translateX(${underline.x}px)`,
            transition: 'transform 250ms var(--ease), width 250ms var(--ease)',
          }}
        />
      )}
    </div>
  );
};