import React from 'react';
import {
  KeyRound,
  Calendar,
  Users,
  Plus,
  ArrowRight,
  Sparkles
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { StatPills } from '../common/StatPills';

export const DashboardView: React.FC = () => {
  const {
    userProfile,
    joinRoom,
    setCreateRoomModalOpen,
    setJoinRoomModalOpen,
    setScheduleModalOpen,
    setActiveTab,
    scheduledParties,
  } = useApp();

  // Dynamic time-of-day greeting
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const displayName = userProfile.name
    ? userProfile.name.split(' ')[0]
    : userProfile.username
    ? userProfile.username
    : 'Friend';

  return (
    <div className="w-full text-[var(--text-primary)] font-['Inter',sans-serif] select-none">
      {/* ─── HERO ───────────────────────────────────────────────────────────── */}
      <section className="flex flex-col lg:flex-row lg:items-start justify-between gap-8">
        <div className="min-w-0 max-w-[620px]">
          <span
            className="pill-glass inline-flex items-center gap-2 px-3.5 py-1.5 text-[11px] font-mono font-medium uppercase tracking-[0.08em] text-[var(--text-secondary)] mb-5 rise"
            style={{ animationDelay: '0ms' }}
          >
            <Sparkles className="w-3.5 h-3.5 text-[var(--text-secondary)]" aria-hidden="true" />
            Watch together in high fidelity
          </span>

          <h1
            className="font-display font-bold tracking-[-0.02em] text-[clamp(2.4rem,4.4vw,3.4rem)] leading-[1.08] mb-5 rise"
            style={{ animationDelay: '80ms' }}
          >
            {getGreeting()},{' '}
            <span className="relative inline-block">
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[0.9em] bg-[radial-gradient(ellipse,var(--emphasis-dim)_0%,transparent_70%)] blur-[14px]"
              />
              <span className="relative text-[var(--text-primary)]">{displayName}</span>
            </span>
          </h1>

          <p
            className="text-[15px] leading-relaxed text-[var(--text-secondary)] max-w-[520px] mb-7 rise"
            style={{ animationDelay: '150ms' }}
          >
            Synchronize videos, play 3D games, or hang out in private rooms with your circle.
          </p>

          {/* 4-Tier Button Hierarchy: 1 primary · 1 secondary · 2 ghost */}
          <div className="flex flex-wrap items-center gap-3 rise" style={{ animationDelay: '220ms' }}>
            <button
              onClick={() => setCreateRoomModalOpen(true)}
              className="btn-primary text-sm"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>Create live room</span>
            </button>

            <button
              onClick={() => setJoinRoomModalOpen(true)}
              className="btn-secondary text-sm"
            >
              <KeyRound className="w-4 h-4" aria-hidden="true" />
              <span>Join with code</span>
            </button>

            <button
              onClick={() => setScheduleModalOpen(true)}
              className="btn-ghost text-sm"
            >
              <Calendar className="w-4 h-4" aria-hidden="true" />
              <span>Schedule pass</span>
            </button>

            <button
              onClick={() => setActiveTab('friends')}
              className="btn-ghost text-sm"
            >
              <Users className="w-4 h-4" aria-hidden="true" />
              <span>Friends</span>
            </button>
          </div>
        </div>

        {/* Stat indicators — glass pills, top-right */}
        <div className="rise" style={{ animationDelay: '220ms' }}>
          <StatPills />
        </div>
      </section>

      <div className="divider" />

      {/* ─── EXPLORE LIVE ROOMS ROW ────────────────────────────────────────── */}
      <section className="rise" style={{ animationDelay: '300ms' }}>
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow mb-2.5">Explore live rooms</p>
            <h2 className="font-display text-[19px] sm:text-[21px] font-semibold tracking-[-0.02em] mb-1.5">
              Find your next watch party
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed max-w-[520px]">
              Discover active rooms hosted by the community or start your own public hangout.
            </p>
          </div>

          <button
            onClick={() => setActiveTab('explore')}
            className="arrow-link shrink-0"
          >
            <span>Browse rooms</span>
            <ArrowRight className="w-4 h-4 arrow-glyph" aria-hidden="true" />
          </button>
        </div>
      </section>

      <div className="divider" />

      {/* ─── SCHEDULED WATCH PARTIES ───────────────────────────────────────── */}
      <section className="rise" style={{ animationDelay: '380ms' }}>
        <div className="flex items-center justify-between gap-4 mb-5">
          <p className="eyebrow">Scheduled watch parties</p>
          {scheduledParties.length > 0 && (
            <button onClick={() => setScheduleModalOpen(true)} className="arrow-link">
              <span>+ Schedule</span>
              <Calendar className="w-3.5 h-3.5 arrow-glyph" aria-hidden="true" />
            </button>
          )}
        </div>

        {scheduledParties.length > 0 ? (
          <div className="w-full">
            {scheduledParties.map((party, i) => (
              <div
                key={party.id}
                className={`flex items-center justify-between gap-3 py-4 group ${
                  i > 0 ? 'border-t border-[var(--border-hairline)]' : ''
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-primary)] live-dot shadow-[0_0_6px_var(--emphasis-glow)] shrink-0" />
                    <span className="font-display text-sm font-semibold text-[var(--text-primary)] truncate">
                      {party.title}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--text-tertiary)] mt-1 font-mono">
                    {party.scheduledFor} · host {party.hostName}
                  </div>
                </div>
                <button
                  onClick={() => joinRoom(party.roomCode)}
                  className="btn-secondary text-xs px-4 py-2 shrink-0"
                >
                  Join
                </button>
              </div>
            ))}
          </div>
        ) : (
          /* Inline empty state — left-aligned within the row */
          <div className="py-2">
            <h3 className="font-display text-[15px] font-semibold mb-1">
              Nothing scheduled yet
            </h3>
            <p className="text-sm text-[var(--text-tertiary)] mb-3 max-w-[440px] leading-relaxed">
              Plan a party so your squad knows when to show up.
            </p>
            <button onClick={() => setScheduleModalOpen(true)} className="arrow-link">
              <span>+ Plan a party</span>
              <Calendar className="w-3.5 h-3.5 arrow-glyph" aria-hidden="true" />
            </button>
          </div>
        )}
      </section>
    </div>
  );
};