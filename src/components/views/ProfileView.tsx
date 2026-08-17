import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { UserAvatar, isImageUrl } from '../common/UserAvatar';

const useCountUp = (target: number, duration = 350) => {
  const [value, setValue] = useState(0);

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || target === 0) {
      setValue(target);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
};

export const ProfileView: React.FC = () => {
  const { userProfile, updateProfile, rooms, friends, watchHistory, roomStats, refreshRoomStats } = useApp();
  const [editModalOpen, setEditModalOpen] = useState(false);

  // Authoritative statistics come from durable server-side history — not from
  // the active room list, which loses entries to the 5-minute cleanup.
  useEffect(() => {
    refreshRoomStats();
  }, [refreshRoomStats]);

  // Form states
  const [name, setName] = useState(userProfile.name);
  const [username, setUsername] = useState(userProfile.username);
  const [bio, setBio] = useState(userProfile.bio);
  const [avatar, setAvatar] = useState(userProfile.avatar);
  const [email, setEmail] = useState(userProfile.email);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedAvatar = avatar.trim();
    const finalAvatar = isImageUrl(trimmedAvatar)
      ? trimmedAvatar
      : trimmedAvatar.charAt(0).toUpperCase() || (name.trim().charAt(0).toUpperCase() || 'U');

    updateProfile({
      name: name.trim(),
      username: username.trim(),
      bio: bio.trim(),
      avatar: finalAvatar,
      email: email.trim()
    });
    setEditModalOpen(false);
  };

  const activeFriends = friends.filter((f) => !f.requestPending && !f.isSuggestion);

  // Stats row values (server-authoritative, survive room cleanup).
  const hostedRoomsCount = useCountUp(roomStats?.hostedRooms ?? 0, 300);
  const watchedRoomsCount = useCountUp(roomStats?.joinedRooms ?? 0, 350);
  const watchTimeCount = useCountUp(roomStats?.totalWatchSeconds ?? 0, 400);
  const activeFriendsCount = useCountUp(activeFriends.length, 300);

  const formatWatchTime = (seconds: number) => {
    if (seconds <= 0) return '0m';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return `${seconds}s`;
  };

  const formatRoomDate = (iso: string | null) => {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // A historical entry is still ACTIVE (joinable) only while its room appears
  // in the live room list without an emptySince marker. Expired rooms are
  // shown as ENDED — never as joinable.
  const activeRoomIds = new Set(rooms.filter((r) => !r.emptySince).map((r) => r.id));
  const recentRooms = roomStats?.recentRooms ?? [];

  // Watch history rendered from durable history (title/media fall back to the
  // room name; the mock watchHistory list is kept as a legacy fallback).
  const historyItems =
    recentRooms.length > 0
      ? recentRooms.map((r) => ({
          id: r.id,
          title: r.createdMediaTitle || r.roomName,
          poster: '',
          watchedAt: formatRoomDate(r.endedAt ?? r.createdAt),
          roomName: r.roomName,
          durationWatched: formatWatchTime(r.durationSeconds),
        }))
      : watchHistory;

  return (
    <div className="w-full min-w-0 text-[#EDEDEF] font-['Inter',sans-serif] select-none animate-fade-in-up px-5 md:px-10 pb-12">
      <div className="max-w-[1100px] mx-auto w-full min-w-0">
        {/* ─── 1. HEADER PROFILE INFO ───────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 pb-8 border-b border-white/[0.07] w-full">
        <div className="flex items-center gap-5">
          <UserAvatar
            avatar={userProfile.avatar}
            name={userProfile.name}
            className="w-16 h-16 text-2xl font-bold font-['Sora',sans-serif] shadow-[0_0_20px_rgba(246,184,208,0.25)] border-2 border-white/10"
          />

          <div>
            <h1 className="font-['Sora',sans-serif] text-2xl sm:text-3xl font-bold tracking-tight text-[#EDEDEF]">
              {userProfile.name || 'PraConnect User'}
            </h1>
            <div className="text-xs text-[#9A9AA2] font-mono mt-0.5">
              @{userProfile.username || 'user'}
            </div>
            <div className="text-xs text-[#5C5C64] mt-1">
              Joined {userProfile.joinedDate || 'recently'}
            </div>
          </div>
        </div>

        <button
          onClick={() => {
            setName(userProfile.name);
            setUsername(userProfile.username);
            setBio(userProfile.bio);
            setAvatar(userProfile.avatar);
            setEmail(userProfile.email);
            setEditModalOpen(true);
          }}
          className="btn-secondary text-xs px-4 py-2.5 self-start sm:self-auto shrink-0"
        >
          Edit Profile
        </button>
      </div>

      {/* ─── 2. STATS ROW ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 py-6 border-b border-white/[0.07] text-center w-full">
        <div>
          <div className="font-['Sora',sans-serif] text-xl font-bold text-[#EDEDEF]">{hostedRoomsCount}</div>
          <div className="text-[11px] text-[#5C5C64] uppercase tracking-wider font-semibold mt-1">Hosted Rooms</div>
        </div>
        <div>
          <div className="font-['Sora',sans-serif] text-xl font-bold text-[#EDEDEF]">{watchedRoomsCount}</div>
          <div className="text-[11px] text-[#5C5C64] uppercase tracking-wider font-semibold mt-1">Watched Rooms</div>
        </div>
        <div>
          <div className="font-['Sora',sans-serif] text-xl font-bold text-[#EDEDEF]">{formatWatchTime(watchTimeCount)}</div>
          <div className="text-[11px] text-[#5C5C64] uppercase tracking-wider font-semibold mt-1">Watch Time</div>
        </div>
        <div>
          <div className="font-['Sora',sans-serif] text-xl font-bold text-[#EDEDEF]">{activeFriendsCount}</div>
          <div className="text-[11px] text-[#5C5C64] uppercase tracking-wider font-semibold mt-1">Active Friends</div>
        </div>
      </div>

      {/* ─── 3. RECENT ROOMS (persistent history) ──────────────────────────── */}
      <div className="mt-10 w-full">
        <h2 className="text-[11px] font-bold tracking-widest uppercase text-[#9A9AA2] mb-4">
          Recent Rooms ({recentRooms.length})
        </h2>

        {recentRooms.length > 0 ? (
          <div className="divide-y divide-white/[0.07] border-t border-b border-white/[0.07] w-full">
            {recentRooms.map((room) => {
              const isActive = activeRoomIds.has(room.roomId);
              return (
                <div key={room.id} className="py-4 flex items-center justify-between interactive-row px-2 rounded-xl">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="font-['Sora',sans-serif] text-sm font-semibold text-[#EDEDEF] truncate">
                        {room.roomName}
                      </div>
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-[#17171A] border border-white/[0.07] shrink-0">
                        {room.role === 'host' ? 'HOSTED' : 'WATCHED'}
                      </span>
                    </div>
                    <div className="text-xs text-[#5C5C64] font-mono mt-0.5 truncate">
                      {room.roomCode} • {room.createdMediaTitle || room.category} • {formatWatchTime(room.durationSeconds)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-full border border-white/[0.07] ${
                        isActive ? 'bg-[#17171A] text-[#F6B8D0]' : 'text-[#5C5C64] bg-transparent'
                      }`}
                    >
                      {isActive ? 'ACTIVE' : 'ENDED'}
                    </span>
                    <span className="text-xs text-[#5C5C64] font-mono">{formatRoomDate(room.endedAt ?? room.createdAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-6 text-xs text-[#5C5C64]">
            No rooms hosted or watched yet.
          </div>
        )}
      </div>

      {/* ─── 4. WATCH HISTORY ─────────────────────────────────────────────── */}
      <div className="mt-10 w-full">
        <h2 className="text-[11px] font-bold tracking-widest uppercase text-[#9A9AA2] mb-4">
          Watch History ({historyItems.length})
        </h2>

        {historyItems.length > 0 ? (
          <div className="divide-y divide-white/[0.07] border-t border-b border-white/[0.07] w-full">
            {historyItems.map((item) => (
              <div key={item.id} className="py-4 flex items-center justify-between gap-4 interactive-row px-2 rounded-xl">
                <div className="flex items-center gap-3.5 min-w-0">
                  {item.poster ? (
                    <img
                      src={item.poster}
                      alt={item.title}
                      className="w-10 h-10 rounded-lg object-cover border border-white/[0.07] shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-[#17171A] border border-white/[0.07] flex items-center justify-center text-xs font-mono shrink-0">
                      📺
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="font-['Sora',sans-serif] text-sm font-semibold text-[#EDEDEF] truncate">{item.title}</div>
                    <div className="text-xs text-[#9A9AA2] mt-0.5 truncate">{item.roomName} • {item.durationWatched}</div>
                  </div>
                </div>
                <span className="text-xs text-[#5C5C64] font-mono shrink-0">{item.watchedAt}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-6 text-xs text-[#5C5C64]">
            No watch history recorded yet.
          </div>
        )}
      </div>

      {/* EDIT PROFILE MODAL */}
      {editModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-fade-in">
          <div className="w-full max-w-md bg-[#111113] border border-white/15 rounded-2xl p-6 relative shadow-2xl animate-modal-pop">
            <button
              onClick={() => setEditModalOpen(false)}
              className="absolute top-4 right-4 text-[#5C5C64] hover:text-[#EDEDEF] transition-colors cursor-pointer"
            >
              ✕
            </button>

            <h2 className="font-['Sora',sans-serif] text-base font-bold text-[#EDEDEF] mb-4">Edit Profile</h2>

            <form onSubmit={handleSave} className="space-y-4 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-[#9A9AA2] uppercase tracking-wider mb-1.5">Display Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full h-10 px-3.5 bg-transparent border border-white/15 rounded-[10px] text-xs text-[#EDEDEF] focus:outline-none focus:border-[#F6B8D0]"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#9A9AA2] uppercase tracking-wider mb-1.5">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-10 px-3.5 bg-transparent border border-white/15 rounded-[10px] text-xs text-[#EDEDEF] focus:outline-none focus:border-[#F6B8D0]"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#9A9AA2] uppercase tracking-wider mb-1.5">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full h-10 px-3.5 bg-transparent border border-white/15 rounded-[10px] text-xs text-[#EDEDEF] focus:outline-none focus:border-[#F6B8D0]"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#9A9AA2] uppercase tracking-wider mb-1.5">Avatar (Initial or Image URL)</label>
                <div className="flex items-center gap-3">
                  <UserAvatar
                    avatar={avatar}
                    name={name}
                    className="w-10 h-10 text-sm font-bold shadow-md"
                  />
                  <input
                    type="text"
                    placeholder="e.g. S or https://..."
                    value={avatar}
                    onChange={(e) => setAvatar(e.target.value)}
                    className="flex-1 h-10 px-3.5 bg-transparent border border-white/15 rounded-[10px] text-xs font-medium text-[#EDEDEF] focus:outline-none focus:border-[#F6B8D0]"
                  />
                </div>
              </div>

              <div className="pt-3 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  className="btn-secondary text-xs px-4 py-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary text-xs px-5 py-2"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  </div>
);
};
