import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { UserAvatar } from '../common/UserAvatar';
import { Loader } from 'lucide-react';

export const InviteModal: React.FC = () => {
  const { inviteModalOpen, setInviteModalOpen, currentRoom, friends, sendWatchInvite } = useApp();
  const [copied, setCopied] = useState(false);
  const [invitedFriends, setInvitedFriends] = useState<string[]>([]);
  const [sendingId, setSendingId] = useState<string | null>(null);

  if (!inviteModalOpen || !currentRoom) return null;

  const roomLink = `${window.location.origin}/join/${currentRoom.code}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(roomLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendInvite = async (friendId: string) => {
    if (sendingId) return;
    setSendingId(friendId);
    await sendWatchInvite(friendId, currentRoom.id);
    setSendingId(null);
    setInvitedFriends((prev) => [...prev, friendId]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 select-none animate-fade-in">
      <div className="w-full max-w-md float-surface p-6 relative text-[var(--text-primary)] pop-in">
        <button
          onClick={() => setInviteModalOpen(false)}
          className="absolute top-4 right-4 text-[#5C5C64] hover:text-[#EDEDEF] transition-colors cursor-pointer"
        >
          ✕
        </button>

        <h2 className="font-['Sora',sans-serif] text-base font-bold text-[#EDEDEF] mb-1">
          Invite Friends
        </h2>
        <p className="text-xs text-[#9A9AA2] mb-5">
          Invite friends to join <span className="text-[#EDEDEF] font-semibold">{currentRoom.name}</span>
        </p>

        {/* Copy Link Section */}
        <div className="mb-6">
          <label className="block text-[11px] font-semibold text-[#9A9AA2] uppercase tracking-wider mb-1.5">
            Shareable Invite Link
          </label>
          <div className="flex gap-2.5">
            <input
              type="text"
              readOnly
              value={roomLink}
              className="field flex-1 font-mono text-[12px] select-all"
            />
            <button
              onClick={handleCopy}
              className="btn-primary text-xs px-4 shrink-0"
            >
              {copied ? '✓ Copied!' : 'Copy Link'}
            </button>
          </div>
          <div className="mt-2 text-[11px] text-[#5C5C64]">
            Room Code: <code className="pill-glass text-[var(--text-primary)] px-2 py-0.5 font-mono">{currentRoom.code}</code>
          </div>
        </div>

        {/* Invite Friends List */}
        <div>
          <label className="block text-[11px] font-semibold text-[#9A9AA2] uppercase tracking-wider mb-2">Direct Invite Friends</label>
          <div className="max-h-48 overflow-y-auto divide-y divide-white/[0.07] pr-1 no-scrollbar">
            {friends.map((friend) => {
              const isInvited = invitedFriends.includes(friend.id);
              return (
                <div
                  key={friend.id}
                  className="flex items-center justify-between py-2.5"
                >
                  <div className="flex items-center gap-3">
                    <UserAvatar
                      avatar={friend.avatar}
                      name={friend.name}
                      className="w-8 h-8 font-bold text-xs"
                    />
                    <div>
                      <div className="font-display text-xs font-semibold text-[var(--text-primary)]">{friend.name}</div>
                      <div className="text-[10px] text-[var(--text-tertiary)] font-mono">@{friend.username}</div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleSendInvite(friend.id)}
                    disabled={isInvited || Boolean(sendingId)}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
                      isInvited
                        ? 'bg-[var(--bg-glass)] text-[var(--text-tertiary)]'
                        : 'bg-[var(--emphasis)] text-[var(--bg)] hover:bg-[var(--emphasis-strong)]'
                    } disabled:opacity-60`}
                  >
                    {sendingId === friend.id ? (
                      <Loader className="w-3 h-3 animate-spin" aria-hidden="true" />
                    ) : null}
                    {isInvited ? 'Invited' : 'Invite'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
