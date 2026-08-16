import React, { useState } from 'react';
import { BarChart3, CheckCircle2, Plus, Sparkles, X } from 'lucide-react';

export interface PollOption {
  id: string;
  text: string;
  votes: number;
}

export interface RoomPollData {
  id: string;
  question: string;
  options: PollOption[];
  totalVotes: number;
  votedOptionId?: string;
  createdByName: string;
}

interface RoomPollProps {
  poll: RoomPollData | null;
  isHost: boolean;
  onCreatePoll: (question: string, options: string[]) => void;
  onVote: (optionId: string) => void;
  onClosePoll: () => void;
}

export const RoomPoll: React.FC<RoomPollProps> = ({
  poll,
  isHost,
  onCreatePoll,
  onVote,
  onClosePoll
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [question, setQuestion] = useState('What should we watch next?');
  const [options, setOptions] = useState<string[]>([
    'Inception (Sci-Fi Classic)',
    'Spider-Man: Across the Spider-Verse',
    'Arcane Season 2 Highlights'
  ]);

  const handleAddOption = () => {
    if (options.length < 5) {
      setOptions([...options, '']);
    }
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validOptions = options.filter((o) => o.trim().length > 0);
    if (question.trim() && validOptions.length >= 2) {
      onCreatePoll(question, validOptions);
      setIsCreating(false);
    }
  };

  if (!poll && !isCreating) {
    if (!isHost) return null;
    return (
      <button
        onClick={() => setIsCreating(true)}
        className="px-3.5 h-9 bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] border border-[var(--border-strong)] text-[var(--text-primary)] text-xs font-bold rounded-xl transition-colors flex items-center gap-2 cursor-pointer shadow-sm"
      >
        <BarChart3 className="w-4 h-4 text-[var(--text-primary)]" />
        Create Watch Poll
      </button>
    );
  }

  if (isCreating) {
    return (
      <div className="w-full max-w-md p-5 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-strong)] space-y-4 shadow-xl text-[var(--text-primary)]">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
          <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-primary)] font-heading">
            <BarChart3 className="w-4 h-4 text-[var(--text-primary)]" />
            <span>Create Live Room Poll</span>
          </div>
          <button onClick={() => setIsCreating(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleCreateSubmit} className="space-y-3">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Poll question..."
            className="w-full h-9 px-3 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-strong)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--text-primary)]"
          />

          <div className="space-y-2">
            {options.map((opt, idx) => (
              <input
                key={idx}
                type="text"
                value={opt}
                onChange={(e) => {
                  const updated = [...options];
                  updated[idx] = e.target.value;
                  setOptions(updated);
                }}
                placeholder={`Option ${idx + 1}...`}
                className="w-full h-8 px-3 rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--text-primary)]"
              />
            ))}
          </div>

          <div className="flex items-center justify-between pt-1">
            {options.length < 5 && (
              <button
                type="button"
                onClick={handleAddOption}
                className="text-xs text-[var(--text-primary)] hover:underline flex items-center gap-1 font-bold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Option
              </button>
            )}

            <button
              type="submit"
              className="px-4 h-8 bg-[var(--control-primary-bg)] text-[var(--control-primary-text)] text-xs font-extrabold rounded-xl ml-auto cursor-pointer"
            >
              Launch Poll
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (!poll) return null;

  return (
    <div className="w-full max-w-md p-5 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-strong)] space-y-4 shadow-xl relative overflow-hidden text-[var(--text-primary)]">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[var(--text-primary)]" />
          <h4 className="text-xs font-extrabold text-[var(--text-primary)] font-heading">{poll.question}</h4>
        </div>
        {isHost && (
          <button onClick={onClosePoll} className="text-[var(--text-muted)] hover:text-[var(--status-error)] text-[10px] font-bold uppercase cursor-pointer">
            End Poll
          </button>
        )}
      </div>

      <p className="text-[10px] text-[var(--text-secondary)] font-mono">
        Host: {poll.createdByName} &bull; Total votes: {poll.totalVotes}
      </p>

      {/* Animated Poll Options Bars */}
      <div className="space-y-2">
        {poll.options.map((option) => {
          const percentage = poll.totalVotes > 0 ? Math.round((option.votes / poll.totalVotes) * 100) : 0;
          const isSelected = poll.votedOptionId === option.id;

          return (
            <button
              key={option.id}
              onClick={() => onVote(option.id)}
              className={`w-full relative p-3 rounded-xl border text-left transition-all overflow-hidden group cursor-pointer ${
                isSelected
                  ? 'border-[var(--border-strong)] bg-[var(--bg-elevated)] font-bold'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-canvas)] hover:border-[var(--border-strong)]'
              }`}
            >
              {/* Animated Progress Bar Fill */}
              <div
                className="absolute inset-y-0 left-0 bg-[var(--bg-elevated)] opacity-60 transition-all duration-500 ease-out pointer-events-none"
                style={{ width: `${percentage}%` }}
              />

              <div className="relative z-10 flex items-center justify-between text-xs">
                <span className="font-medium text-[var(--text-primary)] flex items-center gap-1.5 truncate">
                  {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-[var(--text-primary)] shrink-0" />}
                  {option.text}
                </span>

                <span className="font-mono font-bold text-[var(--text-primary)] ml-2 shrink-0">
                  {percentage}% ({option.votes})
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
