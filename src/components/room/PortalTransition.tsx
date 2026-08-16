import React, { useEffect, useState } from 'react';

interface PortalTransitionProps {
  active: boolean;
  posterUrl?: string;
  roomName?: string;
  onComplete: () => void;
}

export const PortalTransition: React.FC<PortalTransitionProps> = ({
  active,
  posterUrl,
  roomName,
  onComplete
}) => {
  const [stage, setStage] = useState<'blur' | 'zoom' | 'fade' | 'done'>('blur');

  useEffect(() => {
    if (!active) return;

    setStage('blur');

    // Stage 1: Blur/Darken (200ms)
    const timer1 = setTimeout(() => {
      setStage('zoom');
    }, 200);

    // Stage 2: Artwork zoom scale-up (350ms)
    const timer2 = setTimeout(() => {
      setStage('fade');
    }, 550);

    // Stage 3: Cross-fade into room interface (200ms)
    const timer3 = setTimeout(() => {
      setStage('done');
      onComplete();
    }, 750);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, [active, onComplete]);

  if (!active || stage === 'done') return null;

  return (
    <div className="fixed inset-0 z-50 pointer-events-none overflow-hidden flex items-center justify-center bg-[#0A0D18]/90 backdrop-blur-xl transition-opacity duration-200">
      {/* Background Darkening Overlay */}
      <div
        className={`absolute inset-0 bg-[#0A0D18] transition-opacity duration-300 ${
          stage === 'blur' ? 'opacity-40' : 'opacity-90'
        }`}
      />

      {/* Zooming Poster Artwork */}
      <div
        className={`relative transition-all duration-500 ease-in flex flex-col items-center justify-center ${
          stage === 'zoom'
            ? 'scale-[3] opacity-100'
            : stage === 'fade'
            ? 'scale-[4] opacity-0'
            : 'scale-100 opacity-80'
        }`}
      >
        <div className="w-64 h-64 md:w-80 md:h-80 rounded-3xl overflow-hidden shadow-2xl border-2 border-[#F59E0B]/50 bg-[#0E1322]">
          <img
            src={
              posterUrl ||
              'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=800&q=80'
            }
            alt={roomName || 'Watch Room'}
            className="w-full h-full object-cover"
          />
        </div>

        <div className="mt-4 text-center">
          <span className="text-xs font-mono font-bold uppercase text-[#FBBF24] tracking-widest bg-[#0A0D18]/80 px-3 py-1 rounded-full border border-[#F59E0B]/30">
            ENTER PORTAL &bull; {roomName || 'ROOM'}
          </span>
        </div>
      </div>
    </div>
  );
};
