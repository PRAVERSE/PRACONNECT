import React, { useRef, useState } from 'react';

interface TooltipProps {
  label: React.ReactNode;
  side?: 'right' | 'top' | 'bottom';
  className?: string;
  children: React.ReactNode;
}

export const Tooltip: React.FC<TooltipProps> = ({ label, side = 'right', className = '', children }) => {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const show = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (side === 'top') {
      setPos({ top: r.top - 12, left: r.left + r.width / 2 });
    } else if (side === 'bottom') {
      setPos({ top: r.bottom + 12, left: r.left + r.width / 2 });
    } else {
      setPos({ top: r.top + r.height / 2, left: r.right + 12 });
    }
  };

  const hide = () => setPos(null);

  return (
    <span
      ref={triggerRef}
      className={`inline-flex ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {pos && (
        <span
          role="tooltip"
          className="fixed z-[9999] pointer-events-none"
          style={{
            top: pos.top,
            left: pos.left,
            transform:
              side === 'top'
                ? 'translate(-50%, -100%)'
                : side === 'bottom'
                ? 'translate(-50%, 0)'
                : 'translate(0, -50%)',
          }}
        >
          <span className="tooltip block">{label}</span>
        </span>
      )}
    </span>
  );
};