// src/components/calling/CallOverlay.tsx
// Dedicated full-screen 1-on-1 WebRTC Video & Audio Call interface matching PraConnect design language.

import React, { useEffect, useState, useRef } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, AlertCircle } from 'lucide-react';
import { callingService, CallSession } from '../../services/calling';

export const CallOverlay: React.FC = () => {
  const [session, setSession] = useState<CallSession | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [connectedDuration, setConnectedDuration] = useState<number>(0);
  const [isRemoteVideoActive, setIsRemoteVideoActive] = useState<boolean>(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  // Subscribe to CallingService state updates
  useEffect(() => {
    const unsub = callingService.subscribe((s, local, remote) => {
      setSession(s);
      setLocalStream(local);
      setRemoteStream(remote);
    });
    return () => unsub();
  }, []);

  // Bind local MediaStream to local video element
  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, session?.isCameraOff]);

  // Bind remote MediaStream to remote video element & monitor video track availability
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream && remoteVideoRef.current.srcObject !== remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }

    if (!remoteStream) {
      setIsRemoteVideoActive(false);
      return;
    }

    const updateActiveState = () => {
      const videoTracks = remoteStream.getVideoTracks();
      if (videoTracks.length === 0) {
        setIsRemoteVideoActive(false);
        return;
      }
      const mainTrack = videoTracks[0];
      setIsRemoteVideoActive(mainTrack.enabled && mainTrack.readyState === 'live');
    };

    updateActiveState();

    const videoTracks = remoteStream.getVideoTracks();
    if (videoTracks.length > 0) {
      const mainTrack = videoTracks[0];
      mainTrack.addEventListener('mute', updateActiveState);
      mainTrack.addEventListener('unmute', updateActiveState);
      mainTrack.addEventListener('ended', updateActiveState);

      return () => {
        mainTrack.removeEventListener('mute', updateActiveState);
        mainTrack.removeEventListener('unmute', updateActiveState);
        mainTrack.removeEventListener('ended', updateActiveState);
      };
    }
  }, [remoteStream, session?.state]);

  // Connected Call Timer (starts strictly upon 'connected' state)
  useEffect(() => {
    if (!session || session.state !== 'connected') {
      setConnectedDuration(0);
      return;
    }

    const interval = setInterval(() => {
      setConnectedDuration((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [session?.state]);

  if (!session || session.state === 'idle') {
    return null;
  }

  const isIncoming = session.state === 'ringing';
  const isVideoCall = session.type === 'video';
  const isConnected = session.state === 'connected';

  if (process.env.NODE_ENV !== 'production') {
    console.log('[CALL UI DEBUG] CallOverlay active render:', { state: session.state, peerName: session.peerName, isVideoCall, localStream: !!localStream, remoteStream: !!remoteStream });
  }

  // Format seconds into MM:SS
  const formatTimer = (totalSeconds: number) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const getStatusText = () => {
    if (session.errorMessage) return session.errorMessage;
    switch (session.state) {
      case 'calling':
        return `Calling ${session.peerName}...`;
      case 'ringing':
        return `Incoming ${session.type} call...`;
      case 'connecting':
        return 'Connecting call...';
      case 'connected':
        return formatTimer(connectedDuration);
      case 'declined':
        return 'Call declined';
      case 'cancelled':
        return 'Call cancelled';
      case 'ended':
        return 'Call ended';
      case 'failed':
        return 'Unable to establish connection';
      default:
        return `${session.type} call`;
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-[var(--bg-canvas)] w-full h-full overflow-hidden select-none flex flex-col font-['Inter',sans-serif]">
      {/* ─── 1. MAIN REMOTE MEDIA CANVAS — Covers full screen ─────────────────── */}
      <div className="absolute inset-0 w-full h-full z-10 bg-black flex items-center justify-center overflow-hidden">
        {isVideoCall && (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className={`absolute inset-0 w-full h-full object-cover z-10 transition-opacity duration-300 ${
              isConnected && isRemoteVideoActive ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          />
        )}

        {/* Remote avatar placeholder when camera is disabled or call is connecting */}
        {(!isVideoCall || !isConnected || !isRemoteVideoActive) && (
          <div className="flex flex-col items-center justify-center p-6 text-center z-20 max-w-md mx-auto">
            {session.state === 'failed' ? (
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400 mb-4 shadow-2xl animate-fade-in">
                <AlertCircle className="w-10 h-10 sm:w-12 sm:h-12" />
              </div>
            ) : (
              <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-full bg-[var(--emphasis-dim)] border border-[var(--border-hairline)] flex items-center justify-center text-3xl sm:text-5xl font-bold text-[var(--text-primary)] mb-4 shadow-2xl animate-pulse">
                {session.peerName.charAt(0).toUpperCase()}
              </div>
            )}
            <h2 className="font-display text-xl sm:text-2xl font-semibold text-[var(--text-primary)]">
              {session.state === 'failed' ? 'Call Failed' : session.peerName}
            </h2>
            <p className={`text-sm mt-2 leading-relaxed ${session.state === 'failed' ? 'text-rose-300 max-w-sm' : 'text-[var(--text-tertiary)]'}`}>
              {getStatusText()}
            </p>
            {session.state === 'failed' && (
              <button
                onClick={() => callingService.dismissError()}
                className="mt-6 px-6 py-2.5 rounded-full bg-white/15 hover:bg-white/25 text-white text-xs font-semibold uppercase tracking-wider transition-all border border-white/20 cursor-pointer shadow-lg hover:scale-105"
              >
                Dismiss
              </button>
            )}
          </div>
        )}
      </div>

      {/* ─── NON-BLOCKING IN-CALL NOTICE (e.g. Camera unavailable fallback) ──── */}
      {session.errorMessage && (session.state === 'calling' || session.state === 'connecting' || session.state === 'connected') && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40 bg-amber-500/20 border border-amber-500/40 text-amber-200 text-xs px-4 py-2 rounded-full backdrop-blur-md shadow-lg flex items-center gap-2 animate-fade-in">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{session.errorMessage}</span>
        </div>
      )}

      {/* ─── 2. TOP-LEFT CALL PARTICIPANT & TIMER BADGE ───────────────────────── */}
      <div className="absolute top-5 left-5 sm:top-6 sm:left-6 z-30 flex items-center gap-3 bg-black/60 backdrop-blur-md px-4 py-2.5 rounded-full border border-white/10 shadow-xl">
        <div className="w-8 h-8 rounded-full bg-[var(--emphasis-dim)] flex items-center justify-center font-semibold text-xs text-[var(--text-primary)]">
          {session.peerName.charAt(0).toUpperCase()}
        </div>
        <div className="flex flex-col">
          <span className="font-semibold text-xs sm:text-sm text-[var(--text-primary)] leading-tight truncate max-w-[140px] sm:max-w-[200px]">
            {session.peerName}
          </span>
          <span className={`text-[11px] leading-tight ${session.errorMessage || session.state === 'failed' ? 'text-red-400 font-medium' : 'text-[var(--text-tertiary)]'}`}>
            {getStatusText()}
          </span>
        </div>
      </div>

      {/* ─── 3. FLOATING LOCAL VIDEO PREVIEW (Bottom-Right) ───────────────────── */}
      {isVideoCall && (isConnected || session.state === 'connecting' || session.state === 'calling') && (
        <div className="absolute right-4 sm:right-6 bottom-24 sm:bottom-28 z-30 w-36 sm:w-56 aspect-video rounded-2xl overflow-hidden border border-white/15 shadow-2xl bg-zinc-900/90 backdrop-blur-md flex items-center justify-center transition-all">
          {!session.isCameraOff && localStream ? (
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover -scale-x-100"
            />
          ) : (
            <div className="flex flex-col items-center justify-center p-2 text-center text-[var(--text-tertiary)]">
              <VideoOff className="w-6 h-6 mb-1 opacity-70" />
              <span className="text-[10px] font-medium">Camera Off</span>
            </div>
          )}
        </div>
      )}

      {/* ─── 4. BOTTOM CONTROL BAR — Centered circular actions ───────────────── */}
      <div className="absolute bottom-6 sm:bottom-8 inset-x-0 z-30 flex items-center justify-center gap-4 sm:gap-6">
        {isIncoming ? (
          <>
            <button
              onClick={() => callingService.acceptCall()}
              className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center shadow-xl hover:scale-105 transition-all cursor-pointer"
              title="Accept Call"
              aria-label="Accept Call"
            >
              <Phone className="w-6 h-6 sm:w-7 sm:h-7" />
            </button>
            <button
              onClick={() => callingService.rejectCall()}
              className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center shadow-xl hover:scale-105 transition-all cursor-pointer"
              title="Decline Call"
              aria-label="Decline Call"
            >
              <PhoneOff className="w-6 h-6 sm:w-7 sm:h-7" />
            </button>
          </>
        ) : (session.state === 'calling' || session.state === 'connecting' || session.state === 'connected') ? (
          <>
            {/* Microphone Toggle */}
            <button
              onClick={() => callingService.toggleMute()}
              className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center shadow-lg transition-all cursor-pointer border ${
                session.isMuted
                  ? 'bg-rose-600/30 border-rose-500/50 text-rose-300'
                  : 'bg-black/60 backdrop-blur-md border-white/15 text-white hover:bg-black/80'
              }`}
              title={session.isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
              aria-label={session.isMuted ? 'Unmute microphone' : 'Mute microphone'}
            >
              {session.isMuted ? <MicOff className="w-5 h-5 sm:w-6 sm:h-6" /> : <Mic className="w-5 h-5 sm:w-6 sm:h-6" />}
            </button>

            {/* Camera Toggle (Video Call only) */}
            {isVideoCall && (
              <button
                onClick={() => callingService.toggleCamera()}
                className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center shadow-lg transition-all cursor-pointer border ${
                  session.isCameraOff
                    ? 'bg-rose-600/30 border-rose-500/50 text-rose-300'
                    : 'bg-black/60 backdrop-blur-md border-white/15 text-white hover:bg-black/80'
                }`}
                title={session.isCameraOff ? 'Turn Camera On' : 'Turn Camera Off'}
                aria-label={session.isCameraOff ? 'Turn camera on' : 'Turn camera off'}
              >
                {session.isCameraOff ? <VideoOff className="w-5 h-5 sm:w-6 sm:h-6" /> : <Video className="w-5 h-5 sm:w-6 sm:h-6" />}
              </button>
            )}

            {/* End Call Button */}
            <button
              onClick={() => (session.state === 'calling' ? callingService.cancelCall() : callingService.endCall())}
              className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center shadow-xl hover:scale-105 transition-all cursor-pointer"
              title={session.state === 'calling' ? 'Cancel Call' : 'End Call'}
              aria-label="End call"
            >
              <PhoneOff className="w-6 h-6 sm:w-7 sm:h-7" />
            </button>
          </>
        ) : session.state === 'failed' || session.errorMessage ? (
          <button
            onClick={() => callingService.endCall()}
            className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center shadow-xl hover:scale-105 transition-all cursor-pointer"
            title="Close Call"
            aria-label="Close Call"
          >
            <PhoneOff className="w-6 h-6 sm:w-7 sm:h-7" />
          </button>
        ) : null}
      </div>
    </div>
  );
};
