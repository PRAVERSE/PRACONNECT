import React from 'react';
import { Search, X } from 'lucide-react';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  count?: number;
  countNoun?: { singular: string; plural: string };
  autoFocus?: boolean;
  className?: string;
  inputClassName?: string;
  onClear?: () => void;
}

export const SearchInput: React.FC<SearchInputProps> = ({
  value,
  onChange,
  placeholder = 'Search...',
  ariaLabel = 'Search',
  count,
  countNoun = { singular: 'result', plural: 'results' },
  autoFocus,
  className = 'mb-8 max-w-[520px]',
  inputClassName = '',
  onClear,
}) => {
  const handleClear = () => {
    onChange('');
    onClear?.();
  };

  return (
    <div
      className={`flex items-center gap-4 ${className}`}
      style={{ animation: 'rise 640ms var(--ease) 220ms both' }}
    >
      <div className="relative flex-1">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          autoFocus={autoFocus}
          className={`field w-full pl-12 pr-10 ${inputClassName}`}
        />
        <Search
          className="w-4 h-4 text-[var(--text-tertiary)] absolute left-[18px] top-1/2 -translate-y-1/2 pointer-events-none"
          aria-hidden="true"
        />
        {value.trim().length > 0 && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] rounded-full cursor-pointer transition-colors"
            aria-label="Clear search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {count !== undefined && count > 0 && (
        <span className="text-xs text-[var(--text-tertiary)] font-mono hidden sm:inline shrink-0">
          {count} {count === 1 ? countNoun.singular : countNoun.plural}
        </span>
      )}
    </div>
  );
};
