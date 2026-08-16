import React from 'react';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: () => void;
  label: string;
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ checked, onChange, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={onChange}
    className={`w-11 h-6 rounded-full relative cursor-pointer flex items-center shrink-0 transition-all duration-200 ${
      checked
        ? 'bg-[var(--emphasis)] shadow-[0_2px_12px_rgba(255,255,255,0.25)]'
        : 'bg-[var(--bg-glass)]'
    }`}
  >
    <span
      className={`block w-5 h-5 rounded-full transition-transform duration-200 ${
        checked
          ? 'bg-[var(--bg)] translate-x-[22px]'
          : 'bg-[var(--text-tertiary)] translate-x-[2px]'
      }`}
    />
  </button>
);