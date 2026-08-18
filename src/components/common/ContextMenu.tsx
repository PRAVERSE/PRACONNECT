// src/components/common/ContextMenu.tsx
// Shared context menu used by the message and conversation rows (right-click
// on desktop, long-press on mobile). On small screens it renders as a bottom
// sheet; on larger screens as a fixed floating panel clamped to the viewport.
// Supports inline-expanding submenus and full keyboard navigation.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { clampMenuPosition } from '../../utils/contextMenu';
import type { MenuPosition } from '../../utils/contextMenu';
import type { ContextMenuItem as MenuItemModel } from '../../utils/contextMenu';

export interface ContextMenuItem extends MenuItemModel {
  icon: LucideIcon;
  submenu?: ContextMenuItem[];
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  onSelect: (item: ContextMenuItem) => void;
}

const MENU_MARGIN = 8;
const MOBILE_BREAKPOINT = 640;

export function ContextMenu({ x, y, items, onClose, onSelect }: ContextMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [position, setPosition] = useState<MenuPosition>({ x, y });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isSheet, setIsSheet] = useState(false);

  const close = useCallback(() => {
    onClose();
  }, [onClose]);

  useLayoutEffect(() => {
    setIsSheet(typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT);
    if (isSheet) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    setPosition(
      clampMenuPosition(
        x,
        y,
        rect.width || 240,
        rect.height || 320,
        window.innerWidth,
        window.innerHeight,
        MENU_MARGIN
      )
    );
  }, [x, y, isSheet]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (isSheet) return;
      if (e.key === 'Tab') {
        close();
        return;
      }
      const enabled = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
      if (enabled.length === 0) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const currentIndex = enabled.indexOf(document.activeElement as HTMLButtonElement);
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        const next = enabled[(currentIndex + delta + enabled.length) % enabled.length];
        next?.focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        const focused = document.activeElement as HTMLButtonElement | null;
        if (focused && itemRefs.current.includes(focused)) {
          e.preventDefault();
          focused.click();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close, isSheet]);

  useEffect(() => {
    const onScroll = () => close();
    const onResize = () => close();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [close]);

  const handleSelect = (item: ContextMenuItem) => {
    if (item.disabled) return;
    if (item.submenu) {
      setExpandedId((current) => (current === item.id ? null : item.id));
      return;
    }
    onSelect(item);
    close();
  };

  const flatEnabled = (list: ContextMenuItem[]): ContextMenuItem[] => {
    const out: ContextMenuItem[] = [];
    for (const item of list) {
      if (item.disabled) continue;
      out.push(item);
      if (expandedId === item.id && item.submenu) out.push(...item.submenu);
    }
    return out;
  };
  const visibleItems = flatEnabled(items);

  const panelClassName = isSheet
    ? 'fixed inset-x-0 bottom-0 z-[9999] rounded-t-2xl border-t border-[var(--border-hairline)] shadow-[0_-12px_40px_rgba(0,0,0,0.4)]'
    : 'fixed z-[9999] min-w-[230px] rounded-2xl border border-[var(--border-hairline)] shadow-[0_20px_50px_rgba(0,0,0,0.45)]';

  const rowClassName = (item: ContextMenuItem) =>
    `w-full flex items-center gap-3 px-3.5 py-2.5 text-left text-[13px] transition-colors cursor-pointer ${
      item.danger ? 'text-[var(--status-error)]' : 'text-[var(--text-primary)]'
    } ${item.disabled ? 'opacity-40 cursor-default' : 'hover:bg-[var(--bg-glass)]'}`;

  return (
    <>
      <div className="fixed inset-0 z-[9998] bg-transparent" onClick={close} aria-hidden="true" />
      <div
        ref={panelRef}
        role="menu"
        aria-label="Context menu"
        className={`${panelClassName} bg-[var(--bg-elevated)] overflow-y-auto max-h-[85vh] py-1.5 select-none pop-in text-[var(--text-primary)]`}
        style={isSheet ? undefined : { left: position.x, top: position.y }}
      >
        {visibleItems.map((item, index) => {
          const hasSubmenu = Boolean(item.submenu);
          const isExpanded = expandedId === item.id && hasSubmenu;
          const Icon = item.icon;
          return (
            <div key={item.id}>
              {item.separatorBefore && <div className="mx-3 my-1 border-t border-[var(--border-hairline)]" aria-hidden="true" />}
              <button
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => {
                  if (hasSubmenu) setExpandedId(item.id);
                }}
                className={rowClassName(item)}
              >
                <Icon className={`w-4 h-4 shrink-0 ${item.danger ? '' : 'text-[var(--text-secondary)]'}`} aria-hidden="true" />
                <span className="flex-1 min-w-0 truncate">{item.label}</span>
                {hasSubmenu && <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''} text-[var(--text-tertiary)]`} aria-hidden="true" />}
              </button>
              {hasSubmenu && (
                <div className={isExpanded ? 'block' : 'hidden'}>
                  {item.submenu!.map((sub) => {
                    const SubIcon = sub.icon;
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        role="menuitem"
                        disabled={sub.disabled}
                        onClick={() => handleSelect(sub)}
                        className={`${rowClassName(sub)} pl-8`}
                      >
                        <SubIcon className={`w-4 h-4 shrink-0 ${sub.danger ? '' : 'text-[var(--text-secondary)]'}`} aria-hidden="true" />
                        <span className="flex-1 min-w-0 truncate">{sub.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}