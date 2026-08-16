import React from 'react';
import { Trophy, Film, Users, Sparkles, X, Heart, Smile, ThumbsUp } from 'lucide-react';

export interface RecapData {
  roomName: string;
  durationWatched: string;
  mediaWatched: string;
  poster?: string;
  attendeesCount: number;
  topReactions: string[];
  totalReactions: number;
}

interface WatchPartyRecapModalProps {
  isOpen: boolean;
  onClose: () => void;
  recapData: RecapData;
}

export const WatchPartyRecapModal: React.FC<WatchPartyRecapModalProps> = ({
  isOpen,
  onClose,
  recapData
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fadeIn select-none">
      <div className="w-full max-w-md bg-[var(--bg-surface-1)] border border-[var(--border-strong)] rounded-3xl p-6 shadow-2xl relative space-y-5 transform transition-all animate-toast-in text-[var(--text-primary)]">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] p-1 rounded-full hover:bg-[var(--bg-surface-2)] transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header Badge */}
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-[var(--accent-subtle)] text-[var(--accent)] border border-[var(--accent)]/30 text-[10px] font-extrabold rounded-full uppercase tracking-wider flex items-center gap-1.5 font-mono">
            <Trophy className="w-3.5 h-3.5" />
            Watch Session Recap
          </span>
        </div>

        <div className="space-y-1">
          <h2 className="text-2xl font-black text-[var(--text-primary)] font-heading">{recapData.roomName}</h2>
          <p className="text-xs text-[var(--text-secondary)]">Session highlight stats and community activity</p>
        </div>

        {/* Media Poster & Stats Grid */}
        <div className="p-4 rounded-2xl bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] flex gap-4 items-center">
          <img
            src={
              recapData.poster ||
              'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=800&q=80'
            }
            alt=""
            className="w-16 h-20 rounded-xl object-cover shrink-0 border border-[var(--border-strong)] shadow-xs"
          />
          <div className="space-y-1">
            <div className="text-xs text-[var(--text-tertiary)] font-bold uppercase tracking-wider flex items-center gap-1">
              <Film className="w-3.5 h-3.5 text-[var(--accent)]" />
              Featured Media
            </div>
            <div className="text-sm font-extrabold text-[var(--text-primary)] line-clamp-1 font-heading">{recapData.mediaWatched}</div>
            <div className="text-xs text-[var(--text-secondary)] font-mono">Watched for {recapData.durationWatched}</div>
          </div>
        </div>

        {/* Metrics Row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3.5 rounded-xl bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] font-medium">
              <Users className="w-3.5 h-3.5 text-[var(--status-success)]" />
              <span>Watch Squad</span>
            </div>
            <div className="text-xl font-black text-[var(--text-primary)] font-heading">{recapData.attendeesCount} People</div>
          </div>

          <div className="p-3.5 rounded-xl bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] font-medium">
              <Sparkles className="w-3.5 h-3.5 text-[var(--accent)]" />
              <span>Total Reactions</span>
            </div>
            <div className="text-xl font-black text-[var(--text-primary)] font-heading">{recapData.totalReactions} Sent</div>
          </div>
        </div>

        {/* Top Reactions Floating Row */}
        <div className="space-y-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">
            Top Group Reactions
          </div>
          <div className="flex items-center gap-2">
            {recapData.topReactions.map((emoji, idx) => (
              <span
                key={idx}
                className="px-3 py-1.5 rounded-xl bg-[var(--bg-surface-3)] border border-[var(--border-strong)] text-lg shadow-2xs"
              >
                {emoji}
              </span>
            ))}
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full h-10 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-bold rounded-xl shadow-md transition-all cursor-pointer"
        >
          Close Recap & Return to Hub
        </button>
      </div>
    </div>
  );
};
