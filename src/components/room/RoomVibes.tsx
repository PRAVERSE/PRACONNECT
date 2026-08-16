import React, { useState } from 'react';
import { Palette, Sparkles, Moon, Flame, Ghost, Gamepad } from 'lucide-react';

export type RoomVibeType = 'Chill' | 'Hype' | 'Horror Night' | 'Retro Arcade' | 'Cozy Lounge';

export interface RoomVibePreset {
  name: RoomVibeType;
  icon: React.ReactNode;
  accentColor: string;
  gradient: string;
  bgGlow: string;
}

export const VIBE_PRESETS: RoomVibePreset[] = [
  {
    name: 'Chill',
    icon: <Moon className="w-3.5 h-3.5 text-[var(--text-primary)]" />,
    accentColor: '#3B82F6',
    gradient: 'from-[#1E3A8A] to-[#0A0D18]',
    bgGlow: 'rgba(59, 130, 246, 0.2)'
  },
  {
    name: 'Hype',
    icon: <Flame className="w-3.5 h-3.5 text-[var(--text-primary)]" />,
    accentColor: '#F59E0B',
    gradient: 'from-[#78350F] to-[#0A0D18]',
    bgGlow: 'rgba(245, 158, 11, 0.25)'
  },
  {
    name: 'Horror Night',
    icon: <Ghost className="w-3.5 h-3.5 text-[var(--text-primary)]" />,
    accentColor: '#EF4444',
    gradient: 'from-[#450A0A] to-[#0A0D18]',
    bgGlow: 'rgba(239, 68, 68, 0.25)'
  },
  {
    name: 'Retro Arcade',
    icon: <Gamepad className="w-3.5 h-3.5 text-[var(--text-primary)]" />,
    accentColor: '#EC4899',
    gradient: 'from-[#831843] to-[#0A0D18]',
    bgGlow: 'rgba(236, 72, 153, 0.25)'
  },
  {
    name: 'Cozy Lounge',
    icon: <Sparkles className="w-3.5 h-3.5 text-[var(--text-primary)]" />,
    accentColor: '#10B981',
    gradient: 'from-[#064E3B] to-[#0A0D18]',
    bgGlow: 'rgba(16, 185, 129, 0.2)'
  }
];

interface RoomVibesProps {
  currentVibe: RoomVibeType;
  onSelectVibe: (vibe: RoomVibeType) => void;
  isHost: boolean;
}

export const RoomVibes: React.FC<RoomVibesProps> = ({
  currentVibe,
  onSelectVibe,
  isHost
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 h-8 bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] border border-[var(--border-strong)] text-xs text-[var(--text-primary)] font-bold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer"
      >
        <Palette className="w-3.5 h-3.5 text-[var(--text-primary)]" />
        <span>Vibe: {currentVibe}</span>
      </button>

      {isOpen && (
        <div className="absolute top-10 right-0 z-50 w-52 p-2 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-strong)] shadow-2xl space-y-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] px-2 py-1">
            Select Room Mood
          </div>

          {VIBE_PRESETS.map((preset) => {
            const isSelected = currentVibe === preset.name;
            return (
              <button
                key={preset.name}
                disabled={!isHost}
                onClick={() => {
                  onSelectVibe(preset.name);
                  setIsOpen(false);
                }}
                className={`w-full px-2.5 py-1.5 rounded-xl text-xs font-medium flex items-center justify-between transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-[var(--bg-elevated)] font-bold text-[var(--text-primary)] border border-[var(--border-strong)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
                } ${!isHost ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className="flex items-center gap-2">
                  {preset.icon}
                  <span>{preset.name}</span>
                </div>
                {isSelected && (
                  <span className="w-2 h-2 rounded-full bg-[var(--text-primary)]" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
