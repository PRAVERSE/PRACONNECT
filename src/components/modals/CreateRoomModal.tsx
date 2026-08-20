import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { RoomPrivacy } from '../../types';
import { UserAvatar } from '../common/UserAvatar';
import { Users, Check } from 'lucide-react';

export const CreateRoomModal: React.FC = () => {
  const { createRoomModalOpen, setCreateRoomModalOpen, createRoom, friends, setActiveTab } = useApp();

  const [name, setName] = useState('');
  const [privacy, setPrivacy] = useState<RoomPrivacy>('public');
  const [maxMembers, setMaxMembers] = useState(8);
  const [description, setDescription] = useState('');
  const [selectedFriendIds, setSelectedFriendIds] = useState<Set<string>>(new Set());
  const [friendFilter, setFriendFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  if (!createRoomModalOpen) return null;

  const acceptedFriends = friends.filter((f) => !f.requestPending && !f.isSuggestion);
  const filteredFriends = acceptedFriends.filter(
    (f) =>
      f.name.toLowerCase().includes(friendFilter.toLowerCase()) ||
      f.username.toLowerCase().includes(friendFilter.toLowerCase())
  );

  const toggleFriend = (id: string) => {
    setSelectedFriendIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError('');
    setCreating(true);
    const room = await createRoom({
      name: name.trim(),
      category: 'Movie',
      privacy,
      maxMembers: Number(maxMembers),
      description: description.trim() || undefined,
      inviteFriendIds: Array.from(selectedFriendIds),
    });
    setCreating(false);
    if (room) {
      setCreateRoomModalOpen(false);
      setName('');
      setDescription('');
      setSelectedFriendIds(new Set());
      setFriendFilter('');
    } else {
      setError('Failed to create room. Please try again.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 select-none animate-fade-in">
      <div className="w-full max-w-md float-surface p-6 relative text-[var(--text-primary)] pop-in max-h-[90vh] overflow-y-auto">
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

        {error && (
          <div className="p-3 mb-4 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
            {error}
          </div>
        )}

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
                className="field w-full cursor-pointer text-xs"
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

          {/* INVITE FRIENDS SECTION */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-semibold text-[#9A9AA2] uppercase tracking-wider flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                Invite Friends {selectedFriendIds.size > 0 && `(${selectedFriendIds.size} selected)`}
              </label>
            </div>

            {acceptedFriends.length === 0 ? (
              <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3 text-center space-y-2">
                <p className="text-xs text-[#9A9AA2]">
                  No friends yet. Find friends from the Friends section to invite them to a room.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setCreateRoomModalOpen(false);
                    setActiveTab('friends');
                  }}
                  className="btn-secondary text-[11px] py-1 px-3 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Users className="w-3 h-3" />
                  Find Friends
                </button>
              </div>
            ) : (
              <div>
                {acceptedFriends.length > 4 && (
                  <input
                    type="text"
                    value={friendFilter}
                    onChange={(e) => setFriendFilter(e.target.value)}
                    placeholder="Filter friends..."
                    className="field w-full text-xs mb-2 py-1.5 px-3"
                  />
                )}

                <div className="max-h-36 overflow-y-auto space-y-1.5 rounded-xl bg-white/[0.03] border border-white/10 p-2">
                  {filteredFriends.length === 0 ? (
                    <p className="text-[11px] text-[#9A9AA2] text-center py-2">No matching friends</p>
                  ) : (
                    filteredFriends.map((friend) => {
                      const isSelected = selectedFriendIds.has(friend.id);
                      return (
                        <div
                          key={friend.id}
                          onClick={() => toggleFriend(friend.id)}
                          className={`flex items-center justify-between p-1.5 rounded-lg cursor-pointer transition-colors ${
                            isSelected ? 'bg-white/10 border border-white/20' : 'hover:bg-white/5 border border-transparent'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="relative shrink-0">
                              <UserAvatar avatar={friend.avatar} name={friend.name} className="w-7 h-7 text-xs" />
                              {friend.status === 'online' && (
                                <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-emerald-500 ring-1 ring-black" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-[#EDEDEF] truncate">{friend.name}</p>
                              <p className="text-[10px] text-[#9A9AA2] truncate">@{friend.username}</p>
                            </div>
                          </div>
                          <div
                            className={`w-4 h-4 rounded flex items-center justify-center border transition-colors ${
                              isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-white/20'
                            }`}
                          >
                            {isSelected && <Check className="w-3 h-3" />}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
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
              disabled={creating}
              className="btn-primary text-xs px-5 py-2 cursor-pointer disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create Room'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
