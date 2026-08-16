import React from 'react';

interface VoiceRingProps {
  isSpeaking: boolean;
  children: React.ReactNode;
  className?: string;
  ringColor?: string;
}

export const VoiceRing: React.FC<VoiceRingProps> = ({
  isSpeaking,
  children,
  className = '',
  ringColor = '#10B981'
}) => {
  return (
    <div className={`relative inline-flex items-center justify-center ${className}`}>
      {/* Animated Sonar Ping Ring */}
      {isSpeaking && (
        <span
          className="absolute inset-0 rounded-full animate-sonar-ping pointer-events-none"
          style={{
            border: `2px solid ${ringColor}`,
            boxShadow: `0 0 10px ${ringColor}`
          }}
        />
      )}

      {/* Actual Avatar Content */}
      <div className={`relative z-10 transition-all ${isSpeaking ? 'scale-105' : 'scale-100'}`}>
        {children}
      </div>
    </div>
  );
};
