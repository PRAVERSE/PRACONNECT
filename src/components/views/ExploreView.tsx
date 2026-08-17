import React, { useState, useEffect, useCallback } from 'react';
import { Plus, KeyRound, Search, Radio, Users, X, Timer, AlertTriangle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { UserAvatar } from '../common/UserAvatar';
import { EmptyState } from '../common/EmptyState';
import { formatCountdown, isRejoinWindowClosed } from '../../utils/roomCountdown';

export const ExploreView: React.FC = () => {
  const { rooms, refreshRooms, joinRoom, setCreateRoomModalOpen, setJoinRoomModalOpen } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  // Single page-mounted ticker (~1s) for rejoin countdowns. No server polling:
  // the server-provided rejoinExpiresAt is authoritative; the client only
  // removes a room from the visible list when its window closes.
  const [now, setNow] = useState(() => Date.now());
  // Transient message when a join is rejected mid-countdown (race: the server
  // may have expired the room even though the client countdown still shows time).
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    refreshRooms();
  }, [refreshRooms]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Realtime reactivity without polling: rooms in Explore change when OTHER
  // users join/leave (WAITING <-> LIVE). There is no global room-feed stream,
  // so we refetch once when the user returns to the tab/window — the same
  // places a user looks when they expect fresh live-room state.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshRooms();
    };
    const onFocus = () => refreshRooms();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshRooms]);

  // A room disappears from Explore when its rejoin window closes — the server
  // remains authoritative (it enforces the TTL on listing and on join).
  const handleJoin = useCallback(
    async (code: string) => {
      setJoinError(null);
      const ok = await joinRoom(code);
      if (!ok) {
        // Server rejected the join (e.g. room expired/deleted mid-countdown):
        // refetch the authoritative list so stale rooms vanish immediately.
        setJoinError('Could not join this room — it may have just expired or reached full capacity.');
        refreshRooms();
      }
    },
    [joinRoom, refreshRooms]
  );

  const filteredRooms = rooms.filter((room) => {
    if (isRejoinWindowClosed(room.rejoinExpiresAt, now)) return false;
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
            {filteredRooms.length} {filteredRooms.length === 1 ? 'room' : 'rooms'}
          </span>
        )}
      </div>

      {joinError && (
        <div
          className="mb-8 flex items-center gap-2.5 max-w-[560px] text-xs font-medium text-[#F59E0B] bg-[#F59E0B]/10 border border-[#F59E0B]/25 rounded-xl px-4 py-3"
          style={{ animation: 'rise 320ms var(--ease) both' }}
        >
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{joinError}</span>
        </div>
      )}

      {/* ─── REAL ROOMS — hairlined rows, no boxes ──────────────────────────── */}
      {filteredRooms.length > 0 ? (
        <div className="w-full" style={{ animation: 'rise 640ms var(--ease) 300ms both' }}>
          {filteredRooms.map((room, i) => {
            const waiting = Boolean(room.isEmpty && room.isRejoinable && room.rejoinExpiresAt);
            return (
              <div
                key={room.id}
                className={`flex items-center gap-4 py-4 group ${
                  i > 0 ? 'border-t border-[var(--border-hairline)]' : ''
                }`}
              >
                {/* Status: Live Now vs Waiting for people */}
                <span className="flex items-center gap-1.5 text-[10px] font-mono font-bold text-[var(--text-primary)] shrink-0 w-[68px]">
                  {waiting ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] shadow-[0_0_6px_rgba(245,158,11,0.6)]" />
                      WAITING
                    </>
                  ) : (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-primary)] live-dot shadow-[0_0_6px_var(--emphasis-glow)]" />
                      LIVE
                    </>
                  )}
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
                    {waiting && (
                      <div className="text-xs font-mono text-[#F59E0B] mt-0.5 flex items-center gap-1.5">
                        <Timer className="w-3 h-3" aria-hidden="true" />
                        Rejoinable for {formatCountdown(room.rejoinExpiresAt!, now)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Members + Join */}
                <div className="flex items-center gap-4 shrink-0">
                  <span className="text-xs text-[var(--text-tertiary)] font-mono flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" aria-hidden="true" />
                    {room.memberCount} watching
                  </span>
                  <button
                    onClick={() => handleJoin(room.code)}
                    className={`btn-secondary text-xs px-4 py-2 ${waiting ? 'text-[#F59E0B] border-[#F59E0B]/40' : ''}`}
                  >
                    Join Room
                  </button>
                </div>
              </div>
            );
          })}
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