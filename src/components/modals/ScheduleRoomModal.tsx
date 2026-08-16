import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';

export const ScheduleRoomModal: React.FC = () => {
  const { scheduleModalOpen, setScheduleModalOpen, scheduleParty } = useApp();

  const [title, setTitle] = useState('');
  const [scheduledFor, setScheduledFor] = useState('Tomorrow at 8:00 PM');
  const [description, setDescription] = useState('');

  if (!scheduleModalOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    scheduleParty({
      title: title.trim(),
      category: 'General' as any,
      scheduledFor: scheduledFor.trim(),
      description: description.trim()
    });
    setScheduleModalOpen(false);
    setTitle('');
    setDescription('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 select-none animate-fade-in">
      <div className="w-full max-w-md float-surface p-6 relative text-[var(--text-primary)] pop-in">
        <button
          onClick={() => setScheduleModalOpen(false)}
          className="absolute top-4 right-4 text-[#5C5C64] hover:text-[#EDEDEF] transition-colors cursor-pointer"
        >
          ✕
        </button>

        <h2 className="font-['Sora',sans-serif] text-base font-bold text-[#EDEDEF] mb-1">
          Schedule Watch Party
        </h2>
        <p className="text-xs text-[#9A9AA2] mb-5">
          Plan an upcoming stream or hangout for your group.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block text-[11px] font-semibold text-[#9A9AA2] uppercase tracking-wider mb-1.5">
              Party Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Weekend Stream Hangout"
              required
              className="field w-full text-[13px]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#9A9AA2] uppercase tracking-wider mb-1.5">
              Scheduled Date & Time
            </label>
            <input
              type="text"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              placeholder="e.g. Friday at 9:00 PM"
              required
              className="field w-full text-[13px]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#9A9AA2] uppercase tracking-wider mb-1.5">
              Description (Optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add details about the watch party..."
              rows={3}
              className="field w-full text-[13px] resize-none"
            />
          </div>

          <div className="pt-3 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setScheduleModalOpen(false)}
              className="btn-secondary text-xs px-4 py-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary text-xs px-5 py-2"
            >
              Schedule Event
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
