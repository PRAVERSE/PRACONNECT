import React, { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ToggleSwitch } from '../common/ToggleSwitch';

export const SettingsView: React.FC = () => {
  const { userSettings, updateSettings } = useApp();
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [requestsOpen, setRequestsOpen] = useState(false);

  const triggerSave = () => {
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2000);
  };

  const requestOptions = ['Everyone', 'Friends of Friends', 'Nobody'] as const;

  return (
    <div className="w-full min-w-0 text-[var(--text-primary)] font-['Inter',sans-serif] select-none pb-12">
      {/* ─── PAGE HEADER ──────────────────────────────────────────────────────── */}
      <header
        className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-10"
        style={{ animation: 'rise 640ms var(--ease) both' }}
      >
        <div>
          <h1
            className="font-display font-bold tracking-[-0.02em] text-[clamp(2rem,3.4vw,2.7rem)] leading-[1.1] mb-2"
            style={{ animation: 'rise 640ms var(--ease) 80ms both' }}
          >
            Settings
          </h1>
          <p
            className="text-[15px] text-[var(--text-secondary)] max-w-[520px]"
            style={{ animation: 'rise 640ms var(--ease) 150ms both' }}
          >
            Manage application preferences, theme, and account privacy.
          </p>
        </div>

        {savedMsg && (
          <span
            className="pill-glass px-3.5 py-1.5 text-xs font-mono text-[var(--text-primary)] self-start md:self-auto animate-fade-in"
            role="status"
          >
            ✓ Changes saved
          </span>
        )}
      </header>

      {/* ─── 1. APPEARANCE & THEME — plain rows with glow wash, no boxes ─────── */}
      <section className="mb-12" style={{ animation: 'rise 640ms var(--ease) 220ms both' }}>
        <h2 className="eyebrow-dim mb-4">Appearance</h2>

        <div className="w-full">
          {([
            { id: 'Dark', label: 'Dark Mode', desc: 'Deep cinematic dark theme (#0A0A0C)' },
            { id: 'Light', label: 'Light Mode', desc: 'High-contrast light theme' }
          ] as const).map((option, i) => {
            const isActive = userSettings.theme === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  updateSettings({ theme: option.id });
                  triggerSave();
                }}
                className={`relative w-full text-left transition-colors cursor-pointer flex items-center justify-between gap-4 py-4 px-1 group ${
                  i > 0 ? 'border-t border-[var(--border-hairline)]' : ''
                }`}
              >
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-1 left-0 w-full rounded-full bg-[linear-gradient(90deg,var(--emphasis-dim),transparent)]"
                  />
                )}
                <span className="relative z-10">
                  <span className="block font-display text-[15px] font-semibold text-[var(--text-primary)] mb-0.5">
                    {option.label}
                  </span>
                  <span className="block text-xs text-[var(--text-secondary)]">{option.desc}</span>
                </span>
                <span
                  className={`relative z-10 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-200 ${
                    isActive
                      ? 'bg-[var(--emphasis)] text-[var(--bg)] shadow-[0_2px_12px_rgba(255,255,255,0.25)]'
                      : 'bg-[var(--bg-glass)] text-transparent'
                  }`}
                >
                  <Check className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden="true" />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ─── 2. GENERAL PREFERENCES ─────────────────────────────────────────── */}
      <section className="mb-12" style={{ animation: 'rise 640ms var(--ease) 300ms both' }}>
        <h2 className="eyebrow-dim mb-4">General</h2>

        <div className="w-full">
          {/* Sound Effects */}
          <div className="py-4 flex items-center justify-between gap-6">
            <div>
              <div className="font-display text-[15px] font-semibold text-[var(--text-primary)]">Sound Effects</div>
              <div className="text-xs text-[var(--text-secondary)] mt-0.5">Play audio cues for new messages and reactions</div>
            </div>
            <ToggleSwitch
              checked={userSettings.soundEffects}
              onChange={() => {
                updateSettings({ soundEffects: !userSettings.soundEffects });
                triggerSave();
              }}
              label="Sound Effects"
            />
          </div>

          {/* Keyboard Shortcuts */}
          <div className="py-4 border-t border-[var(--border-hairline)] flex items-center justify-between gap-6">
            <div>
              <div className="font-display text-[15px] font-semibold text-[var(--text-primary)]">Keyboard Shortcuts</div>
              <div className="text-xs text-[var(--text-secondary)] mt-0.5">View quick room controls and navigation keys</div>
            </div>
            <button
              onClick={() => setShortcutsModalOpen(true)}
              className="btn-secondary text-xs px-4 py-2 shrink-0"
            >
              View Shortcuts
            </button>
          </div>
        </div>
      </section>

      {/* ─── 3. PRIVACY & SECURITY ──────────────────────────────────────────── */}
      <section className="mb-12" style={{ animation: 'rise 640ms var(--ease) 380ms both' }}>
        <h2 className="eyebrow-dim mb-4">Privacy &amp; Security</h2>

        <div className="w-full">
          {/* Show Activity Status */}
          <div className="py-4 flex items-center justify-between gap-6">
            <div>
              <div className="font-display text-[15px] font-semibold text-[var(--text-primary)]">Show Activity Status</div>
              <div className="text-xs text-[var(--text-secondary)] mt-0.5">Let friends see when you are active or in a live room</div>
            </div>
            <ToggleSwitch
              checked={userSettings.showActivityStatus}
              onChange={() => {
                updateSettings({ showActivityStatus: !userSettings.showActivityStatus });
                triggerSave();
              }}
              label="Show Activity Status"
            />
          </div>

          {/* Private Profile */}
          <div className="py-4 border-t border-[var(--border-hairline)] flex items-center justify-between gap-6">
            <div>
              <div className="font-display text-[15px] font-semibold text-[var(--text-primary)]">Private Profile</div>
              <div className="text-xs text-[var(--text-secondary)] mt-0.5">Hide your room history from non-friends</div>
            </div>
            <ToggleSwitch
              checked={userSettings.privateProfile}
              onChange={() => {
                updateSettings({ privateProfile: !userSettings.privateProfile });
                triggerSave();
              }}
              label="Private Profile"
            />
          </div>

          {/* Friend Requests — pill trigger + floating dropdown */}
          <div className="py-4 border-t border-[var(--border-hairline)] flex items-center justify-between gap-6">
            <div>
              <div className="font-display text-[15px] font-semibold text-[var(--text-primary)]">Friend Requests</div>
              <div className="text-xs text-[var(--text-secondary)] mt-0.5">Control who can send you invitations</div>
            </div>
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setRequestsOpen((o) => !o)}
                aria-haspopup="listbox"
                aria-expanded={requestsOpen}
                className="btn-secondary text-xs px-4 py-2 flex items-center gap-2"
              >
                <span>{userSettings.whoCanSendFriendRequests}</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${requestsOpen ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              </button>

              {requestsOpen && (
                <div
                  role="listbox"
                  className="absolute right-0 top-full mt-2 float-surface p-1.5 min-w-[190px] pop-in z-40"
                >
                  {requestOptions.map((option) => {
                    const isActive = userSettings.whoCanSendFriendRequests === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        onClick={() => {
                          updateSettings({ whoCanSendFriendRequests: option });
                          setRequestsOpen(false);
                          triggerSave();
                        }}
                        className={`w-full text-left px-3.5 py-2.5 rounded-full text-[13px] font-medium transition-colors cursor-pointer flex items-center justify-between gap-3 ${
                          isActive
                            ? 'text-[var(--text-primary)] bg-[var(--emphasis-dim)]'
                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-glass)]'
                        }`}
                      >
                        {option}
                        {isActive && <Check className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ─── 4. WATCH PARTY CONTROLS ────────────────────────────────────────── */}
      <section style={{ animation: 'rise 640ms var(--ease) 460ms both' }}>
        <h2 className="eyebrow-dim mb-4">Watch Party Controls</h2>

        <div className="w-full">
          {/* Autoplay Next */}
          <div className="py-4 flex items-center justify-between gap-6">
            <div>
              <div className="font-display text-[15px] font-semibold text-[var(--text-primary)]">Autoplay Next</div>
              <div className="text-xs text-[var(--text-secondary)] mt-0.5">Automatically play next video in synchronized queue</div>
            </div>
            <ToggleSwitch
              checked={userSettings.autoplayNext}
              onChange={() => {
                updateSettings({ autoplayNext: !userSettings.autoplayNext });
                triggerSave();
              }}
              label="Autoplay Next"
            />
          </div>

          {/* Default Mic Muted */}
          <div className="py-4 border-t border-[var(--border-hairline)] flex items-center justify-between gap-6">
            <div>
              <div className="font-display text-[15px] font-semibold text-[var(--text-primary)]">Default Mic Muted</div>
              <div className="text-xs text-[var(--text-secondary)] mt-0.5">Mute microphone automatically on room entry</div>
            </div>
            <ToggleSwitch
              checked={!userSettings.defaultMicOn}
              onChange={() => {
                updateSettings({ defaultMicOn: !userSettings.defaultMicOn });
                triggerSave();
              }}
              label="Default Mic Muted"
            />
          </div>
        </div>
      </section>

      {/* KEYBOARD SHORTCUTS MODAL — floating surface, no stroke */}
      {shortcutsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm float-surface p-6 relative pop-in">
            <h3 className="font-display text-[17px] font-semibold text-[var(--text-primary)] mb-5">
              Room Shortcuts
            </h3>
            <div className="text-xs">
              {[
                { key: 'M', label: 'Toggle Microphone' },
                { key: 'V', label: 'Toggle Camera' },
                { key: 'S', label: 'Toggle Screen Share' }
              ].map((row, i) => (
                <div
                  key={row.key}
                  className={`flex justify-between items-center py-3 ${i > 0 ? 'border-t border-[var(--border-hairline)]' : ''}`}
                >
                  <span className="text-[var(--text-secondary)]">{row.label}</span>
                  <kbd className="pill-glass px-2.5 py-1 rounded-full text-[11px] text-[var(--text-primary)] font-mono font-medium">
                    {row.key}
                  </kbd>
                </div>
              ))}
            </div>
            <button
              onClick={() => setShortcutsModalOpen(false)}
              className="mt-6 w-full btn-primary text-sm py-2.5"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};