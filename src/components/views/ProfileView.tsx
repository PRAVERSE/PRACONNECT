import React, { useEffect, useState } from 'react';
import { Pencil, X, Video, AlertCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { UserAvatar, isImageUrl } from '../common/UserAvatar';
import { GlassPanel } from '../common/GlassPanel';
import { SectionLabel } from '../common/SectionLabel';

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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editModalOpen) {
      setName(userProfile.name);
      setUsername(userProfile.username);
      setBio(userProfile.bio);
      setAvatar(userProfile.avatar);
      setEmail(userProfile.email);
      setSaveError(null);
    }
  }, [editModalOpen, userProfile]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setSaving(true);
    const trimmedAvatar = avatar.trim();
    const finalAvatar = isImageUrl(trimmedAvatar)
      ? trimmedAvatar
      : trimmedAvatar.charAt(0).toUpperCase() || (name.trim().charAt(0).toUpperCase() || 'U');

    const res = await updateProfile({
      name: name.trim(),
      username: username.trim(),
      bio: bio.trim(),
      avatar: finalAvatar,
    });
    setSaving(false);
    if (res && !res.ok) {
      setSaveError(res.error || 'Failed to save profile changes.');
      return;
    }
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
  // shown as ENDED — never as joinable. Empty rooms inside the 5-minute
  // rejoin window are still joinable, so they stay ACTIVE until the window
  // closes (the server excludes expired rooms from the listing entirely).
  const activeRoomIds = new Set(rooms.filter((r) => !r.emptySince || r.isRejoinable).map((r) => r.id));
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
    <div className="w-full min-w-0 text-[var(--text-primary)] font-['Inter',sans-serif] select-none pb-12">
      <div className="w-full min-w-0">
        {/* ─── 1. HEADER PROFILE INFO ────────────────────────────────────────── */}
        <header
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 pb-8 border-b border-[var(--border-hairline)] w-full"
          style={{ animation: 'rise 640ms var(--ease) both' }}
        >
          <div className="flex items-center gap-5">
            <UserAvatar
              avatar={userProfile.avatar}
              name={userProfile.name}
              className="w-16 h-16 text-2xl font-bold font-display shadow-[0_0_24px_rgba(255,255,255,0.08)] border-2 border-[var(--border-hairline)]"
            />

            <div>
              <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text-primary)]">
                {userProfile.name || 'PraConnect User'}
              </h1>
              <div className="text-xs text-[var(--text-secondary)] font-mono mt-0.5">
                @{userProfile.username || 'user'}
              </div>
              <div className="text-xs text-[var(--text-tertiary)] mt-1 font-mono">
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
            className="btn-secondary text-xs px-4 py-2 self-start sm:self-auto shrink-0"
          >
            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Edit Profile</span>
          </button>
        </header>

        {/* ─── 2. STATS ROW (GlassPanel cards matching Home) ────────────────── */}
        <div
          className="grid grid-cols-2 md:grid-cols-4 gap-4 py-8 border-b border-[var(--border-hairline)] w-full"
          style={{ animation: 'rise 640ms var(--ease) 150ms both' }}
        >
          <GlassPanel className="p-4 text-center" hover>
            <div className="font-display text-2xl font-bold text-[var(--text-primary)]">
              {hostedRoomsCount}
            </div>
            <div className="text-[11px] text-[var(--text-secondary)] font-mono uppercase tracking-[0.08em] mt-1">
              Hosted Rooms
            </div>
          </GlassPanel>

          <GlassPanel className="p-4 text-center" hover>
            <div className="font-display text-2xl font-bold text-[var(--text-primary)]">
              {watchedRoomsCount}
            </div>
            <div className="text-[11px] text-[var(--text-secondary)] font-mono uppercase tracking-[0.08em] mt-1">
              Watched Rooms
            </div>
          </GlassPanel>

          <GlassPanel className="p-4 text-center" hover>
            <div className="font-display text-2xl font-bold text-[var(--text-primary)]">
              {formatWatchTime(watchTimeCount)}
            </div>
            <div className="text-[11px] text-[var(--text-secondary)] font-mono uppercase tracking-[0.08em] mt-1">
              Watch Time
            </div>
          </GlassPanel>

          <GlassPanel className="p-4 text-center" hover>
            <div className="font-display text-2xl font-bold text-[var(--text-primary)]">
              {activeFriendsCount}
            </div>
            <div className="text-[11px] text-[var(--text-secondary)] font-mono uppercase tracking-[0.08em] mt-1">
              Active Friends
            </div>
          </GlassPanel>
        </div>

        {/* ─── 3. RECENT ROOMS (persistent history) ──────────────────────────── */}
        <section className="mt-10 w-full" style={{ animation: 'rise 640ms var(--ease) 250ms both' }}>
          <SectionLabel count={recentRooms.length}>
            Recent Rooms
          </SectionLabel>

          {recentRooms.length > 0 ? (
            <div className="divide-y divide-[var(--border-hairline)] border-t border-b border-[var(--border-hairline)] w-full">
              {recentRooms.map((room) => {
                const isActive = activeRoomIds.has(room.roomId);
                return (
                  <div key={room.id} className="py-4 flex items-center justify-between interactive-row px-2 rounded-xl">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="font-display text-sm font-semibold text-[var(--text-primary)] truncate">
                          {room.roomName}
                        </div>
                        <span className="pill-glass text-[10px] font-mono font-medium px-2 py-0.5 uppercase tracking-[0.06em] text-[var(--text-secondary)] shrink-0">
                          {room.role === 'host' ? 'HOSTED' : 'WATCHED'}
                        </span>
                      </div>
                      <div className="text-xs text-[var(--text-tertiary)] font-mono mt-0.5 truncate">
                        {room.roomCode} • {room.createdMediaTitle || room.category} • {formatWatchTime(room.durationSeconds)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <span
                        className={`pill-glass text-[10px] font-mono font-bold px-2.5 py-0.5 uppercase tracking-[0.06em] ${
                          isActive ? 'text-[var(--emphasis)]' : 'text-[var(--text-tertiary)]'
                        }`}
                      >
                        {isActive ? 'ACTIVE' : 'ENDED'}
                      </span>
                      <span className="text-xs text-[var(--text-tertiary)] font-mono">{formatRoomDate(room.endedAt ?? room.createdAt)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-6 text-xs text-[var(--text-tertiary)] font-mono">
              No rooms hosted or watched yet.
            </div>
          )}
        </section>

        {/* ─── 4. WATCH HISTORY ─────────────────────────────────────────────── */}
        <section className="mt-10 w-full" style={{ animation: 'rise 640ms var(--ease) 320ms both' }}>
          <SectionLabel count={historyItems.length}>
            Watch History
          </SectionLabel>

          {historyItems.length > 0 ? (
            <div className="divide-y divide-[var(--border-hairline)] border-t border-b border-[var(--border-hairline)] w-full">
              {historyItems.map((item) => (
                <div key={item.id} className="py-4 flex items-center justify-between gap-4 interactive-row px-2 rounded-xl">
                  <div className="flex items-center gap-3.5 min-w-0">
                    {item.poster ? (
                      <img
                        src={item.poster}
                        alt={item.title}
                        className="w-10 h-10 rounded-lg object-cover border border-[var(--border-hairline)] shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-[var(--bg-glass)] border border-[var(--border-hairline)] flex items-center justify-center text-xs text-[var(--text-tertiary)] shrink-0">
                        <Video className="w-4 h-4" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="font-display text-sm font-semibold text-[var(--text-primary)] truncate">{item.title}</div>
                      <div className="text-xs text-[var(--text-secondary)] mt-0.5 truncate">{item.roomName} • {item.durationWatched}</div>
                    </div>
                  </div>
                  <span className="text-xs text-[var(--text-tertiary)] font-mono shrink-0">{item.watchedAt}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-6 text-xs text-[var(--text-tertiary)] font-mono">
              No watch history recorded yet.
            </div>
          )}
        </section>

        {/* EDIT PROFILE MODAL — float-surface */}
        {editModalOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-profile-title"
            onClick={() => setEditModalOpen(false)}
          >
            <div
              className="w-full max-w-md float-surface p-6 relative pop-in"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 id="edit-profile-title" className="font-display text-base font-bold text-[var(--text-primary)]">
                  Edit Profile
                </h2>
                <button
                  onClick={() => setEditModalOpen(false)}
                  className="p-1 rounded-full text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-glass)] transition-colors cursor-pointer"
                  aria-label="Close modal"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {saveError && (
                <div className="p-3 mb-4 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{saveError}</span>
                </div>
              )}

              <form onSubmit={handleSave} className="space-y-4 text-xs">
                <div>
                  <label className="block text-[11px] font-mono font-medium text-[var(--text-secondary)] uppercase tracking-[0.08em] mb-1.5">
                    Display Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="field w-full h-10 px-3.5 text-xs text-[var(--text-primary)]"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-mono font-medium text-[var(--text-secondary)] uppercase tracking-[0.08em] mb-1.5">
                    Username
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="field w-full h-10 px-3.5 text-xs text-[var(--text-primary)]"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-mono font-medium text-[var(--text-secondary)] uppercase tracking-[0.08em] mb-1.5">
                    Bio (Optional)
                  </label>
                  <textarea
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="Tell your squad about yourself..."
                    rows={2}
                    maxLength={500}
                    className="field w-full p-2.5 text-xs text-[var(--text-primary)] resize-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-mono font-medium text-[var(--text-secondary)] uppercase tracking-[0.08em] mb-1.5">
                    Email Address (Private)
                  </label>
                  <input
                    type="email"
                    value={email}
                    disabled
                    title="Email is private and linked to your login credentials"
                    className="field w-full h-10 px-3.5 text-xs text-[var(--text-tertiary)] opacity-60 cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-mono font-medium text-[var(--text-secondary)] uppercase tracking-[0.08em] mb-1.5">
                    Avatar (Initial or Image URL)
                  </label>
                  <div className="flex items-center gap-3">
                    <UserAvatar
                      avatar={avatar}
                      name={name}
                      className="w-10 h-10 text-sm font-bold shadow-md shrink-0"
                    />
                    <input
                      type="text"
                      placeholder="e.g. S or https://..."
                      value={avatar}
                      onChange={(e) => setAvatar(e.target.value)}
                      className="field flex-1 h-10 px-3.5 text-xs text-[var(--text-primary)]"
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
                    disabled={saving}
                    className="btn-primary text-xs px-5 py-2 disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Save Changes'}
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
