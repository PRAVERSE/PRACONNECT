import React from 'react';
import { Radio, Users } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const StatPills: React.FC = () => {
  const { rooms, friends } = useApp();
  const onlineFriends = friends.filter((f) => f.status === 'online' && !f.requestPending && !f.isSuggestion).length;

  return (
    <div className="flex items-center gap-2.5 shrink-0">
      <span className="pill-glass flex items-center gap-2 px-3.5 py-1.5 text-[11px] font-mono text-[var(--text-secondary)]">
        <span
          className={`w-1.5 h-1.5 rounded-full live-dot ${rooms.length > 0 ? 'bg-[var(--text-primary)] shadow-[0_0_6px_var(--emphasis-glow)]' : 'bg-[var(--text-tertiary)]'}`}
        />
        {rooms.length} room{rooms.length !== 1 ? 's' : ''} live
      </span>
      <span className="pill-glass flex items-center gap-2 px-3.5 py-1.5 text-[11px] font-mono text-[var(--text-secondary)]">
        <span
          className={`w-1.5 h-1.5 rounded-full live-dot ${onlineFriends > 0 ? 'bg-[var(--text-primary)] shadow-[0_0_6px_var(--emphasis-glow)]' : 'bg-[var(--text-tertiary)]'}`}
        />
        {onlineFriends} friend{onlineFriends !== 1 ? 's' : ''} online
      </span>
    </div>
  );
};