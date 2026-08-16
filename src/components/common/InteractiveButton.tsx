import React, { useState, useRef } from 'react';
import { Loader2, Check } from 'lucide-react';

interface InteractiveButtonProps {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>;
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
}

export const InteractiveButton: React.FC<InteractiveButtonProps> = ({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  disabled = false
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [magneticOffset, setMagneticOffset] = useState({ x: 0, y: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Magnetic hover offset calculation
  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!buttonRef.current || disabled) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const offsetX = (e.clientX - centerX) * 0.15; // subtle magnetic pull
    const offsetY = (e.clientY - centerY) * 0.15;
    setMagneticOffset({ x: offsetX, y: offsetY });
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setIsPressed(false);
    setMagneticOffset({ x: 0, y: 0 });
  };

  const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || status === 'loading') return;

    if (!onClick) return;

    try {
      setStatus('loading');
      const result = onClick(e);

      if (result && typeof (result as Promise<void>).then === 'function') {
        await result;
      } else {
        // Simulate small delay for tactile feedback if synchronous
        await new Promise((resolve) => setTimeout(resolve, 350));
      }

      setStatus('success');
      setTimeout(() => {
        setStatus('idle');
      }, 400);
    } catch {
      setStatus('error');
      setTimeout(() => {
        setStatus('idle');
      }, 1500);
    }
  };

  // Size styling
  const sizeClasses = {
    sm: 'px-3 h-8 text-xs rounded-lg gap-1.5',
    md: 'px-4 h-10 text-xs rounded-xl gap-2 font-bold',
    lg: 'px-6 h-12 text-sm rounded-xl gap-2.5 font-extrabold'
  }[size];

  // Variant styling
  const variantClasses = {
    primary:
      'bg-[var(--control-primary-bg)] text-[var(--control-primary-text)] font-bold hover:opacity-90 border border-transparent shadow-sm',
    secondary:
      'bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-strong)] transition-colors',
    danger:
      'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-subtle)] hover:border-[var(--status-error)]/40 hover:text-[var(--status-error)] transition-colors',
    success:
      'bg-[var(--control-primary-bg)] text-[var(--control-primary-text)] font-bold hover:opacity-90 border border-transparent',
    ghost:
      'bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors'
  }[variant];

  // Dynamic transforms based on interaction rules
  const transformStyle = disabled
    ? 'scale-100 opacity-50 cursor-not-allowed'
    : isPressed
    ? 'scale-[0.97] transition-transform duration-75 ease-in'
    : isHovered
    ? 'scale-[1.03] transition-transform duration-150 ease-out'
    : 'scale-100 transition-transform duration-200 ease-out';

  return (
    <button
      ref={buttonRef}
      type={type}
      disabled={disabled || status === 'loading'}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
      onMouseDown={() => setIsPressed(true)}
      onMouseUp={() => setIsPressed(false)}
      onMouseMove={handleMouseMove}
      className={`relative inline-flex items-center justify-center font-heading transition-all select-none overflow-hidden ${sizeClasses} ${variantClasses} ${transformStyle} ${
        status === 'error' ? 'animate-button-shake border-[#EF4444] text-[#EF4444]' : ''
      } ${className}`}
      style={{
        transform: !disabled && isHovered && !isPressed
          ? `translate3d(${magneticOffset.x}px, ${magneticOffset.y}px, 0px) scale(1.03)`
          : undefined
      }}
    >
      {/* Background Glow Drift */}
      {!disabled && isHovered && (
        <span
          className="absolute inset-0 bg-white/10 blur-sm pointer-events-none transition-opacity duration-150"
          style={{
            transform: `translate(${magneticOffset.x * 0.5}px, ${magneticOffset.y * 0.5}px)`
          }}
        />
      )}

      {/* Internal Content Cross-Fade */}
      <span
        className={`inline-flex items-center gap-2 transition-opacity duration-100 ${
          status !== 'idle' ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {children}
      </span>

      {/* Loading Spinner in same button shape */}
      {status === 'loading' && (
        <span className="absolute inset-0 flex items-center justify-center animate-fadeIn">
          <Loader2 className="w-4 h-4 animate-spin text-current" />
        </span>
      )}

      {/* Success Checkmark */}
      {status === 'success' && (
        <span className="absolute inset-0 flex items-center justify-center animate-fadeIn">
          <Check className="w-4 h-4 text-current stroke-[3]" />
        </span>
      )}
    </button>
  );
};
