import React, { useState } from 'react';
import { Award, Flame, Tv, Gamepad2, Users, Star, Lock, Sparkles } from 'lucide-react';
import { WinCelebration } from '../common/WinCelebration';

export interface AchievementBadge {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  category: string;
  unlocked: boolean;
  unlockedAt?: string;
  progress: number;
  total: number;
}

export const INITIAL_ACHIEVEMENTS: AchievementBadge[] = [
  {
    id: 'ach-1',
    title: 'Watch Party Host',
    description: 'Host your first live watch room with friends.',
    icon: <Tv className="w-5 h-5 text-[var(--text-primary)]" />,
    category: 'Watch Rooms',
    unlocked: false,
    progress: 0,
    total: 1
  },
  {
    id: 'ach-2',
    title: 'Arcade Champion',
    description: 'Win 3 Tic-Tac-Toe matches in the Games Hub.',
    icon: <Gamepad2 className="w-5 h-5 text-[var(--text-primary)]" />,
    category: 'Games',
    unlocked: false,
    progress: 0,
    total: 3
  },
  {
    id: 'ach-3',
    title: 'Squad Leader',
    description: 'Connect with 5 or more friends in the directory.',
    icon: <Users className="w-5 h-5 text-[var(--text-primary)]" />,
    category: 'Social',
    unlocked: false,
    progress: 0,
    total: 5
  },
  {
    id: 'ach-4',
    title: '3-Week Streak Flame',
    description: 'Maintain a 3-week hangout streak with a friend.',
    icon: <Flame className="w-5 h-5 text-[var(--text-primary)]" />,
    category: 'Streaks',
    unlocked: false,
    progress: 0,
    total: 3
  },
  {
    id: 'ach-5',
    title: 'Movie Marathoner',
    description: 'Accumulate 10 total hours in watch rooms.',
    icon: <Award className="w-5 h-5 text-[var(--text-secondary)]" />,
    category: 'Watch Rooms',
    unlocked: false,
    progress: 0,
    total: 10
  },
  {
    id: 'ach-6',
    title: 'Reaction Superstar',
    description: 'Send 50 live emoji reactions during streams.',
    icon: <Star className="w-5 h-5 text-[var(--text-secondary)]" />,
    category: 'Social',
    unlocked: false,
    progress: 0,
    total: 50
  }
];

export const AchievementsBadgeList: React.FC = () => {
  const [achievements, setAchievements] = useState<AchievementBadge[]>(INITIAL_ACHIEVEMENTS);
  const [triggerCelebration, setTriggerCelebration] = useState(false);

  const handleClaimUnlock = (id: string) => {
    setAchievements((prev) =>
      prev.map((a) =>
        a.id === id ? { ...a, unlocked: true, unlockedAt: 'Just Now', progress: a.total } : a
      )
    );
    setTriggerCelebration(true);
    setTimeout(() => {
      setTriggerCelebration(false);
    }, 2000);
  };

  return (
    <div className="space-y-4">
      <WinCelebration active={triggerCelebration} />

      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
        <div className="flex items-center gap-2">
          <Award className="w-5 h-5 text-[var(--text-primary)]" />
          <h3 className="text-base font-bold text-[var(--text-primary)] font-heading">
            Unlocked Badges & Milestones
          </h3>
        </div>
        <span className="text-xs font-mono font-bold text-[var(--text-primary)] bg-[var(--bg-elevated)] px-2.5 py-1 rounded-full border border-[var(--border-strong)]">
          {achievements.filter((a) => a.unlocked).length} / {achievements.length} Badges
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {achievements.map((badge) => (
          <div
            key={badge.id}
            className={`p-4 rounded-2xl border transition-all relative overflow-hidden group ${
              badge.unlocked
                ? 'bg-[var(--bg-surface)] border-[var(--border-strong)] shadow-sm'
                : 'bg-[var(--bg-canvas)] border-[var(--border-subtle)] opacity-60 hover:opacity-80'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="p-2.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
                {badge.icon}
              </div>

              {badge.unlocked ? (
                <span className="px-2 py-0.5 rounded-full bg-[var(--control-primary-bg)] text-[var(--control-primary-text)] text-[9px] font-extrabold uppercase font-mono">
                  Unlocked
                </span>
              ) : (
                <span className="p-1 rounded-full bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                  <Lock className="w-3 h-3" />
                </span>
              )}
            </div>

            <div className="mt-3 space-y-1">
              <h4 className="text-sm font-bold text-[var(--text-primary)] font-heading">{badge.title}</h4>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed line-clamp-2">{badge.description}</p>
            </div>

            <div className="mt-3 pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between text-[10px] font-mono">
              {badge.unlocked ? (
                <span className="text-[var(--text-secondary)]">Date: {badge.unlockedAt}</span>
              ) : (
                <div className="w-full space-y-1">
                  <div className="flex justify-between text-[var(--text-muted)]">
                    <span>Progress</span>
                    <span>
                      {badge.progress} / {badge.total}
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                    <div
                      className="h-full bg-[var(--text-primary)] transition-all duration-300"
                      style={{ width: `${(badge.progress / badge.total) * 100}%` }}
                    />
                  </div>
                  {badge.progress >= badge.total && (
                    <button
                      onClick={() => handleClaimUnlock(badge.id)}
                      className="mt-1 w-full h-6 bg-[var(--control-primary-bg)] text-[var(--control-primary-text)] font-bold rounded flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Sparkles className="w-3 h-3" /> Claim Unlock
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
