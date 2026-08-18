import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { RoomPrivacy } from '../../types';

export const CreateRoomModal: React.FC = () => {
  const { createRoomModalOpen, setCreateRoomModalOpen, createRoom } = useApp();

  const [name, setName] = useState('');
  const [privacy, setPrivacy] = useState<RoomPrivacy>('public');
  const [maxMembers, setMaxMembers] = useState(8);
  const [description, setDescription] = useState('');

  const [error, setError] = useState('');

  if (!createRoomModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError('');
    const room = await createRoom({
      name: name.trim(),
      category: 'Movie',
      privacy,
      maxMembers: Number(maxMembers),
      description: description.trim()
    });
    if (room) {
      setCreateRoomModalOpen(false);
      setName('');
      setDescription('');
    } else {
      setError('Failed to create room. Please try again.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 select-none animate-fade-in">
      <div className="w-full max-w-md float-surface p-6 relative text-[var(--text-primary)] pop-in">
        <button
          onClick={() => setCreateRoomModalOpen(false)}
          className="absolute top-4 right-4 text-[#5C5C64] hover:text-[#EDEDEF] transition-colors cursor-pointer"
        >
          ✕
        </button>

        <h2 className="font-['Sora',sans-serif] text-base font-bold text-[#EDEDEF] mb-1">
          Create Room
        </h2>
        <p className="text-xs text-[#9A9AA2] mb-5">
          Set up a live space for your squad to hang out.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-[#9A9AA2] uppercase tracking-wider mb-1.5">
              Room Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Suman's Watch Room"
              required
              className="field w-full text-[13px]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-[#9A9AA2] uppercase tracking-wider mb-1.5">Privacy</label>
              <select
                value={privacy}
                onChange={(e) => setPrivacy(e.target.value as RoomPrivacy)}
                className="field w-full cursor-pointer"
              >
                <option value="public">Public</option>
                <option value="private">Private (Code Only)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#9A9AA2] uppercase tracking-wider mb-1.5">Max Participants</label>
              <input
                type="number"
                min={2}
                max={12}
                value={maxMembers}
                onChange={(e) => setMaxMembers(Number(e.target.value))}
                className="field w-full text-[13px]"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#9A9AA2] uppercase tracking-wider mb-1.5">Description (Optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional room note..."
              className="field w-full text-[13px]"
            />
          </div>

          <div className="pt-3 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setCreateRoomModalOpen(false)}
              className="btn-secondary text-xs px-4 py-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary text-xs px-5 py-2"
            >
              Create Room
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
