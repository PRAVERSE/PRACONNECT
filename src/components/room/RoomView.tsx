import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Tv,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  UserPlus,
  LogOut,
  Copy,
  Check,
  Send,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Upload,
  Globe,
  Lock,
  Smile,
  X,
  Maximize,
  Minimize,
  PictureInPicture,
  Columns,
  GripVertical,
  Users,
  AlertTriangle,
  Library,
  UserX,
  Shield,
  MoreVertical,
  Volume2 as AudioOn,
  Loader,
  RotateCcw,
  RotateCw
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { RoomFile, Participant, MediaItem } from '../../types';
import { fetchMediaLibraryApi, buildMediaDownloadUrl } from '../../api/media';
import { LocalMovieController } from '../../webrtc/localMovie';
import { VoiceRing } from '../common/VoiceRing';
import { AvatarStack } from '../common/AvatarStack';
import { UserAvatar } from '../common/UserAvatar';
import { RoomPoll } from './RoomPoll';
import { LiveBadge } from '../common/LiveBadge';

const EMOJI_CATEGORIES = {
  Popular: ['🔥', '❤️', '😂', '👏', '🎉', '🚀', '😮', '💯', '👍', '🥳', '✨', '💖', '🍿', '⚡', '🙌', '😍'],
  Expressions: ['😂', '😮', '🤯', '🥳', '🥺', '😎', '💩', '🤡', '😈', '🤖', '😴', '🤩', '😡', '🤪', '🤭', '🤓'],
  Party: ['🎉', '🥂', '🍿', '🎵', '✨', '🌟', '💥', '💖', '🙌', '💃', '🎈', '🎁', '🍾', '🎶', '🎸', '🕺'],
  Symbols: ['👍', '👎', '👏', '🎯', '⚡', '💎', '🦄', '🏆', '🍉', '💯', '🤝', '🧠', '🚀', '🔮', '👑', '🔥']
};

/** Reusable Video Tile for real WebRTC camera and screen share streams */
const VideoTile: React.FC<{
  stream?: MediaStream | null;
  cameraOn: boolean;
  micOn: boolean;
  isLocal: boolean;
  name: string;
  avatar?: string;
  isHostParticipant?: boolean;
  className?: string;
  onClick?: () => void;
  title?: string;
}> = ({ stream, cameraOn, micOn, isLocal, name, avatar, isHostParticipant, className, onClick, title }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasActiveVideo, setHasActiveVideo] = useState(false);

  // Directly attach stream to video element whenever stream changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (stream && stream.getVideoTracks().length > 0 && cameraOn) {
      const videoTracks = stream.getVideoTracks();
      const hasLiveVideo = videoTracks.some((t) => t.readyState === 'live' && t.enabled);
      setHasActiveVideo(hasLiveVideo);

      console.log(`[Diagnostics] [VideoTile] Attaching cameraStream to <video> for ${name} (isLocal: ${isLocal}):`, {
        tracks: stream.getTracks().map((t) => `${t.kind}:${t.readyState}:${t.enabled}`),
        cameraOn,
        streamId: stream.id,
      });

      if (video.srcObject !== stream) {
        video.srcObject = stream;
      }
      video.play().catch(() => {});
    } else {
      setHasActiveVideo(false);
      if (video.srcObject) {
        video.srcObject = null;
      }
    }
  }, [stream, cameraOn, isLocal, name]);

  // Track event listeners to update state dynamically
  useEffect(() => {
    if (!stream) return;
    const checkTracks = () => {
      const videoTracks = stream.getVideoTracks();
      const hasLiveVideo = videoTracks.length > 0 && videoTracks.some((t) => t.readyState === 'live' && t.enabled);
      setHasActiveVideo(hasLiveVideo);
    };

    stream.addEventListener('addtrack', checkTracks);
    stream.addEventListener('removetrack', checkTracks);
    stream.getVideoTracks().forEach((t) => {
      t.addEventListener('mute', checkTracks);
      t.addEventListener('unmute', checkTracks);
      t.addEventListener('ended', checkTracks);
    });

    return () => {
      stream.removeEventListener('addtrack', checkTracks);
      stream.removeEventListener('removetrack', checkTracks);
    };
  }, [stream]);

  const showVideo = cameraOn && hasActiveVideo;

  return (
    <div
      onClick={onClick}
      className={`relative w-full h-full bg-slate-950 flex items-center justify-center overflow-hidden select-none ${className || ''}`}
      title={title}
    >
      {/* Real HTML5 Video element - stays mounted and receives stream */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        onLoadedMetadata={() => {
          if (videoRef.current) {
            console.group(`[VIDEO ELEMENT] Tile for: ${name} (isLocal: ${isLocal})`);
            console.log('srcObject:', stream ? `MediaStream(${stream.id})` : 'null');
            console.log('readyState:', videoRef.current.readyState);
            console.log('videoWidth:', videoRef.current.videoWidth);
            console.log('videoHeight:', videoRef.current.videoHeight);
            console.log('currentTime:', videoRef.current.currentTime);
            console.groupEnd();
          }
        }}
        className={`w-full h-full object-cover transition-opacity duration-200 ${
          showVideo ? 'opacity-100' : 'opacity-0 absolute inset-0 pointer-events-none'
        }`}
      />

      {/* Fallback avatar view when camera is off */}
      {!showVideo && (
        <div className="absolute inset-0 bg-gradient-to-tr from-slate-950 via-slate-900 to-indigo-950 flex flex-col items-center justify-center p-2 z-10">
          <VoiceRing active={micOn}>
            <UserAvatar
              avatar={avatar}
              name={name}
              className="w-8 h-8 border border-white/20 shadow-md text-xs font-bold"
              fallbackBg="bg-[var(--accent)] text-white"
            />
          </VoiceRing>
          <span className="mt-1 text-[8px] font-bold text-gray-400 bg-black/60 px-1.5 py-0.5 rounded-full border border-white/10">
            Camera Off
          </span>
        </div>
      )}

      {/* Host badge */}
      {isHostParticipant && (
        <div className="absolute top-1.5 left-1.5 bg-[var(--accent)] text-white text-[8px] font-extrabold px-1.5 py-0.5 rounded shadow uppercase tracking-wider z-20">
          Host
        </div>
      )}

      {/* Bottom Name & Mic status badge */}
      <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between text-[9px] text-white bg-black/80 backdrop-blur-md px-1.5 py-0.5 rounded-md border border-white/10 z-20">
        <span className="truncate font-bold max-w-[80px]">
          {name} {isLocal ? '(You)' : ''}
        </span>
        {micOn ? (
          <Mic className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
        ) : (
          <MicOff className="w-2.5 h-2.5 text-rose-400 shrink-0" />
        )}
      </div>
    </div>
  );
};

export const RoomView: React.FC = () => {
  const {
    currentRoom,
    leaveRoom,
    activeRoomTab,
    participants,
    roomSseState,
    chatMessages,
    sendRoomChatMessage,
    sendReaction,
    floatingReactions,
    micOn,
    cameraOn,
    screenShareOn,
    toggleMic,
    toggleCamera,
    retryCamera,
    toggleScreenShare,
    setInviteModalOpen,
    roomNotes,
    setRoomNotes,
    roomFiles,
    addRoomFile,
    setRoomMedia,
    setRoomPlayback,
    removeParticipant,
    muteParticipant,
    setParticipantCamera,
    userProfile,
    currentUser,
    localMediaStream,
    localScreenStream,
    remoteMediaStreams,
    remoteCameraStreams,
    remoteScreenStreams,
    remoteMovieStreams,
    mediaErrorMessage,
    mediaDiagnosticError,
    clearMediaError,
    mediaConversion,
    clearMediaConversion,
    getManagerCameraDiagnostics,
    setLocalMovieActive,
    setRoomLibraryMedia,
  } = useApp();

  const [copiedCode, setCopiedCode] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [showLibraryPicker, setShowLibraryPicker] = useState(false);
  const [localMovieStatus, setLocalMovieStatus] = useState<'idle' | 'loading' | 'active' | 'error'>('idle');
  const [localMovieError, setLocalMovieError] = useState<string | null>(null);
  // Phase 6.10 audio fix: guest browser blocked audible autoplay — offer a
  // user-gesture "Enable Movie Sound" control instead of forcing audio.
  const [movieSoundBlocked, setMovieSoundBlocked] = useState(false);
  // Host-side diagnostic when captureStream() exposed no audio track despite
  // the source movie clearly having decoded audio (browser limitation — the
  // movie is still shared video-only, never uploaded).
  const [movieAudioWarning, setMovieAudioWarning] = useState<string | null>(null);

  // Quick Reaction Picker States
  const [showReactionMenu, setShowReactionMenu] = useState(false);
  const [reactionCategory] = useState<'Popular' | 'Expressions' | 'Party' | 'Symbols'>('Popular');

  // Video Player States & Advanced Controls
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [videoError, setVideoError] = useState(false);
  const [videoErrorInfo, setVideoErrorInfo] = useState<{ title: string; message: string } | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  // Selected participant for host moderation popover
  const [modTargetUser, setModTargetUser] = useState<Participant | null>(null);

  const isHost = Boolean(currentRoom?.isHost);

  // Screen Sharing State Determination
  // The sharer is derived FIRST from the actual remote screen streams (the
  // source of truth that WebRTCManager pushes), falling back to room-flag
  // bookkeeping (screenShareOn / screenShareActive). This keeps the Stage
  // reactive even if a room:update / participant event is missed or raced,
  // while flags still drive the transient "Connecting..." placeholder.
  const sharerFromStreams = participants.find((p) => {
    const key = p.userId || p.id;
    return Boolean(key && remoteScreenStreams.has(key));
  });
  const screenSharingParticipant =
    sharerFromStreams ||
    participants.find((p) => p.screenShareOn) ||
    (currentRoom?.screenShareActive ? participants.find((p) => p.isHost) : null);
  const isLocalScreenSharing = screenShareOn || Boolean(screenSharingParticipant?.isLocal);
  const activeScreenShareStream = isLocalScreenSharing
    ? localScreenStream
    : screenSharingParticipant
    ? (remoteScreenStreams.get(screenSharingParticipant.userId || screenSharingParticipant.id) ?? null)
    : remoteScreenStreams.size > 0
    ? Array.from(remoteScreenStreams.values())[0]
    : null;
  const isAnyScreenSharingActive = Boolean(
    activeScreenShareStream ||
      localScreenStream ||
      screenShareOn ||
      currentRoom?.screenShareActive ||
      participants.some((p) => p.screenShareOn)
  );

  // STEP 12: log the exact key the Stage reads vs. the keys stored in remoteScreenStreams
  useEffect(() => {
    const readKey = screenSharingParticipant?.userId || screenSharingParticipant?.id || null;
    const storedKeys = Array.from(remoteScreenStreams.keys());
    const storedSummary = Object.fromEntries(
      Array.from(remoteScreenStreams.entries()).map(([k, s]) => [
        k,
        s.getTracks().map((t) => `${t.kind}:${t.readyState}`),
      ])
    );
    console.log('[Diagnostics] [Stage] screen stream lookup:', JSON.stringify({
      ts: new Date().toISOString(),
      sharer: screenSharingParticipant?.name ?? null,
      sharerIsHost: screenSharingParticipant?.isHost ?? null,
      sharerScreenShareOn: screenSharingParticipant?.screenShareOn ?? null,
      readKey,
      streamFound: readKey ? remoteScreenStreams.has(readKey) : false,
      streamTrackCount: readKey ? remoteScreenStreams.get(readKey)?.getTracks().length ?? 0 : 0,
      storedKeys,
      storedSummary,
      screenShareActive: currentRoom?.screenShareActive ?? null,
      hostUserId: currentRoom?.hostUserId ?? null,
      isHost: currentRoom?.isHost ?? null,
      participants: participants
        .map((p) => `${p.name}:sso=${p.screenShareOn}:host=${p.isHost}:local=${p.isLocal}`)
        .join('|'),
      localScreenShare: isLocalScreenSharing,
      localScreenStreamId: localScreenStream?.id ?? null,
    }));
  }, [remoteScreenStreams, participants, currentRoom, screenSharingParticipant, isLocalScreenSharing, localScreenStream]);

  // Screen Stage video binding — follows the same explicit useEffect pattern as
  // VideoTile (camera): imperatively attach the stream to the <video> element
  // whenever it becomes available, instead of relying on a ref callback to
  // re-fire. Handles BOTH mount orders:
  //   - video mounted before the stream arrives (effect re-runs on stream change)
  //   - stream available before the video mounts (effect re-runs when the
  //     screen-share branch mounts via isAnyScreenSharingActive)
  const screenStageVideoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = screenStageVideoRef.current;
    if (!video) return;

    if (activeScreenShareStream && activeScreenShareStream.getVideoTracks().length > 0) {
      const needsBind = video.srcObject !== activeScreenShareStream;
      if (needsBind) {
        if (!isLocalScreenSharing) {
          console.log('[SCREEN UI] rendering remote screen:', {
            ts: new Date().toISOString(),
            sharer: screenSharingParticipant?.name ?? null,
            streamId: activeScreenShareStream.id,
            tracks: activeScreenShareStream.getTracks().map((t) => `${t.kind}:${t.readyState}`),
          });
        }
        console.log('[SCREEN UI] attaching screenStream to video:', {
          ts: new Date().toISOString(),
          isLocal: isLocalScreenSharing,
          streamId: activeScreenShareStream.id,
          tracks: activeScreenShareStream.getTracks().map((t) => `${t.kind}:${t.readyState}`),
        });
        video.srcObject = activeScreenShareStream;
        video.play().catch((err: any) =>
          console.warn('[SCREEN UI] screen video play() failed:', { name: err?.name, message: err?.message })
        );
      }
    } else if (video.srcObject) {
      console.log('[SCREEN UI] clearing screenStream from video:', JSON.stringify({
        ts: new Date().toISOString(),
        streamId: video.srcObject.id,
        sharer: screenSharingParticipant?.name ?? null,
        readKey: screenSharingParticipant?.userId || screenSharingParticipant?.id || null,
        mapHasKey: screenSharingParticipant
          ? remoteScreenStreams.has(screenSharingParticipant.userId || screenSharingParticipant.id)
          : false,
        storedKeys: Array.from(remoteScreenStreams.keys()),
        isAnyScreenSharingActive,
        screenShareActive: currentRoom?.screenShareActive ?? null,
        isLocalScreenSharing,
        participants: participants
          .map((p) => `${p.name}:sso=${p.screenShareOn}:host=${p.isHost}`)
          .join('|'),
      }));
      video.srcObject = null;
    }
  }, [activeScreenShareStream, isLocalScreenSharing, isAnyScreenSharingActive]);

  // Helper to determine if a media URL is same-origin with the current page
  const isSameOrigin = (url: string): boolean => {
    try {
      const parsed = new URL(url, window.location.origin);
      return parsed.origin === window.location.origin;
    } catch {
      return false;
    }
  };

  // ─── Phase 6.10: Local Movie Mode ─────────────────────────────────────────
  // The host picks a local video file. The file NEVER leaves the device:
  // a blob URL exists only in this browser, the <video> is captured with
  // video.captureStream() and the captured stream travels host → WebRTC →
  // participants. The server only ever sees lightweight metadata.
  const localMovieVideoRef = useRef<HTMLVideoElement>(null);
  const remoteMovieStageVideoRef = useRef<HTMLVideoElement>(null);
  const localMovieStatusRef = useRef(localMovieStatus);
  localMovieStatusRef.current = localMovieStatus;

  const setLocalMovieActiveRef = useRef(setLocalMovieActive);
  setLocalMovieActiveRef.current = setLocalMovieActive;
  const localMovieControllerRef = useRef<LocalMovieController | null>(null);
  if (!localMovieControllerRef.current) {
    localMovieControllerRef.current = new LocalMovieController({
      setLocalMovieActive: (stream, metadata) => setLocalMovieActiveRef.current(stream, metadata),
      revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    });
  }

  const isLocalMovieMedia = currentRoom?.currentMedia?.mediaType === 'local-movie';
  const localMovieHostId = currentRoom?.currentMedia?.sourceUserId || currentRoom?.hostUserId || null;
  const remoteMovieStream = localMovieHostId ? (remoteMovieStreams.get(localMovieHostId) ?? null) : null;
  const hasRemoteMovieStream = Boolean(remoteMovieStream && remoteMovieStream.getTracks().length > 0);
  const localMovieHostName = currentRoom?.hostName || 'the host';
  // The host's captured source <video> becomes the visible stage only while a
  // local movie is loading/active and no screen share is taking over.
  const isHostMovieStageVisible = isHost && !isAnyScreenSharingActive && (localMovieStatus === 'loading' || localMovieStatus === 'active');

  /** The <video> element the player controls should drive right now. */
  const getStageVideo = (): HTMLVideoElement | null => {
    if (isLocalMovieMedia && isHost) return localMovieVideoRef.current;
    if (isLocalMovieMedia && !isHost) return remoteMovieStageVideoRef.current;
    return videoRef.current;
  };

  // Guest stage binding: attach the host's movie stream to the stage <video>.
  // Phase 6.10 audio fix: the remote movie element must NEVER be forced
  // muted — audible autoplay that the browser blocks is handled by the
  // "Enable Movie Sound" user-gesture banner, not by muting the element.
  useEffect(() => {
    const video = remoteMovieStageVideoRef.current;
    if (!video) return;
    if (hasRemoteMovieStream && remoteMovieStream) {
      console.log('[REMOTE MOVIE STREAM]', {
        ts: new Date().toISOString(),
        videoTracks: remoteMovieStream.getVideoTracks().length,
        audioTracks: remoteMovieStream.getAudioTracks().length,
        streamId: remoteMovieStream.id,
      });
      if (video.srcObject !== remoteMovieStream) {
        video.srcObject = remoteMovieStream;
        video.muted = false;
        video.volume = 1;
      }
      // Phase 6.10 audio trace (exact tag) — GUEST VIDEO ELEMENT: the element
      // rendering the movie stream. muted MUST be false and volume 1 unless
      // the user muted it — a silent element here is a mute/volume bug, not a
      // WebRTC bug.
      console.log('[MOVIE AUDIO DEBUG] GUEST VIDEO ELEMENT', {
        ts: new Date().toISOString(),
        muted: video.muted,
        volume: video.volume,
        paused: video.paused,
        autoplay: video.autoplay,
        readyState: video.readyState,
        srcObjectStreamId: video.srcObject ? (video.srcObject as MediaStream).id : null,
        audioTrackCount: (video as any).audioTracks ? (video as any).audioTracks.length : 'n/a',
        videoTrackCount: (video as any).videoTracks ? (video as any).videoTracks.length : 'n/a',
      });
      video
        .play()
        .then(() => setMovieSoundBlocked(false))
        .catch((err: any) => {
          if (err?.name === 'NotAllowedError') {
            // Phase 6.10 audio trace (exact tag) — the browser blocked audible
            // autoplay: the stream is fine, but sound needs a user gesture.
            console.log('[MOVIE AUDIO DEBUG] GUEST AUTOPLAY BLOCKED', {
              ts: new Date().toISOString(),
              errorName: err?.name,
              errorMessage: err?.message ?? null,
              wasUnmuted: !video.muted,
              volume: video.volume,
            });
            setMovieSoundBlocked(true);
          }
        });
    } else if (video.srcObject) {
      video.srcObject = null;
    }
  }, [remoteMovieStream, hasRemoteMovieStream]);

  // Guest playback sync: server playback state is authoritative, drift-corrected.
  useEffect(() => {
    const video = remoteMovieStageVideoRef.current;
    if (!video || !isLocalMovieMedia || isHost) return;

    const serverPlaying = Boolean(currentRoom?.playback?.isPlaying);
    const expectedPos = getExpectedServerPosition(currentRoom?.playback);

    if (serverPlaying && video.paused) {
      video
        .play()
        .then(() => {
          setIsPlaying(true);
          setMovieSoundBlocked(false);
        })
        .catch((err: any) => {
          if (err?.name === 'NotAllowedError') {
            console.log('[MOVIE AUDIO DEBUG] GUEST AUTOPLAY BLOCKED', {
              ts: new Date().toISOString(),
              errorName: err?.name,
              errorMessage: err?.message ?? null,
              wasUnmuted: !video.muted,
              volume: video.volume,
            });
            setMovieSoundBlocked(true);
          }
        });
    } else if (!serverPlaying && !video.paused) {
      video.pause();
      setIsPlaying(false);
    }
    if (Math.abs(video.currentTime - expectedPos) > 1.2) {
      video.currentTime = expectedPos;
      setCurrentTime(expectedPos);
    }
  }, [
    currentRoom?.playback?.isPlaying,
    currentRoom?.playback?.position,
    currentRoom?.playback?.updatedAt,
    isLocalMovieMedia,
    isHost,
    hasRemoteMovieStream,
  ]);

  // Unmount / room-change cleanup: detach the movie session and revoke any
  // blob URL still owned by this view.
  useEffect(() => {
    return () => {
      const controller = localMovieControllerRef.current;
      if (controller) {
        void controller.stop();
      }
      const video = localMovieVideoRef.current;
      if (video) {
        video.pause();
        video.src = '';
      }
    };
  }, []);

/** Host stops the local movie session (detach peers + clear room media). */
  const handleStopLocalMovie = async () => {
    const controller = localMovieControllerRef.current;
    await controller?.stop();
    const video = localMovieVideoRef.current;
    if (video) {
      video.pause();
      video.src = '';
    }
    setLocalMovieStatus('idle');
    setLocalMovieError(null);
    setMovieAudioWarning(null);
    setMovieSoundBlocked(false);
    setIsMuted(false);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  };

  /** Phase 6.10 audio fix — host-side user gesture to enable movie sound. */
  const enableHostMovieSound = async () => {
    const video = localMovieVideoRef.current;
    if (!video) return;
    video.muted = false;
    video.volume = 1;
    try {
      await video.play();
      setIsMuted(false);
      setVolume(1);
    } catch {
      // Browser still blocks audible autoplay — keep the banner up.
    }
  };

  /** Phase 6.10 audio fix — guest-side user gesture to enable movie sound. */
  const enableGuestMovieSound = async () => {
    const video = remoteMovieStageVideoRef.current;
    if (!video) return;
    video.muted = false;
    video.volume = 1;
    try {
      await video.play();
      setMovieSoundBlocked(false);
      setIsMuted(false);
      setVolume(1);
    } catch {
      // Still blocked — keep the banner up.
    }
  };

  // Device-change listener that clears "no camera" error if camera becomes available later
  const retryCameraRef = useRef(retryCamera);
  retryCameraRef.current = retryCamera;
  const cameraOnRef = useRef(cameraOn);
  cameraOnRef.current = cameraOn;
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.addEventListener) return;

    const handleDeviceChange = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        const audioInputs = devices.filter((d) => d.kind === 'audioinput');
        const mgr = getManagerCameraDiagnostics();
        // Diagnostic H — UI-level devicechange snapshot (the manager's own
        // recovery watcher logs the same event with full state).
        console.log('[CAMERA DEBUG] devicechange:', {
          ts: new Date().toISOString(),
          videoInputCount: videoInputs.length,
          audioInputCount: audioInputs.length,
          recoveryAttempt: mgr?.cameraRecoveryAttempts ?? null,
          destroyed: mgr?.destroyed ?? null,
          managerId: mgr?.managerId ?? null,
          cameraState: mgr?.cameraState ?? null,
        });
        if (videoInputs.length > 0 && (mediaDiagnosticError?.type === 'device_not_found' || mediaErrorMessage)) {
          console.log('[Diagnostics] Camera device detected on devicechange event. Clearing camera error state.');
          clearMediaError();
          // Restore real getUserMedia acquisition when the device reappears
          // (e.g. the camera was held by another process/tab and has been
          // released). Bounded by devicechange events — not a retry loop.
          if (cameraOnRef.current) {
            console.log('[Diagnostics] devicechange: auto-restarting camera (user intent cameraOn, device reappeared).');
            retryCameraRef.current();
          }
        }
      } catch (err) {
        console.warn('[Diagnostics] Failed enumerating devices on devicechange:', err);
      }
    };

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [mediaDiagnosticError, mediaErrorMessage, clearMediaError]);

  // Diagnostic tracking for Room Media Playback Performance
  const mediaSelectionTimeRef = useRef<number>(0);

  // Reset video error when current media changes, verify reachability and track startup performance
  useEffect(() => {
    setVideoError(false);
    setVideoErrorInfo(null);
    setIsPlaying(false);
    setAutoplayBlocked(false);
    setMovieSoundBlocked(false);
    setMovieAudioWarning(null);

    const media = currentRoom?.currentMedia;
    if (!media) return;

    mediaSelectionTimeRef.current = performance.now();

    const isLibrary = media.mediaType === 'library' || Boolean(media.mediaId);

    if (process.env.NODE_ENV !== 'production') {
      console.log('[ROOM VIDEO DEBUG] currentMedia', {
        mediaId: media.mediaId ?? null,
        title: media.title ?? 'Untitled',
        mimeType: media.mimeType ?? null,
        mediaType: media.mediaType ?? null,
        duration: media.duration ?? null,
      });
      if (isLibrary) {
        console.log('[ROOM LIBRARY DEBUG] selected', {
          mediaId: media.mediaId,
          title: media.title,
          status: 'ready',
          published: true,
        });
      }
      console.log('[ROOM MEDIA DEBUG] selected', {
        mediaId: media.mediaId ?? null,
        title: media.title ?? 'Untitled',
        mimeType: media.mimeType ?? null,
        mediaType: media.mediaType ?? null,
        duration: media.duration ?? null,
      });
    }

    const effectiveUrl =
      isLibrary && media.mediaId
        ? buildMediaDownloadUrl(media.mediaId)
        : media.url;

    if (effectiveUrl) {
      if (process.env.NODE_ENV !== 'production') {
        const elapsed = performance.now() - mediaSelectionTimeRef.current;
        console.log('[ROOM VIDEO DEBUG] stream-url', {
          mediaId: media.mediaId ?? null,
          url: effectiveUrl,
        });
        if (isLibrary) {
          console.log('[ROOM LIBRARY DEBUG] direct-stream', {
            mediaId: media.mediaId,
            url: effectiveUrl,
          });
          console.log('[ROOM LIBRARY DEBUG] conversion-bypassed');
        }
        console.log('[ROOM MEDIA DEBUG] source-ready', {
          mediaId: media.mediaId ?? null,
          elapsedMs: elapsed.toFixed(2),
        });
      }

      const sameOrigin = isSameOrigin(effectiveUrl);
      const credentialsMode: RequestCredentials = sameOrigin ? 'include' : 'omit';

      fetch(effectiveUrl, {
        headers: { Range: 'bytes=0-1023' },
        credentials: credentialsMode,
      })
        .then((res) => {
          if (process.env.NODE_ENV !== 'production') {
            const elapsed = performance.now() - mediaSelectionTimeRef.current;
            console.log('[ROOM MEDIA DEBUG] range-request', {
              status: res.status,
              contentRange: res.headers.get('content-range'),
              acceptRanges: res.headers.get('accept-ranges'),
              contentLength: res.headers.get('content-length'),
              contentType: res.headers.get('content-type'),
              elapsedMs: elapsed.toFixed(2),
            });
          }
        })
        .catch((err) => console.warn('[ROOM MEDIA DEBUG] Range check failed:', err));
    }
  }, [currentRoom?.currentMedia?.mediaId, currentRoom?.currentMedia?.url, currentRoom?.currentMedia?.title]);

  // Compute expected server playback position with elapsed time calculation
  const getExpectedServerPosition = (playback?: { isPlaying: boolean; position: number; updatedAt?: string }) => {
    if (!playback) return 0;
    if (!playback.isPlaying || !playback.updatedAt) return playback.position;
    const elapsedSec = (Date.now() - new Date(playback.updatedAt).getTime()) / 1000;
    return playback.position + Math.max(0, elapsedSec);
  };

  // Sync local HTML5 video with server authoritative playback state
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentRoom?.currentMedia) return;

    const serverPlaying = Boolean(currentRoom.playback?.isPlaying);
    const expectedPos = getExpectedServerPosition(currentRoom.playback);

    // Sync playing state
    if (serverPlaying && video.paused) {
      video
        .play()
        .then(() => {
          setIsPlaying(true);
          setAutoplayBlocked(false);
        })
        .catch((err) => {
          if (err.name === 'NotAllowedError') {
            setAutoplayBlocked(true);
          }
        });
    } else if (!serverPlaying && !video.paused) {
      video.pause();
      setIsPlaying(false);
    }

    // Sync position if drifting by more than 1.2 seconds
    if (Math.abs(video.currentTime - expectedPos) > 1.2) {
      video.currentTime = expectedPos;
      setCurrentTime(expectedPos);
    }
  }, [currentRoom?.playback?.isPlaying, currentRoom?.playback?.position, currentRoom?.playback?.updatedAt]);

  // Advanced Player Modes
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isTheaterMode, setIsTheaterMode] = useState(false);
  const [isPiP, setIsPiP] = useState(false);

  // Fullscreen Webcam Overlay States
  const [showFullscreenWebcam, setShowFullscreenWebcam] = useState(true);
  const [webcamExpanded, setWebcamExpanded] = useState(false);

  // Whiteboard Canvas State
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawColor, setDrawColor] = useState('#6C5CE7');
  const [lineWidth] = useState(3);

  // Game inside room state
  const [roomTicTacBoard, setRoomTicTacBoard] = useState<Array<string | null>>(Array(9).fill(null));
  const [roomTicTacTurn, setRoomTicTacTurn] = useState<'X' | 'O'>('X');

  // Fullscreen event listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  if (!currentRoom) return null;

  // A raw Matroska source is never directly playable in browsers — the server
  // only publishes the converted MP4. This guard keeps the player from ever
  // showing the generic stream error for an MKV URL.
  const isRawMkvUrl = (url: string): boolean => url.toLowerCase().endsWith('.mkv');

  // Phase C library media: the room stores only a mediaId reference; every
  // participant streams the playable MP4 through their own session.
  const mediaSrc =
    currentRoom.currentMedia?.mediaType === 'library' || Boolean(currentRoom.currentMedia?.mediaId)
      ? currentRoom.currentMedia.mediaId
        ? buildMediaDownloadUrl(currentRoom.currentMedia.mediaId)
        : ''
      : currentRoom.currentMedia?.url ?? '';

  const renderPreparingOverlay = (title?: string) => (
    <div className="absolute inset-0 z-30 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center text-white space-y-3">
      <div className="w-10 h-10 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      <div>
        <p className="text-sm font-bold text-white font-heading">Preparing your movie for streaming…</p>
        <p className="text-xs text-gray-300 max-w-sm mt-1">
          {title ? `"${title}" was uploaded and is being converted for browser playback. ` : ''}
          Playback starts automatically once it's ready — this can take a while for large files.
        </p>
      </div>
    </div>
  );

  const handleCopyCode = () => {
    navigator.clipboard.writeText(currentRoom.code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    sendRoomChatMessage(chatInput);
    setChatInput('');
  };

  // Video player methods (Host-authorized)
  const togglePlay = async () => {
    if (!isHost) return;
    const video = getStageVideo();
    if (video) {
      const nextPlaying = !isPlaying;
      if (nextPlaying) {
        try {
          await video.play();
          setIsPlaying(true);
          setVideoError(false);
          setAutoplayBlocked(false);
        } catch (err: any) {
          if (err.name === 'NotAllowedError') {
            setAutoplayBlocked(true);
          } else {
            console.warn('Video playback error caught:', err);
            setIsPlaying(false);
            setVideoError(true);
          }
        }
      } else {
        video.pause();
        setIsPlaying(false);
      }
      await setRoomPlayback({
        isPlaying: nextPlaying,
        position: video.currentTime,
      });
    }
  };

  const toggleMute = () => {
    const video = getStageVideo();
    if (video) {
      const nextMute = !isMuted;
      video.muted = nextMute;
      setIsMuted(nextMute);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setVolume(val);
    const video = getStageVideo();
    if (video) {
      video.volume = val;
      if (val === 0) {
        setIsMuted(true);
        video.muted = true;
      } else if (isMuted) {
        setIsMuted(false);
        video.muted = false;
      }
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isHost) return;
    const time = Number(e.target.value);
    const video = getStageVideo();
    if (video) {
      video.currentTime = time;
      setCurrentTime(time);
      setRoomPlayback({
        isPlaying,
        position: time,
      });
    }
  };

  // 10s Relative Seek (Forward / Backward)
  const seekRelative = (deltaSeconds: number) => {
    if (!isHost) return;
    const video = getStageVideo();
    if (video) {
      const maxDuration = duration || video.duration || 0;
      const targetTime = Math.max(0, Math.min(maxDuration, (video.currentTime || 0) + deltaSeconds));
      video.currentTime = targetTime;
      setCurrentTime(targetTime);
      setRoomPlayback({
        isPlaying,
        position: targetTime,
      });
    }
  };

  // Keyboard shortcuts for video playback (J: -10s backward, L: +10s forward)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (!currentRoom?.currentMedia) return;

      const key = e.key.toLowerCase();
      if (key === 'j') {
        e.preventDefault();
        seekRelative(-10);
      } else if (key === 'l') {
        e.preventDefault();
        seekRelative(10);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [currentRoom?.currentMedia, isHost, duration, isPlaying]);

  // Fullscreen Mode
  const toggleFullscreen = () => {
    if (!playerContainerRef.current) return;
    if (!document.fullscreenElement) {
      playerContainerRef.current.requestFullscreen?.().catch(() => {
        setIsFullscreen(true);
      });
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  // Picture in Picture
  const togglePiP = async () => {
    const video = getStageVideo();
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setIsPiP(false);
      } else if (document.pictureInPictureEnabled) {
        await video.requestPictureInPicture();
        setIsPiP(true);
      }
    } catch (err) {
      console.warn('PiP not active or unsupported:', err);
    }
  };

  // Format Helper
  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '00:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Canvas Whiteboard methods
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.strokeStyle = drawColor;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  // Handle Room File Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const f = e.target.files[0];
      const newFile: RoomFile = {
        id: `file-${Date.now()}`,
        name: f.name,
        size: `${(f.size / (1024 * 1024)).toFixed(1)} MB`,
        uploadedBy: userProfile.name || 'You',
        uploadedAt: 'Just now',
        type: f.type.includes('pdf') ? 'pdf' : f.type.includes('image') ? 'image' : 'doc'
      };
      addRoomFile(newFile);
    }
  };

  // Handle Room Tic-Tac-Toe
  const handleRoomCellClick = (idx: number) => {
    if (roomTicTacBoard[idx]) return;
    const next = [...roomTicTacBoard];
    next[idx] = roomTicTacTurn;
    setRoomTicTacBoard(next);
    setRoomTicTacTurn(roomTicTacTurn === 'X' ? 'O' : 'X');
  };

  return (
    <div className="w-full h-full min-h-full flex flex-col bg-[var(--bg-surface-1)] overflow-hidden text-[var(--text-primary)] select-none transition-colors duration-200">
      {/* Media Device Error Notification Banner */}
      {mediaDiagnosticError ? (
        <div className="mx-4 mt-2 p-3 bg-rose-500/15 border border-rose-500/30 rounded-xl flex items-center justify-between text-xs text-rose-200 animate-fadeIn z-30 shadow-md">
          <div className="flex items-start gap-2.5 min-w-0">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="font-bold text-white text-xs">{mediaDiagnosticError.title}</div>
              <div className="text-[11px] text-rose-200/90">{mediaDiagnosticError.message}</div>
              <div className="text-[10px] text-rose-300/80 mt-0.5 font-mono">{mediaDiagnosticError.actionableHint}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-3">
            <button
              onClick={() => {
                clearMediaError();
                retryCamera();
              }}
              className="px-2.5 py-1 bg-rose-500/30 hover:bg-rose-500/50 text-white rounded-lg font-bold text-[11px] cursor-pointer transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={clearMediaError}
              className="p-1 hover:bg-rose-500/30 rounded-lg text-rose-300 hover:text-white cursor-pointer transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ) : mediaErrorMessage ? (
        <div className="mx-4 mt-2 px-3 py-2 bg-rose-500/15 border border-rose-500/30 rounded-xl flex items-center justify-between text-xs text-rose-300 animate-fadeIn z-30">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{mediaErrorMessage}</span>
          </div>
          <button
            onClick={clearMediaError}
            className="p-1 hover:bg-rose-500/20 rounded-lg text-rose-300 hover:text-white cursor-pointer transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : null}

      {/* Top Navigation & Room Info Header Bar */}
      <div className="h-13 px-4 bg-[var(--bg-surface-1)] border-b border-[var(--border-subtle)] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <LiveBadge label="LIVE" size="sm" />
          {(roomSseState === 'DISCONNECTED' || roomSseState === 'RECOVERING_MEMBERSHIP') && (
            <span
              className="px-2 py-0.5 bg-amber-500/15 text-amber-400 text-[10px] font-bold rounded-md uppercase tracking-wider animate-pulse"
              title="Connection interrupted — reconnecting"
            >
              {roomSseState === 'RECOVERING_MEMBERSHIP' ? 'Rejoining…' : 'Reconnecting…'}
            </span>
          )}
          <h1 className="text-xs font-extrabold text-[var(--text-primary)] font-heading truncate">
            {currentRoom.name}
          </h1>

          <button
            onClick={handleCopyCode}
            className="px-2.5 py-1 bg-[var(--bg-surface-2)] border border-[var(--border-strong)] text-[10px] font-mono font-bold text-[var(--text-primary)] rounded-lg flex items-center gap-1.5 transition-all hover:border-[var(--accent)] hover:text-[var(--accent)] cursor-pointer"
            title="Click to copy room code"
          >
            {currentRoom.code}
            {copiedCode ? (
              <Check className="w-3 h-3 text-[var(--status-success)]" />
            ) : (
              <Copy className="w-3 h-3 text-[var(--text-tertiary)]" />
            )}
          </button>

          <span className="hidden sm:inline-block text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)] bg-[var(--bg-surface-2)] px-2 py-0.5 rounded border border-[var(--border-subtle)]">
            {currentRoom.category}
          </span>

          <span className="hidden md:flex text-[10px] text-[var(--text-secondary)] font-medium items-center gap-1">
            {currentRoom.privacy === 'public' ? (
              <Globe className="w-3 h-3 text-[var(--text-secondary)]" />
            ) : (
              <Lock className="w-3 h-3 text-[var(--text-tertiary)]" />
            )}
            {currentRoom.privacy}
          </span>

          {isHost && (
            <span className="px-2 py-0.5 bg-[var(--accent)]/20 text-[var(--accent)] text-[10px] font-bold rounded-md uppercase tracking-wider">
              Host
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={leaveRoom}
            className="px-3 h-8 bg-[var(--status-error-bg)] text-[var(--status-error)] hover:bg-[var(--status-error)] hover:text-white border border-[var(--status-error)]/30 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Leave</span>
          </button>
        </div>
      </div>

      {/* Main Content & Stage Layout */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {/* Active Stage Canvas */}
        <div className="flex-1 flex flex-col bg-[var(--bg-canvas)] p-3 min-w-0 overflow-y-auto">
          {/* 1. WATCH TAB */}
          {activeRoomTab === 'Watch' && (
            <div className="flex-1 flex flex-col justify-between gap-2 h-full">
              {/* Player Container */}
              <div
                ref={playerContainerRef}
                className={`relative flex-1 bg-black border border-[var(--border-strong)] rounded-2xl overflow-hidden flex items-center justify-center group min-h-[320px] shadow-lg ${
                  isFullscreen ? 'fixed inset-0 z-50 rounded-none border-none' : ''
                }`}
              >
                {/* Phase 6.10: the host's local movie source <video>. Always
                    mounted (so the ref exists the moment a file is picked);
                    it becomes the visible Watch stage once the movie is
                    loading/active. Its stream is captured and shared over
                    WebRTC — the file itself never leaves this device. */}
                {isHost && (
                  <video
                    ref={localMovieVideoRef}
                    autoPlay
                    playsInline
                    onClick={enableHostMovieSound}
                    className={`${
                      isHostMovieStageVisible
                        ? 'relative w-full h-full object-contain z-10'
                        : 'w-0 h-0 opacity-0 pointer-events-none absolute'
                    }`}
                    onLoadedMetadata={() => {
                      const v = localMovieVideoRef.current;
                      if (v) setDuration(v.duration || 0);
                    }}
                    onTimeUpdate={() => {
                      const v = localMovieVideoRef.current;
                      if (v) {
                        setCurrentTime(v.currentTime);
                        setDuration(v.duration || 0);
                      }
                    }}
                    onEnded={() => {
                      setIsPlaying(false);
                      if (isHost) {
                        setRoomPlayback({ isPlaying: false, position: 0 });
                      }
                    }}
                    onError={() => {
                      if (localMovieStatusRef.current === 'loading') {
                        setLocalMovieError("This video format isn't supported by your browser.");
                        setLocalMovieStatus('error');
                      }
                    }}
                  />
                )}

                {isAnyScreenSharingActive ? (
                  /* Screen Share Stage View */
                  <div className="relative w-full h-full flex items-center justify-center bg-slate-950">
                    <video
                      ref={screenStageVideoRef}
                      autoPlay
                      playsInline
                      muted={isLocalScreenSharing}
                      onLoadedMetadata={(e) => {
                        const v = e.currentTarget;
                        console.log('[SCREEN UI] screen video loadedmetadata:', {
                          ts: new Date().toISOString(),
                          streamId: activeScreenShareStream?.id ?? null,
                          videoWidth: v.videoWidth,
                          videoHeight: v.videoHeight,
                          readyState: v.readyState,
                          currentTime: v.currentTime,
                        });
                      }}
                      onCanPlay={() =>
                        console.log('[SCREEN UI] screen video canplay:', { ts: new Date().toISOString(), streamId: activeScreenShareStream?.id ?? null })
                      }
                      onError={(e) => {
                        const v = e.currentTarget;
                        console.error('[SCREEN UI] screen video error:', {
                          ts: new Date().toISOString(),
                          streamId: activeScreenShareStream?.id ?? null,
                          errorCode: v.error?.code ?? null,
                          errorMessage: v.error?.message ?? null,
                        });
                      }}
                      className="w-full h-full object-contain"
                    />

                    {/* Top Overlay Badge for Screen Share */}
                    <div className="absolute top-3 left-3 px-3 py-1.5 rounded-full bg-black/80 backdrop-blur-md border border-[var(--accent)]/40 text-white text-xs font-bold flex items-center gap-2 shadow-lg z-20">
                      <Monitor className="w-4 h-4 text-[var(--accent)] animate-pulse" />
                      <span>{isLocalScreenSharing ? 'Your Screen Share (Live)' : `${screenSharingParticipant?.name || currentRoom.hostName}'s Screen`}</span>
                    </div>

                    {!activeScreenShareStream && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-white space-y-2 bg-black/60 backdrop-blur-xs">
                        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mb-1" />
                        <p className="text-xs text-gray-300">Connecting to {screenSharingParticipant?.name || 'host'}'s live screen stream...</p>
                      </div>
                    )}
                  </div>
                ) : isLocalMovieMedia ? (
                  /* Phase 6.10 — Local Movie Stage. The host sees their own
                     captured <video> (rendered above); guests see the host's
                     movie stream arriving over WebRTC. No URL ever exists
                     here — the file lives only on the host's device. */
                  <div className="relative w-full h-full flex items-center justify-center bg-slate-950">
                    {!isHost && !hasRemoteMovieStream && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-white space-y-2 bg-black/60 backdrop-blur-xs">
                        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mb-1" />
                        <p className="text-xs text-gray-300">
                          Connecting to {localMovieHostName}'s live movie stream...
                        </p>
                      </div>
                    )}

                    {!isHost && hasRemoteMovieStream && remoteMovieStream && (
                      <video
                        ref={remoteMovieStageVideoRef}
                        autoPlay
                        playsInline
                        className="w-full h-full object-contain"
                        onLoadedMetadata={() => {
                          const v = remoteMovieStageVideoRef.current;
                          if (v) {
                            setDuration(v.duration || 0);
                            console.log('[MOVIE AUDIO DEBUG] GUEST VIDEO ELEMENT', {
                              ts: new Date().toISOString(),
                              muted: v.muted,
                              volume: v.volume,
                              paused: v.paused,
                              autoplay: v.autoplay,
                              readyState: v.readyState,
                              srcObject: v.srcObject ? `MediaStream(${v.srcObject.id})` : null,
                              audioTracks: (v as any).audioTracks ? (v as any).audioTracks.length : 'n/a',
                              videoTracks: (v as any).videoTracks ? (v as any).videoTracks.length : 'n/a',
                            });
                          }
                        }}
                        onTimeUpdate={() => {
                          const v = remoteMovieStageVideoRef.current;
                          if (v) {
                            setCurrentTime(v.currentTime);
                            setDuration(v.duration || 0);
                          }
                        }}
                        onPlaying={() => {
                          const v = remoteMovieStageVideoRef.current;
                          if (v && !v.muted) setMovieSoundBlocked(false);
                        }}
                        onEnded={() => setIsPlaying(false)}
                      />
                    )}

                    {/* Phase 6.10 audio fix — guest autoplay-with-sound blocked:
                        the remote movie element is NEVER force-muted; instead
                        a user-gesture control restores audio. */}
                    {!isHost && hasRemoteMovieStream && movieSoundBlocked && (
                      <div className="absolute top-14 left-1/2 -translate-x-1/2 z-40 bg-black/85 backdrop-blur-md border border-[var(--accent)]/50 text-white px-4 py-2 rounded-2xl shadow-2xl flex items-center gap-3">
                        <AudioOn className="w-4 h-4 text-[var(--accent)] animate-pulse" />
                        <span className="text-xs font-semibold">
                          Movie sound is blocked by your browser — click to enable.
                        </span>
                        <button
                          onClick={enableGuestMovieSound}
                          className="px-3 py-1 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-bold rounded-xl cursor-pointer transition-colors shadow"
                        >
                          Enable Movie Sound
                        </button>
                      </div>
                    )}

                    {/* Phase 6.10 audio fix — host: browser exposed no captured
                        audio track (movie still shared video-only). */}
                    {isHost && localMovieStatus === 'active' && movieAudioWarning && (
                      <div className="absolute top-14 left-1/2 -translate-x-1/2 z-40 bg-amber-500/20 backdrop-blur-md border border-amber-500/50 text-amber-200 px-4 py-2 rounded-2xl shadow-2xl flex items-center gap-2.5">
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                        <span className="text-xs font-semibold">{movieAudioWarning}</span>
                        <button onClick={() => setMovieAudioWarning(null)} className="text-amber-300 hover:text-white cursor-pointer">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    {/* Phase 6.10 audio fix — host: the movie element ended up
                        muted (autoplay fallback); a click or the control bar
                        restores sound without touching the WebRTC track. */}
                    {isHost && localMovieStatus === 'active' && isMuted && (
                      <div className="absolute top-14 left-1/2 -translate-x-1/2 z-40 bg-black/85 backdrop-blur-md border border-[var(--accent)]/50 text-white px-4 py-2 rounded-2xl shadow-2xl flex items-center gap-3">
                        <VolumeX className="w-4 h-4 text-[var(--status-error)]" />
                        <span className="text-xs font-semibold">Movie sound is muted — click to enable.</span>
                        <button
                          onClick={enableHostMovieSound}
                          className="px-3 py-1 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-bold rounded-xl cursor-pointer transition-colors shadow"
                        >
                          Enable Movie Sound
                        </button>
                      </div>
                    )}

                    {isHost && localMovieStatus === 'error' && (
                      <div className="absolute inset-0 z-30 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center text-white space-y-3">
                        <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto" />
                        <div>
                          <p className="text-sm font-bold text-white font-heading">
                            This video format isn't supported by your browser.
                          </p>
                          <p className="text-xs text-gray-300 max-w-sm mt-1">
                            {localMovieError || 'The selected container or codec cannot be played on this device.'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            onClick={() => setShowMediaPicker(true)}
                            className="px-3.5 h-8 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-bold rounded-xl transition-all cursor-pointer shadow-md"
                          >
                            Choose Another Movie
                          </button>
                          <button
                            onClick={() => {
                              setLocalMovieError(null);
                              setLocalMovieStatus('idle');
                            }}
                            className="px-3.5 h-8 bg-white/15 hover:bg-white/25 text-white text-xs font-bold rounded-xl border border-white/20 transition-all cursor-pointer"
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Subtle source indicator: guests see who is streaming. */}
                    {!isHost && hasRemoteMovieStream && (
                      <div className="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-black/75 backdrop-blur-md border border-white/20 text-white text-[10px] font-mono font-bold flex items-center gap-1.5 shadow z-20">
                        <Shield className="w-3 h-3 text-[var(--status-success)] shrink-0" />
                        <span>Synced with Host</span>
                      </div>
                    )}

                    {isHost && localMovieStatus === 'active' && (
                      <button
                        onClick={handleStopLocalMovie}
                        className="absolute top-3 right-3 z-20 px-3 py-1.5 bg-rose-600/80 hover:bg-rose-600 text-white text-xs font-bold rounded-xl border border-white/20 shadow-lg cursor-pointer transition-colors"
                        title="Stop streaming the local movie"
                      >
                        Stop Movie
                      </button>
                    )}
                  </div>
                ) : currentRoom.currentMedia && mediaSrc && !isRawMkvUrl(mediaSrc) ? (
                  <>
                    <video
                      ref={videoRef}
                      src={mediaSrc}
                      poster={currentRoom.currentMedia.poster}
                      className={`w-full h-full object-contain ${videoError ? 'opacity-20 blur-xs' : ''}`}
                      preload="metadata"
                      playsInline
                      onLoadStart={() => {
                        if (process.env.NODE_ENV !== 'production') {
                          console.log('[ROOM VIDEO DEBUG] loadstart', {
                            src: videoRef.current?.src,
                            currentSrc: videoRef.current?.currentSrc,
                          });
                        }
                        console.log('[Video] onLoadStart:', videoRef.current?.currentSrc);
                      }}
                      onLoadedMetadata={() => {
                        const v = videoRef.current;
                        if (v) {
                          const elapsed = mediaSelectionTimeRef.current
                            ? performance.now() - mediaSelectionTimeRef.current
                            : 0;
                          if (process.env.NODE_ENV !== 'production') {
                            console.log('[ROOM VIDEO DEBUG] metadata', {
                              duration: v.duration,
                              videoWidth: v.videoWidth,
                              videoHeight: v.videoHeight,
                            });
                            if (currentRoom?.currentMedia?.mediaType === 'library' || Boolean(currentRoom?.currentMedia?.mediaId)) {
                              console.log('[ROOM LIBRARY DEBUG] metadata-loaded', {
                                duration: v.duration,
                                videoWidth: v.videoWidth,
                                videoHeight: v.videoHeight,
                                elapsedMs: elapsed.toFixed(2),
                              });
                            }
                            console.log('[ROOM MEDIA DEBUG] metadata-loaded', {
                              duration: v.duration,
                              videoWidth: v.videoWidth,
                              videoHeight: v.videoHeight,
                              readyState: v.readyState,
                              networkState: v.networkState,
                              elapsedMs: elapsed.toFixed(2),
                            });
                          }

                          console.group('[Video] onLoadedMetadata');
                          console.log('  duration:', v.duration);
                          console.log('  videoWidth:', v.videoWidth);
                          console.log('  videoHeight:', v.videoHeight);
                          console.log('  readyState:', v.readyState);
                          console.log('  networkState:', v.networkState);
                          console.groupEnd();

                          setDuration(v.duration || 0);
                          const targetPos = currentRoom?.playback?.position ?? 0;
                          v.currentTime = targetPos;
                          setCurrentTime(targetPos);
                          if (currentRoom?.playback?.isPlaying) {
                            v.play()
                              .then(() => {
                                setIsPlaying(true);
                                setAutoplayBlocked(false);
                              })
                              .catch((err) => {
                                if (err.name === 'NotAllowedError') {
                                  setAutoplayBlocked(true);
                                }
                              });
                          }
                        }
                      }}
                      onCanPlay={() => {
                        const elapsed = mediaSelectionTimeRef.current
                          ? performance.now() - mediaSelectionTimeRef.current
                          : 0;
                        if (process.env.NODE_ENV !== 'production') {
                          console.log('[ROOM VIDEO DEBUG] canplay', {
                            readyState: videoRef.current?.readyState,
                          });
                          if (currentRoom?.currentMedia?.mediaType === 'library' || Boolean(currentRoom?.currentMedia?.mediaId)) {
                            console.log('[ROOM LIBRARY DEBUG] first-frame', {
                              source: 'canplay',
                              elapsedMs: elapsed.toFixed(2),
                            });
                          }
                          console.log('[ROOM MEDIA DEBUG] first-frame (canplay)', {
                            elapsedMs: elapsed.toFixed(2),
                          });
                        }
                        console.log('[Video] onCanPlay');
                      }}
                      onPlaying={() => {
                        const elapsed = mediaSelectionTimeRef.current
                          ? performance.now() - mediaSelectionTimeRef.current
                          : 0;
                        if (process.env.NODE_ENV !== 'production') {
                          console.log('[ROOM VIDEO DEBUG] playing', {
                            currentTime: videoRef.current?.currentTime,
                          });
                          console.log('[ROOM MEDIA DEBUG] playing', {
                            elapsedMs: elapsed.toFixed(2),
                          });
                        }
                        console.log('[Video] onPlaying');
                        setIsPlaying(true);
                        setVideoError(false);
                        setVideoErrorInfo(null);
                      }}
                      onWaiting={() => console.log('[Video] onWaiting')}
                      onStalled={() => console.log('[Video] onStalled')}
                      onSuspend={() => console.log('[Video] onSuspend')}
                      onTimeUpdate={() => {
                        if (videoRef.current) {
                          setCurrentTime(videoRef.current.currentTime);
                          setDuration(videoRef.current.duration || 0);
                        }
                      }}
                      onEnded={() => {
                        console.log('[Video] onEnded');
                        setIsPlaying(false);
                        if (isHost) {
                          setRoomPlayback({ isPlaying: false, position: 0 });
                        }
                      }}
                      onError={(event) => {
                        const video = event.currentTarget;
                        const error = video.error;

                        if (process.env.NODE_ENV !== 'production') {
                          console.log('[ROOM VIDEO DEBUG] error', {
                            code: error?.code,
                            message: error?.message,
                          });
                        }

                        console.error('[Diagnostics] VIDEO ERROR', {
                          code: error?.code,
                          message: error?.message,
                          src: video.currentSrc,
                          readyState: video.readyState,
                          networkState: video.networkState,
                        });

                        console.group('[Video] onError');
                        console.warn('  currentSrc:', video.currentSrc);
                        console.warn('  readyState:', video.readyState);
                        console.warn('  networkState:', video.networkState);
                        console.warn('  error.code:', error?.code);
                        console.warn('  error.message:', error?.message);
                        console.groupEnd();

                        setVideoError(true);
                        setIsPlaying(false);

                        if (error?.code === 4) { // MEDIA_ERR_SRC_NOT_SUPPORTED
                          setVideoErrorInfo({
                            title: 'Video Format Unsupported',
                            message: "This video format isn't supported by your browser. Please use MP4 (H.264 video with AAC audio) or WebM.",
                          });
                        } else if (error?.code === 3) { // MEDIA_ERR_DECODE
                          setVideoErrorInfo({
                            title: 'Video Decode Error',
                            message: 'The video decoding failed. The file format or codec might be corrupted or unsupported.',
                          });
                        } else if (error?.code === 2) { // MEDIA_ERR_NETWORK
                          setVideoErrorInfo({
                            title: 'Network Stream Error',
                            message: 'A network error caused the video download to fail. Please check your connection.',
                          });
                        } else {
                          setVideoErrorInfo({
                            title: 'Unable to Stream Video Source',
                            message: error?.message || 'This browser or origin could not load the video stream.',
                          });
                        }
                      }}
                      onLoadedData={() => {
                        const elapsed = mediaSelectionTimeRef.current
                          ? performance.now() - mediaSelectionTimeRef.current
                          : 0;
                        if (process.env.NODE_ENV !== 'production') {
                          if (currentRoom?.currentMedia?.mediaType === 'library' || Boolean(currentRoom?.currentMedia?.mediaId)) {
                            console.log('[ROOM LIBRARY DEBUG] first-frame', {
                              source: 'loadeddata',
                              elapsedMs: elapsed.toFixed(2),
                            });
                          }
                          console.log('[ROOM MEDIA DEBUG] first-frame (loadeddata)', {
                            elapsedMs: elapsed.toFixed(2),
                          });
                        }
                        setVideoError(false);
                        setVideoErrorInfo(null);
                      }}
                    />

                    {/* Autoplay Blocked Banner */}
                    {autoplayBlocked && (
                      <div className="absolute top-14 left-1/2 -translate-x-1/2 z-40 bg-black/85 backdrop-blur-md border border-[var(--accent)]/50 text-white px-4 py-2 rounded-2xl shadow-2xl flex items-center gap-3">
                        <AudioOn className="w-4 h-4 text-[var(--accent)] animate-pulse" />
                        <span className="text-xs font-semibold">Click to enable live stream audio & video</span>
                        <button
                          onClick={() => {
                            if (videoRef.current) {
                              videoRef.current.play().then(() => {
                                setIsPlaying(true);
                                setAutoplayBlocked(false);
                              }).catch(() => {});
                            }
                          }}
                          className="px-3 py-1 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-bold rounded-xl cursor-pointer transition-colors shadow"
                        >
                          Sync Audio
                        </button>
                      </div>
                    )}

                    {videoError && (
                      <div className="absolute inset-0 z-30 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center text-white space-y-3">
                        <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto" />
                        <div>
                          <p className="text-sm font-bold text-white font-heading">
                            {videoErrorInfo?.title || 'Unable to Stream Video Source'}
                          </p>
                          <p className="text-xs text-gray-300 max-w-sm mt-1">
                            {videoErrorInfo?.message || 'This browser or origin could not load the video stream.'}
                          </p>
                        </div>
                        {isHost && (
                          <div className="flex items-center gap-2 pt-1">
                            <button
                              onClick={() => {
                                setVideoError(false);
                                setVideoErrorInfo(null);
                                if (currentRoom?.currentMedia) {
                                  if (currentRoom.currentMedia.mediaType === 'library' && currentRoom.currentMedia.mediaId) {
                                    void setRoomLibraryMedia(currentRoom.currentMedia.mediaId);
                                  } else {
                                    setRoomMedia({ ...currentRoom.currentMedia });
                                  }
                                }
                              }}
                              className="px-3.5 h-8 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-bold rounded-xl transition-all cursor-pointer shadow-md"
                            >
                              Retry Stream
                            </button>
                            <button
                              onClick={() => setShowMediaPicker(true)}
                              className="px-3.5 h-8 bg-white/15 hover:bg-white/25 text-white text-xs font-bold rounded-xl border border-white/20 transition-all cursor-pointer"
                            >
                              Choose Stream
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : mediaConversion?.status === 'processing' && currentRoom.currentMedia?.mediaType !== 'library' && !currentRoom.currentMedia?.mediaId ? (
                  renderPreparingOverlay(mediaConversion.title)
                ) : currentRoom.currentMedia && isRawMkvUrl(currentRoom.currentMedia?.url ?? '') ? (
                  /* A raw MKV should never reach <video src> — the server
                     publishes the converted MP4 only. If a legacy path ever
                     sets an MKV URL, show preparation status instead of the
                     generic "Unable to Stream Video Source" error. */
                  renderPreparingOverlay()
                ) : mediaConversion?.status === 'failed' && currentRoom.currentMedia?.mediaType !== 'library' && !currentRoom.currentMedia?.mediaId ? (
                  <div className="absolute inset-0 z-30 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center text-white space-y-3">
                    <AlertTriangle className="w-10 h-10 text-rose-400 mx-auto" />
                    <div>
                      <p className="text-sm font-bold text-white font-heading">
                        PraConnect couldn't prepare this video for browser playback.
                      </p>
                      <p className="text-xs text-gray-300 max-w-sm mt-1">
                        The uploaded movie could not be converted on the server. Please try a different file (MP4, WebM, MOV, or MKV).
                      </p>
                    </div>
                    <button
                      onClick={clearMediaConversion}
                      className="px-3.5 h-8 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-bold rounded-xl transition-all cursor-pointer shadow-md"
                    >
                      Dismiss
                    </button>
                  </div>
                ) : (
                  <div className="text-center p-6 text-white space-y-3">
                    <Tv className="w-12 h-12 text-[var(--accent)] mx-auto" />
                    <div>
                      <p className="text-sm font-bold text-white font-heading">
                        {isHost ? 'No Media Currently Playing' : `Waiting for ${currentRoom.hostName} to select media`}
                      </p>
                      <p className="text-xs text-gray-400">
                        {isHost
                          ? 'Select a video or trailer stream to watch together with your squad.'
                          : 'The room host controls shared playback and media selection.'}
                      </p>
                    </div>
                    {isHost && (
                      <button
                        onClick={() => setShowMediaPicker(true)}
                        className="px-4 h-9 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-bold rounded-xl transition-all cursor-pointer shadow-md"
                      >
                        Select Media Stream
                      </button>
                    )}
                  </div>
                )}

                {/* Fullscreen Floating Webcam Overlay (Fullscreen Mode Only) */}
                {isFullscreen && (
                  <AnimatePresence>
                    {showFullscreenWebcam ? (
                      <motion.div
                        drag
                        dragConstraints={playerContainerRef}
                        dragElastic={0.05}
                        dragMomentum={false}
                        initial={{ opacity: 0, scale: 0.9, y: -10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="absolute top-4 left-4 z-40 bg-black/85 backdrop-blur-md border border-white/20 rounded-2xl p-2.5 shadow-2xl flex flex-col gap-2 min-w-[180px] max-w-[220px] select-none group/webcam cursor-grab active:cursor-grabbing"
                      >
                        {/* Drag Handle & Top Controls Header */}
                        <div className="flex items-center justify-between gap-2 px-1 text-[var(--text-secondary)]">
                          <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold text-[var(--text-secondary)]">
                            <GripVertical className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
                            <span>WEBCAM</span>
                          </div>

                          <div className="flex items-center gap-1">
                            {participants.length > 1 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setWebcamExpanded(!webcamExpanded);
                                }}
                                className="p-1 hover:bg-white/20 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                                title={webcamExpanded ? 'Show Local Only' : `Show All Squad (${participants.length})`}
                              >
                                <Users className="w-3.5 h-3.5" />
                              </button>
                            )}

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowFullscreenWebcam(false);
                              }}
                              className="p-1 hover:bg-white/20 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                              title="Hide Webcam Overlay"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Local User Camera Box */}
                        <div className="relative w-full aspect-[4/3] bg-gray-900 border border-white/15 rounded-xl overflow-hidden flex flex-col items-center justify-center group/tile shadow-inner">
                          <VideoTile
                            stream={localMediaStream}
                            cameraOn={cameraOn}
                            micOn={micOn}
                            isLocal={true}
                            name="You"
                            avatar={userProfile?.avatar}
                            isHostParticipant={isHost}
                          />

                          {/* Quick Mic / Camera Controls on hover */}
                          <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center gap-2 opacity-0 group-hover/tile:opacity-100 transition-opacity z-20">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleMic();
                              }}
                              className={`p-2 rounded-xl text-white cursor-pointer shadow-md transition-transform hover:scale-110 ${
                                micOn ? 'bg-[var(--accent)]' : 'bg-rose-600'
                              }`}
                              title={micOn ? 'Mute Mic' : 'Unmute Mic'}
                            >
                              {micOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                            </button>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleCamera();
                              }}
                              className={`p-2 rounded-xl text-white cursor-pointer shadow-md transition-transform hover:scale-110 ${
                                cameraOn ? 'bg-[var(--accent)]' : 'bg-rose-600'
                              }`}
                              title={cameraOn ? 'Turn Off Camera' : 'Turn On Camera'}
                            >
                              {cameraOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>

                        {/* Expanded Squad Tiles */}
                        {webcamExpanded && (
                          <div className="space-y-1.5 max-h-48 overflow-y-auto pt-1 border-t border-white/10">
                            {participants
                              .filter((p) => !p.isLocal)
                              .map((p) => (
                                <div
                                  key={p.id}
                                  className="relative w-full aspect-[16/9] bg-slate-900 border border-white/10 rounded-xl overflow-hidden flex items-center justify-center"
                                >
                                  <VideoTile
                                    stream={remoteCameraStreams.get(p.userId || p.id)}
                                    cameraOn={p.cameraOn}
                                    micOn={p.micOn}
                                    isLocal={false}
                                    name={p.name}
                                    avatar={p.avatar}
                                    isHostParticipant={p.isHost || p.userId === currentRoom.hostUserId}
                                  />
                                </div>
                              ))}
                          </div>
                        )}
                      </motion.div>
                    ) : (
                      <button
                        onClick={() => setShowFullscreenWebcam(true)}
                        className="absolute top-4 left-4 z-40 px-3 py-1.5 bg-black/80 hover:bg-black/95 backdrop-blur-md text-white text-xs font-bold rounded-xl border border-white/20 flex items-center gap-1.5 shadow-xl transition-all cursor-pointer"
                        title="Restore Webcam Feed"
                      >
                        <Video className="w-3.5 h-3.5 text-[var(--accent)]" />
                        <span>Show Webcams</span>
                      </button>
                    )}
                  </AnimatePresence>
                )}


                {/* Rich Video Player Controls Overlay Bar */}
                {currentRoom.currentMedia && (
                  <div className="absolute bottom-0 left-0 right-0 p-3.5 bg-gradient-to-t from-black/95 via-black/80 to-transparent text-[var(--text-primary)] flex flex-col gap-2.5 opacity-95 group-hover:opacity-100 transition-opacity z-20">
                    {/* Time Progress / Seek Slider */}
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-mono font-bold text-[var(--text-secondary)] w-10 text-right">
                        {formatTime(currentTime)}
                      </span>

                      <input
                        type="range"
                        min={0}
                        max={duration || 100}
                        value={currentTime}
                        onChange={handleSeek}
                        disabled={!isHost}
                        className={`flex-1 h-1.5 bg-white/25 accent-[var(--accent)] rounded-lg transition-all ${
                          isHost ? 'cursor-pointer hover:h-2' : 'cursor-not-allowed opacity-80'
                        }`}
                        title={isHost ? 'Seek playback' : 'Playback position is host-controlled'}
                      />

                      <span className="text-[10px] font-mono font-bold text-[var(--text-secondary)] w-10">
                        {formatTime(duration)}
                      </span>
                    </div>

                    {/* Controls Strip */}
                    <div className="flex items-center justify-between">
                      {/* Left: Play/Pause, -10s, +10s, Volume, Time */}
                      <div className="flex items-center gap-2.5">
                        {isHost ? (
                          <button
                            onClick={togglePlay}
                            className="w-8 h-8 rounded-full bg-white/20 hover:bg-[var(--accent)] text-[var(--text-primary)] flex items-center justify-center transition-all cursor-pointer group/play"
                            title={isPlaying ? 'Pause' : 'Play'}
                          >
                            {isPlaying ? (
                              <Pause className="w-4 h-4 fill-current text-[var(--text-primary)]" />
                            ) : (
                              <Play className="w-4 h-4 fill-current text-[var(--text-primary)] translate-x-0.5" />
                            )}
                          </button>
                        ) : (
                          <div
                            className="w-8 h-8 rounded-full bg-white/10 text-[var(--text-secondary)] flex items-center justify-center cursor-default"
                            title="Synced with host"
                          >
                            {isPlaying ? (
                              <Pause className="w-3.5 h-3.5 fill-current opacity-70" />
                            ) : (
                              <Play className="w-3.5 h-3.5 fill-current opacity-70 translate-x-0.5" />
                            )}
                          </div>
                        )}

                        {/* 10s Backward */}
                        {isHost ? (
                          <button
                            onClick={() => seekRelative(-10)}
                            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all flex items-center gap-1 text-xs font-semibold cursor-pointer active:scale-95"
                            title="Rewind 10s (J)"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span className="text-[10px] font-mono font-bold">10s</span>
                          </button>
                        ) : (
                          <div
                            className="p-1.5 rounded-lg bg-white/5 text-[var(--text-secondary)]/40 flex items-center gap-1 text-xs font-semibold cursor-default"
                            title="Synced with host"
                          >
                            <RotateCcw className="w-3.5 h-3.5 opacity-50" />
                            <span className="text-[10px] font-mono font-bold opacity-50">10s</span>
                          </div>
                        )}

                        {/* 10s Forward */}
                        {isHost ? (
                          <button
                            onClick={() => seekRelative(10)}
                            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all flex items-center gap-1 text-xs font-semibold cursor-pointer active:scale-95"
                            title="Forward 10s (L)"
                          >
                            <span className="text-[10px] font-mono font-bold">10s</span>
                            <RotateCw className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <div
                            className="p-1.5 rounded-lg bg-white/5 text-[var(--text-secondary)]/40 flex items-center gap-1 text-xs font-semibold cursor-default"
                            title="Synced with host"
                          >
                            <span className="text-[10px] font-mono font-bold opacity-50">10s</span>
                            <RotateCw className="w-3.5 h-3.5 opacity-50" />
                          </div>
                        )}

                        <div className="flex items-center gap-2 group/vol">
                          <button
                            onClick={toggleMute}
                            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-colors"
                            title={isMuted ? 'Unmute' : 'Mute'}
                          >
                            {isMuted || volume === 0 ? (
                              <VolumeX className="w-4 h-4 text-[var(--status-error)]" />
                            ) : (
                              <Volume2 className="w-4 h-4 text-[var(--text-secondary)] group-hover/vol:text-[var(--text-primary)] transition-colors" />
                            )}
                          </button>

                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={isMuted ? 0 : volume}
                            onChange={handleVolumeChange}
                            className="w-16 h-1 bg-white/30 accent-[var(--accent)] rounded cursor-pointer"
                          />
                        </div>

                        {isHost && (
                          <button
                            onClick={() => setShowMediaPicker(true)}
                            className="text-[11px] font-bold bg-white/15 hover:bg-white/25 px-2.5 py-1 rounded-lg text-[var(--text-primary)] transition-colors cursor-pointer"
                          >
                            Change Video
                          </button>
                        )}
                      </div>

                      {/* Right: Theater, PiP, Fullscreen */}
                      <div className="flex items-center gap-2 relative">

                        {/* Theater Mode Toggle */}
                        <button
                          onClick={() => setIsTheaterMode(!isTheaterMode)}
                          className={`p-1.5 rounded-lg transition-colors cursor-pointer group/theater ${
                            isTheaterMode
                              ? 'bg-[var(--accent)] text-white'
                              : 'bg-white/10 hover:bg-white/20 text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                          }`}
                          title="Toggle Theater Mode"
                        >
                          <Columns
                            className={`w-4 h-4 ${
                              isTheaterMode
                                ? 'text-white'
                                : 'text-[var(--text-secondary)] group-hover/theater:text-[var(--text-primary)]'
                            } transition-colors`}
                          />
                        </button>

                        {/* Picture-in-Picture Toggle */}
                        <button
                          onClick={togglePiP}
                          className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer group/pip"
                          title="Picture-in-Picture (Floating Player)"
                        >
                          <PictureInPicture className="w-4 h-4 text-[var(--text-secondary)] group-hover/pip:text-[var(--text-primary)] transition-colors" />
                        </button>

                        {/* Fullscreen Toggle */}
                        <button
                          onClick={toggleFullscreen}
                          className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer group/fullscreen"
                          title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                        >
                          {isFullscreen ? (
                            <Minimize className="w-4 h-4 text-[var(--text-secondary)] group-hover/fullscreen:text-[var(--text-primary)] transition-colors" />
                          ) : (
                            <Maximize className="w-4 h-4 text-[var(--text-secondary)] group-hover/fullscreen:text-[var(--text-primary)] transition-colors" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Floating Emojis */}
                <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
                  <AnimatePresence>
                    {floatingReactions.map((r) => (
                      <motion.div
                        key={r.id}
                        initial={{ opacity: 0, y: 180, scale: 0.3 }}
                        animate={{
                          opacity: [0, 1, 1, 0.8, 0],
                          y: [180, 20, -100, -240],
                          scale: [0.3, r.scale * 1.2, r.scale, r.scale, 0.6]
                        }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 2.5, ease: 'easeOut' }}
                        className="absolute bottom-8 flex flex-col items-center select-none"
                        style={{ left: `${r.x}%` }}
                      >
                        <span className="text-4xl">{r.emoji}</span>
                        <span className="mt-0.5 px-2 py-0.2 text-[9px] font-bold text-white bg-[var(--accent)] rounded-full border border-white/20 shadow">
                          {r.senderName}
                        </span>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          )}

          {/* 2. GAME TAB */}
          {activeRoomTab === 'Game' && (
            <div className="flex-1 flex flex-col items-center justify-center p-4 text-[var(--text-primary)]">
              <h2 className="text-sm font-extrabold text-[var(--text-primary)] mb-1 font-heading">Room Tic-Tac-Toe</h2>
              <p className="text-xs text-[var(--text-secondary)] mb-4">
                Play live with room members. Turn: <strong className="text-[var(--accent)] font-bold">{roomTicTacTurn}</strong>
              </p>

              <div className="w-64 aspect-square grid grid-cols-3 grid-rows-3 border border-[var(--border-strong)] rounded-2xl overflow-hidden divide-x divide-y divide-[var(--border-strong)] bg-[var(--bg-surface-1)] shadow-xl">
                {roomTicTacBoard.map((cell, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleRoomCellClick(idx)}
                    className="flex items-center justify-center text-3xl font-black hover:bg-[var(--bg-surface-2)] text-[var(--text-primary)] transition-colors cursor-pointer"
                  >
                    {cell}
                  </button>
                ))}
              </div>

              <button
                onClick={() => {
                  setRoomTicTacBoard(Array(9).fill(null));
                  setRoomTicTacTurn('X');
                }}
                className="mt-4 px-4 h-8 bg-[var(--bg-surface-2)] hover:bg-[var(--bg-surface-3)] text-xs font-bold text-[var(--text-primary)] rounded-xl border border-[var(--border-strong)] cursor-pointer transition-all"
              >
                Reset Game Board
              </button>
            </div>
          )}

          {/* 3. BOARD TAB */}
          {activeRoomTab === 'Board' && (
            <div className="flex-1 flex flex-col p-2 space-y-2">
              <div className="flex items-center justify-between pb-2 border-b border-[var(--border-subtle)]">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--text-secondary)] font-bold">Color:</span>
                  {['#6C5CE7', '#F59E0B', '#10B981', '#EF4444', '#3B82F6', '#000000', '#FFFFFF'].map((color) => (
                    <button
                      key={color}
                      onClick={() => setDrawColor(color)}
                      style={{ backgroundColor: color }}
                      className={`w-5 h-5 rounded-full ring-2 transition-transform cursor-pointer border border-black/20 ${
                        drawColor === color ? 'ring-[var(--accent)] scale-110' : 'ring-transparent'
                      }`}
                    />
                  ))}
                </div>

                <button
                  onClick={clearCanvas}
                  className="px-3 h-7 text-xs text-[var(--status-error)] border border-[var(--status-error)]/30 rounded-lg hover:bg-[var(--status-error-bg)] font-bold cursor-pointer"
                >
                  Clear Board
                </button>
              </div>

              <div className="flex-1 bg-[var(--bg-surface-1)] border border-[var(--border-strong)] rounded-xl overflow-hidden min-h-[300px]">
                <canvas
                  ref={canvasRef}
                  width={800}
                  height={500}
                  onMouseDown={startDrawing}
                  onMouseMove={draw}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  className="w-full h-full cursor-crosshair"
                />
              </div>
            </div>
          )}

          {/* 4. POLL TAB */}
          {activeRoomTab === 'Poll' && (
            <div className="flex-1 flex flex-col items-center justify-center p-4">
              <RoomPoll
                poll={null}
                isHost={isHost}
                onCreatePoll={() => {}}
                onVote={() => {}}
                onClosePoll={() => {}}
              />
            </div>
          )}

          {/* 5. NOTES TAB */}
          {activeRoomTab === 'Notes' && (
            <div className="flex-1 flex flex-col p-2 space-y-2">
              <h2 className="text-xs font-bold text-[var(--text-primary)]">Shared Room Scratchpad</h2>
              <textarea
                value={roomNotes}
                onChange={(e) => setRoomNotes(e.target.value)}
                placeholder="Type collaborative notes for everyone in room..."
                className="flex-1 p-3.5 bg-[var(--bg-surface-1)] border border-[var(--border-strong)] rounded-xl text-xs text-[var(--text-primary)] font-mono focus:outline-none focus:border-[var(--accent)] resize-none placeholder-[var(--text-tertiary)]"
              />
            </div>
          )}

          {/* 6. FILES TAB */}
          {activeRoomTab === 'Files' && (
            <div className="flex-1 flex flex-col p-2 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-[var(--border-subtle)]">
                <h2 className="text-xs font-bold text-[var(--text-primary)]">Shared Files</h2>
                <label className="px-3.5 h-8 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-bold rounded-xl cursor-pointer flex items-center gap-1.5 shadow-xs transition-colors">
                  <Upload className="w-3.5 h-3.5" />
                  Upload File
                  <input type="file" onChange={handleFileUpload} className="hidden" />
                </label>
              </div>

              <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-strong)] bg-[var(--bg-surface-1)] rounded-2xl px-4">
                {roomFiles.map((file) => (
                  <div key={file.id} className="py-3 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-[var(--text-primary)]">{file.name}</div>
                      <div className="text-[10px] text-[var(--text-secondary)]">
                        {file.size} • Uploaded by {file.uploadedBy}
                      </div>
                    </div>
                    <span className="text-[10px] px-2.5 py-0.5 bg-[var(--bg-surface-2)] text-[var(--text-secondary)] rounded-lg border border-[var(--border-subtle)] font-mono font-bold">
                      {file.type}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar: Active Squad & Room Chat (Collapsible in Theater Mode) */}
        {!isTheaterMode && (
          <div className="w-72 bg-[var(--bg-surface-1)] border-l border-[var(--border-subtle)] flex flex-col shrink-0">
            {/* Active Squad */}
            <div className="p-3 border-b border-[var(--border-subtle)] relative">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-extrabold text-[var(--text-tertiary)] uppercase tracking-wider">
                  Active Squad ({participants.length})
                </span>
                <AvatarStack
                  users={participants.map((p) => ({
                    name: p.name,
                    avatar: p.avatar,
                    isSpeaking: p.micOn,
                    isOnline: true
                  }))}
                  size="sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                {participants.map((p) => {
                  const isHostParticipant = p.isHost || p.userId === currentRoom.hostUserId;
                  const canModerate = isHost && !p.isLocal;
                  const participantStream = p.isLocal
                    ? localMediaStream
                    : remoteCameraStreams.get(p.userId || p.id);

                  return (
                    <div
                      key={p.id}
                      onClick={() => {
                        if (canModerate) {
                          setModTargetUser(modTargetUser?.id === p.id ? null : p);
                        }
                      }}
                      className={`aspect-video bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-xl relative overflow-hidden flex items-center justify-center shadow-2xs group/tile ${
                        canModerate ? 'cursor-pointer hover:border-[var(--accent)] transition-colors' : ''
                      }`}
                      title={canModerate ? `Click to moderate ${p.name}` : undefined}
                    >
                      <VideoTile
                        stream={participantStream}
                        cameraOn={p.isLocal ? cameraOn : p.cameraOn}
                        micOn={p.isLocal ? micOn : p.micOn}
                        isLocal={p.isLocal}
                        name={p.name}
                        avatar={p.avatar}
                        isHostParticipant={isHostParticipant}
                      />

                      {canModerate && (
                        <div className="absolute top-1 right-1 opacity-0 group-hover/tile:opacity-100 transition-opacity bg-black/60 p-0.5 rounded text-white z-20">
                          <MoreVertical className="w-2.5 h-2.5" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Host Moderation Popover */}
              <AnimatePresence>
                {modTargetUser && isHost && (
                  <motion.div
                    initial={{ opacity: 0, y: 5, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="absolute top-12 left-3 right-3 z-50 bg-[var(--bg-surface-1)] border border-[var(--border-strong)] rounded-2xl p-3 shadow-2xl space-y-2 text-[var(--text-primary)]"
                  >
                    <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Shield className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
                        <span className="text-xs font-bold truncate">Moderate {modTargetUser.name}</span>
                      </div>
                      <button
                        onClick={() => setModTargetUser(null)}
                        className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] rounded cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="space-y-1 text-xs">
                      <button
                        onClick={async () => {
                          const targetUid = modTargetUser.userId || modTargetUser.id;
                          await muteParticipant(targetUid, modTargetUser.micOn);
                          setModTargetUser(null);
                        }}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface-2)] hover:bg-[var(--bg-surface-3)] text-left flex items-center justify-between font-medium cursor-pointer transition-colors"
                      >
                        <span>{modTargetUser.micOn ? 'Mute microphone' : 'Unmute microphone'}</span>
                        {modTargetUser.micOn ? <MicOff className="w-3.5 h-3.5 text-rose-400" /> : <Mic className="w-3.5 h-3.5 text-emerald-400" />}
                      </button>

                      <button
                        onClick={async () => {
                          const targetUid = modTargetUser.userId || modTargetUser.id;
                          await setParticipantCamera(targetUid, !modTargetUser.cameraOn);
                          setModTargetUser(null);
                        }}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface-2)] hover:bg-[var(--bg-surface-3)] text-left flex items-center justify-between font-medium cursor-pointer transition-colors"
                      >
                        <span>{modTargetUser.cameraOn ? 'Turn off camera' : 'Turn on camera'}</span>
                        {modTargetUser.cameraOn ? <VideoOff className="w-3.5 h-3.5 text-rose-400" /> : <Video className="w-3.5 h-3.5 text-emerald-400" />}
                      </button>

                      <button
                        onClick={async () => {
                          const targetUid = modTargetUser.userId || modTargetUser.id;
                          await removeParticipant(targetUid);
                          setModTargetUser(null);
                        }}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 text-left flex items-center justify-between font-bold cursor-pointer transition-colors"
                      >
                        <span>Remove from room</span>
                        <UserX className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Room Chat */}
            <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg-canvas)]">
              <div className="p-2.5 border-b border-[var(--border-subtle)] text-[10px] font-extrabold text-[var(--text-tertiary)] uppercase tracking-wider bg-[var(--bg-surface-1)]">
                Room Chat
              </div>

              <div className="flex-1 p-3 overflow-y-auto space-y-2.5 text-xs">
                {chatMessages.map((msg) => (
                  <div key={msg.id} className="space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-extrabold text-[var(--text-primary)] text-[11px]">{msg.senderName}</span>
                      <span className="text-[9px] text-[var(--text-tertiary)] font-mono">{msg.timestamp}</span>
                    </div>
                    <p className="text-xs text-[var(--text-primary)] bg-[var(--bg-surface-1)] p-2.5 rounded-xl border border-[var(--border-subtle)] shadow-2xs">
                      {msg.text}
                    </p>
                  </div>
                ))}
              </div>

              {/* Quick Emoji Strip */}
              <div className="p-1 bg-[var(--bg-surface-1)] border-t border-[var(--border-subtle)] flex items-center justify-around">
                {['🔥', '❤️', '😂', '👏', '🎉'].map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => sendReaction(emoji)}
                    className="p-1 hover:bg-[var(--bg-surface-2)] rounded-lg text-sm cursor-pointer transition-colors"
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              {/* Chat Form */}
              <form onSubmit={handleSendChat} className="p-2 bg-[var(--bg-surface-1)] border-t border-[var(--border-subtle)] flex gap-1.5">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Chat in room..."
                  className="flex-1 h-8 px-3 bg-[var(--bg-canvas)] border border-[var(--border-strong)] rounded-xl text-xs text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[var(--accent)]"
                />
                <button
                  type="submit"
                  className="w-8 h-8 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-bold flex items-center justify-center shrink-0 cursor-pointer shadow-xs transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Control Dock */}
      <div className="h-13 px-4 bg-[var(--bg-surface-1)] border-t border-[var(--border-subtle)] flex items-center justify-center gap-3 shrink-0">
        <button
          onClick={toggleMic}
          className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
            micOn
              ? 'bg-[var(--accent)] text-white font-bold shadow-xs'
              : 'bg-[var(--status-error-bg)] text-[var(--status-error)] border border-[var(--status-error)]/30'
          }`}
          title={micOn ? 'Mute Mic' : 'Unmute Mic'}
        >
          {micOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
        </button>

        <button
          onClick={toggleCamera}
          className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
            cameraOn
              ? 'bg-[var(--accent)] text-white font-bold shadow-xs'
              : 'bg-[var(--status-error-bg)] text-[var(--status-error)] border border-[var(--status-error)]/30'
          }`}
          title={cameraOn ? 'Turn Off Camera' : 'Turn On Camera'}
        >
          {cameraOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
        </button>

        {/* Quick Reaction Dock Button & Popover */}
        <div className="relative">
          <button
            onClick={() => setShowReactionMenu(!showReactionMenu)}
            className={`px-3.5 h-9 rounded-xl flex items-center gap-1.5 transition-all cursor-pointer ${
              showReactionMenu
                ? 'bg-[var(--accent)] text-white font-bold shadow-xs'
                : 'bg-[var(--bg-surface-2)] text-[var(--text-secondary)] border border-[var(--border-strong)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-3)]'
            }`}
          >
            <Smile className="w-4 h-4" />
            <span className="text-xs font-bold">React</span>
          </button>

          {/* Quick Reaction Emoji Picker Popover */}
          <AnimatePresence>
            {showReactionMenu && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute bottom-12 left-1/2 -translate-x-1/2 mb-2 z-50 w-72 bg-[var(--bg-surface-1)] border border-[var(--border-strong)] rounded-2xl p-3 shadow-2xl flex flex-col gap-2.5 text-[var(--text-primary)]"
              >
                <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-1.5">
                  <span className="text-xs font-extrabold text-[var(--text-primary)]">Send Emoji Reaction</span>
                  <button
                    onClick={() => setShowReactionMenu(false)}
                    className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-6 gap-1 max-h-36 overflow-y-auto">
                  {EMOJI_CATEGORIES[reactionCategory].map((emoji, idx) => (
                    <button
                      key={idx}
                      onClick={() => sendReaction(emoji)}
                      className="w-8 h-8 flex items-center justify-center text-lg hover:bg-[var(--bg-surface-2)] rounded-lg cursor-pointer transition-colors"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <button
          onClick={() => setInviteModalOpen(true)}
          className="px-4 h-9 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 shadow-xs cursor-pointer"
        >
          <UserPlus className="w-3.5 h-3.5" />
          Invite
        </button>
      </div>

      {/* Change Media Selector Modal (Host Only) */}
      {showMediaPicker && isHost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-[var(--bg-surface-1)] border border-[var(--border-strong)] rounded-3xl p-6 shadow-2xl text-[var(--text-primary)] space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-[var(--text-primary)] font-heading">Select Stream Media</h3>
              <button
                onClick={() => setShowMediaPicker(false)}
                className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] rounded-lg cursor-pointer"
                aria-label="Close media picker"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Option 1 — Screen Share */}
            <button
              onClick={() => {
                toggleScreenShare();
                setShowMediaPicker(false);
              }}
              className="w-full p-3.5 bg-[var(--bg-canvas)] hover:bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] hover:border-[var(--accent)] rounded-xl text-left transition-all flex items-center gap-3 cursor-pointer group"
              aria-label="Screen Share — share your screen with everyone in the room"
            >
              <span className="w-10 h-10 rounded-xl bg-[var(--accent-subtle)] text-[var(--accent)] flex items-center justify-center shrink-0">
                <Monitor className="w-5 h-5" />
              </span>
              <span className="flex flex-col gap-0.5 min-w-0">
                <span className="text-xs font-bold text-[var(--text-primary)]">Screen Share</span>
                <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                  Share your screen with everyone in the room.
                </span>
              </span>
            </button>

            {/* Option 2 — Media Library */}
            <button
              onClick={() => {
                setShowMediaPicker(false);
                setShowLibraryPicker(true);
              }}
              className="w-full p-3.5 bg-[var(--bg-canvas)] hover:bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] hover:border-[var(--accent)] rounded-xl text-left transition-all flex items-center gap-3 cursor-pointer group"
              aria-label="Media Library — choose a video from the PraConnect library"
            >
              <span className="w-10 h-10 rounded-xl bg-[var(--accent-subtle)] text-[var(--accent)] flex items-center justify-center shrink-0">
                <Library className="w-5 h-5" />
              </span>
              <span className="flex flex-col gap-0.5 min-w-0">
                <span className="text-xs font-bold text-[var(--text-primary)]">Media Library</span>
                <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                  Choose a video from the PraConnect library.
                </span>
              </span>
            </button>

            <button
              onClick={() => setShowMediaPicker(false)}
              className="w-full h-9 bg-[var(--bg-surface-2)] text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-xl border border-[var(--border-subtle)] cursor-pointer transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Media Library Picker (Host Only) — real published library items. */}
      {showLibraryPicker && isHost && (
        <LibraryPickerModal
          roomId={currentRoom.id}
          onClose={() => setShowLibraryPicker(false)}
          onSelect={async (item) => {
            const res = await setRoomLibraryMedia(item.id);
            if (res.ok) {
              setShowLibraryPicker(false);
            }
          }}
        />
      )}
    </div>
  );
};

/** Phase C: picker over the published media library. The host picks an item;
 *  the room stores a mediaId reference and every participant streams the
 *  playable MP4 from the library (never WebRTC). */
const LibraryPickerModal: React.FC<{
  roomId: string;
  onClose: () => void;
  onSelect: (item: MediaItem) => void | Promise<void>;
}> = ({ onClose, onSelect }) => {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);

  const load = async (query: string) => {
    setBusy(true);
    setError(null);
    const res = await fetchMediaLibraryApi({ q: query, page: 1, pageSize: 50 });
    setBusy(false);
    if (res.error) {
      setError(res.error.message);
      setItems([]);
      return;
    }
    setItems(res.items);
  };

  useEffect(() => {
    void load('');
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void load(q), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const handleSelect = async (item: MediaItem) => {
    if (selectingId) return;
    setSelectingId(item.id);
    await onSelect(item);
    setSelectingId(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg bg-[var(--bg-surface-1)] border border-[var(--border-strong)] rounded-3xl p-6 shadow-2xl text-[var(--text-primary)] space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-extrabold text-[var(--text-primary)] font-heading">Pick Library Media</h3>
          <button
            onClick={onClose}
            className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] rounded-lg cursor-pointer"
            aria-label="Close library picker"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the library…"
          className="field w-full text-[13px]"
          aria-label="Search library media"
        />

        {error && (
          <p className="text-xs font-medium text-[#F59E0B] bg-[#F59E0B]/10 border border-[#F59E0B]/25 rounded-xl px-4 py-2.5">
            {error}
          </p>
        )}

        <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
          {busy && items.length === 0 && (
            <p className="text-xs text-[var(--text-secondary)] py-6 text-center">Loading library…</p>
          )}
          {!busy && items.length === 0 && (
            <p className="text-xs text-[var(--text-secondary)] py-6 text-center">
              No published media available yet.
            </p>
          )}
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => void handleSelect(item)}
              disabled={Boolean(selectingId)}
              className="w-full p-3 bg-[var(--bg-canvas)] hover:bg-[var(--bg-surface-2)] border border-[var(--border-subtle)] hover:border-[var(--accent)] rounded-xl text-left transition-all flex items-center gap-3 cursor-pointer group disabled:opacity-60"
              aria-label={`Play ${item.title} in this room`}
            >
              <span className="w-10 h-10 rounded-xl bg-[var(--accent-subtle)] text-[var(--accent)] flex items-center justify-center shrink-0">
                {selectingId === item.id ? (
                  <Loader className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Play className="w-4 h-4" aria-hidden="true" />
                )}
              </span>
              <span className="flex flex-col gap-0.5 min-w-0">
                <span className="text-xs font-bold text-[var(--text-primary)] truncate">{item.title}</span>
                <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                  {item.duration ? `${Math.round(item.duration / 60)} min` : 'Video'} ·{' '}
                  {(item.sizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB
                </span>
              </span>
            </button>
          ))}
        </div>

        <button
          onClick={onClose}
          className="w-full h-9 bg-[var(--bg-surface-2)] text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-xl border border-[var(--border-subtle)] cursor-pointer transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};
