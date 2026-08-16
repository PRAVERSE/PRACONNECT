import React from 'react';

export const AmbientBackground: React.FC = () => {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0 select-none bg-[#0A0A0C]">
      {/* Soft Signature Baby Pink Ambient Glow (Very Low Opacity ~3%) */}
      <div className="absolute top-[-15%] right-[-5%] w-[650px] h-[650px] rounded-full bg-[radial-gradient(circle,rgba(246,184,208,0.035)_0%,rgba(10,10,12,0)_70%)] blur-3xl animate-ambient-1" />
    </div>
  );
};
