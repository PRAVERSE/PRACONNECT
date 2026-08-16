import React, { useState, useEffect } from 'react';
import { Plus, KeyRound, Search, Radio, Users, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { UserAvatar } from '../common/UserAvatar';
import { EmptyState } from '../common/EmptyState';

export const ExploreView: React.FC = () => {
  const { rooms, refreshRooms, joinRoom, setCreateRoomModalOpen, setJoinRoomModalOpen } = useApp();
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    refreshRooms();
  }, [refreshRooms]);

  const filteredRooms = rooms.filter((room) => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return true;
    return (
      room.name.toLowerCase().includes(query) ||
      room.code.toLowerCase().includes(query) ||
      room.category.toLowerCase().includes(query) ||
      room.hostName.toLowerCase().includes(query)
    );
  });

  return (
    <div className="w-full text-[var(--text-primary)] font-['Inter',sans-serif] select-none">
      {/* ─── PAGE HEADER ──────────────────────────────────────────────────────── */}
      <header
        className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-10"
        style={{ animation: 'rise 640ms var(--ease) both' }}
      >
        <div className="max-w-[620px]">
          <h1
            className="font-display font-bold tracking-[-0.02em] text-[clamp(2rem,3.4vw,2.7rem)] leading-[1.1] mb-3"
            style={{ animation: 'rise 640ms var(--ease) 80ms both' }}
          >
            Explore Watch Rooms
          </h1>
          <p
            className="text-[15px] leading-relaxed text-[var(--text-secondary)] max-w-[520px]"
            style={{ animation: 'rise 640ms var(--ease) 150ms both' }}
          >
            Discover live parties, join your squad, or host your own watch session.
          </p>
        </div>

        <div
          className="flex items-center gap-3 shrink-0"
          style={{ animation: 'rise 640ms var(--ease) 220ms both' }}
        >
          <button
            onClick={() => setCreateRoomModalOpen(true)}
            className="btn-primary text-sm"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>Create Room</span>
          </button>

          <button
            onClick={() => setJoinRoomModalOpen(true)}
            className="btn-secondary text-sm"
          >
            <KeyRound className="w-4 h-4" aria-hidden="true" />
            <span>Enter Code</span>
          </button>
        </div>
      </header>

      {/* ─── SEARCH FIELD ────────────────────────────────────────────────────── */}
      <div
        className="mb-10 flex items-center gap-4 max-w-[520px]"
        style={{ animation: 'rise 640ms var(--ease) 220ms both' }}
      >
        <div className="relative flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search rooms by name, code, or host..."
            className="field w-full pl-12 pr-10"
            aria-label="Search rooms"
          />
          <Search
            className="w-4 h-4 text-[var(--text-tertiary)] absolute left-[18px] top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          {searchQuery.trim() && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] rounded-full cursor-pointer transition-colors"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {filteredRooms.length > 0 && (
          <span className="text-xs text-[var(--text-tertiary)] font-mono hidden sm:inline shrink-0">
            {filteredRooms.length} live
          </span>
        )}
      </div>

      {/* ─── REAL ROOMS — hairlined rows, no boxes ──────────────────────────── */}
      {filteredRooms.length > 0 ? (
        <div className="w-full" style={{ animation: 'rise 640ms var(--ease) 300ms both' }}>
          {filteredRooms.map((room, i) => (
            <div
              key={room.id}
              className={`flex items-center gap-4 py-4 group ${
                i > 0 ? 'border-t border-[var(--border-hairline)]' : ''
              }`}
            >
              {/* Live status */}
              <span className="flex items-center gap-1.5 text-[10px] font-mono font-bold text-[var(--text-primary)] shrink-0 w-[52px]">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-primary)] live-dot shadow-[0_0_6px_var(--emphasis-glow)]" />
                LIVE
              </span>

              {/* Room identity */}
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <UserAvatar
                  avatar={room.hostAvatar}
                  name={room.hostName}
                  className="w-9 h-9 font-bold text-xs"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="font-display text-[15px] font-semibold text-[var(--text-primary)] truncate">
                      {room.name}
                    </span>
                    <span className="pill-glass px-2.5 py-0.5 text-[10px] font-mono font-medium uppercase tracking-[0.06em] text-[var(--text-secondary)] shrink-0">
                      {room.category}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--text-tertiary)] mt-0.5 truncate">
                    host {room.hostName} · code {room.code}
                  </div>
                </div>
              </div>

              {/* Members + Join */}
              <div className="flex items-center gap-4 shrink-0">
                <span className="text-xs text-[var(--text-tertiary)] font-mono flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" aria-hidden="true" />
                  {room.memberCount}/{room.maxMembers}
                </span>
                <button
                  onClick={() => joinRoom(room.code)}
                  className="btn-secondary text-xs px-4 py-2"
                >
                  Join Room
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* CENTERED EMPTY STATE — owns the vertical center of the content area */
        <EmptyState
          icon={Radio}
          title={searchQuery ? `No live rooms found for "${searchQuery}"` : 'No rooms are live right now.'}
          description={
            searchQuery
              ? 'Try a different room name, code, or clear the search.'
              : 'Bring your people in and start the first live watch party.'
          }
          action={
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCreateRoomModalOpen(true)}
                className="btn-primary text-sm"
              >
                + Create a room
              </button>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="btn-secondary text-sm"
                >
                  Clear search
                </button>
              )}
            </div>
          }
        />
      )}
    </div>
  );
};