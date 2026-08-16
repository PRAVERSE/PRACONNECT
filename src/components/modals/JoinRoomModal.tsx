import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';

export const JoinRoomModal: React.FC = () => {
  const { joinRoomModalOpen, setJoinRoomModalOpen, joinRoom } = useApp();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  if (!joinRoomModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    const success = await joinRoom(code.trim());
    if (success) {
      setJoinRoomModalOpen(false);
      setCode('');
      setError('');
    } else {
      setError('Invalid room code or room is unavailable/full.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 select-none animate-fade-in">
      <div className="w-full max-w-sm float-surface p-6 relative text-[var(--text-primary)] pop-in">
        <button
          onClick={() => setJoinRoomModalOpen(false)}
          className="absolute top-4 right-4 text-[#5C5C64] hover:text-[#EDEDEF] transition-colors cursor-pointer"
        >
          ✕
        </button>

        <h2 className="font-['Sora',sans-serif] text-base font-bold text-[#EDEDEF] mb-1">
          Join Room
        </h2>
        <p className="text-xs text-[#9A9AA2] mb-5">
          Enter a room code to join a live hangout.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-[#9A9AA2] uppercase tracking-wider mb-1.5">
              Room Code
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setError('');
              }}
              placeholder="e.g. movie-4921"
              required
              className="field w-full text-[13px]"
            />
            {error && <p className="text-xs text-[#EF4444] mt-1.5 font-medium">{error}</p>}
          </div>

          <div className="pt-3 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setJoinRoomModalOpen(false)}
              className="btn-secondary text-xs px-4 py-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary text-xs px-5 py-2"
            >
              Join Room →
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
