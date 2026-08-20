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
    className={`w-11 h-6 rounded-full relative cursor-pointer flex items-center shrink-0 transition-all duration-150 border ${
      checked
        ? 'bg-[var(--emphasis)] border-[var(--emphasis)] shadow-[0_2px_12px_var(--emphasis-glow)]'
        : 'bg-[var(--bg-glass)] border-[var(--border-hairline)]'
    }`}
  >
    <span
      className={`block w-5 h-5 rounded-full transition-transform duration-150 ${
        checked
          ? 'bg-[var(--bg)] translate-x-[20px]'
          : 'bg-[var(--text-tertiary)] translate-x-[2px]'
      }`}
    />
  </button>
);