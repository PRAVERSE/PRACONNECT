// src/webrtc/WebRTCManager.ts
// Production-grade Mesh WebRTC Manager for PraConnect Real-Time Rooms.
// Implements W3C Perfect Negotiation, resilient track replacement, screen sharing,
// ICE restarts, flexible camera constraint fallbacks, and actionable device diagnostics.

import { checkMediaSupport, diagnoseMediaError, inspectAvailableMediaDevices, logFullDeviceEnumeration, logMediaEnvironmentDiagnostics, logMediaPermissions, queryCameraPermissionState, MediaDiagnosticError } from './mediaDeviceDiagnostics';

export interface WebRTCSignalPayload {
  type: 'offer' | 'answer' | 'candidate' | 'track-meta';
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  trackId?: string;
  trackKind?: 'camera' | 'screen' | 'audio';
}

export interface WebRTCOptions {
  roomId: string;
  myUserId: string;
  onRemoteStreamChange: (userId: string, cameraStream: MediaStream | null, screenStream: MediaStream | null) => void;
  onLocalStreamChange: (stream: MediaStream | null) => void;
  onLocalScreenStreamChange?: (stream: MediaStream | null) => void;
  onError: (errorInfo: MediaDiagnosticError | string) => void;
  sendSignal: (targetUserId: string, signal: WebRTCSignalPayload) => Promise<void>;
}

/**
 * Bounded camera acquisition state machine. Transitions:
 *   IDLE -> REQUESTING (startCamera invoked)
 *   REQUESTING -> ACQUIRED (stream committed + attached to peers)
 *   REQUESTING -> FAILED_NO_DEVICE (videoinput===0 or NotFoundError)
 *   FAILED_NO_DEVICE -> WAITING_FOR_DEVICE (devicechange watcher armed)
 *   WAITING_FOR_DEVICE -> RECOVERING (devicechange reported a video input)
 *   RECOVERING -> REQUESTING (single one-shot retry via startCamera)
 *   ACQUIRED -> IDLE (stopCamera)
 *   any -> IDLE (manager destroyed)
 */
type CameraState = 'IDLE' | 'REQUESTING' | 'ACQUIRED' | 'FAILED_NO_DEVICE' | 'WAITING_FOR_DEVICE' | 'RECOVERING';

/** Parse an SDP string into a per-m-line summary for diagnostic evidence. */
function summarizeSdp(sdp: string | undefined): { section: string; mid?: string; msid?: string; content?: string; dir?: string }[] | null {
  if (!sdp) return null;
  const lines = sdp.split(/\r?\n/);
  const blocks: { section: string; mid?: string; msid?: string; content?: string; dir?: string }[] = [];
  let current: { section: string; mid?: string; msid?: string; content?: string; dir?: string } | null = null;
  for (const line of lines) {
    if (line.startsWith('m=')) {
      current = { section: line };
      blocks.push(current);
    } else if (current) {
      if (line.startsWith('a=mid:')) current.mid = line.slice(6);
      else if (line.startsWith('a=msid:')) current.msid = line.slice(7);
      else if (line.startsWith('a=content:')) current.content = line.slice(10);
      else if (/^a=(sendonly|recvonly|sendrecv|inactive)$/.test(line)) current.dir = line.slice(2);
    }
  }
  return blocks;
}

// Configurable ICE servers with public STUN fallbacks
const getIceServers = (): RTCIceServer[] => {
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];

  try {
    const envStun = (import.meta as any)?.env?.VITE_STUN_SERVER;
    if (envStun) {
      servers.unshift({ urls: envStun });
    }

    const envTurn = (import.meta as any)?.env?.VITE_TURN_SERVER;
    const envTurnUser = (import.meta as any)?.env?.VITE_TURN_USERNAME;
    const envTurnPass = (import.meta as any)?.env?.VITE_TURN_CREDENTIAL;
    if (envTurn && envTurnUser && envTurnPass) {
      servers.unshift({
        urls: envTurn,
        username: envTurnUser,
        credential: envTurnPass,
      });
    }
  } catch {}

  return servers;
};

export class WebRTCManager {
  private roomId: string;
  private myUserId: string;
  private onRemoteStreamChange: (userId: string, cameraStream: MediaStream | null, screenStream: MediaStream | null) => void;
  private onLocalStreamChange: (stream: MediaStream | null) => void;
  private onLocalScreenStreamChange?: (stream: MediaStream | null) => void;
  private onError: (errorInfo: MediaDiagnosticError | string) => void;
  private sendSignal: (targetUserId: string, signal: WebRTCSignalPayload) => Promise<void>;

  public localStream: MediaStream | null = null;
  public screenStream: MediaStream | null = null;
  public peerConnections = new Map<string, RTCPeerConnection>();
  public remoteCameraStreams = new Map<string, MediaStream>();
  public remoteScreenStreams = new Map<string, MediaStream>();
  public remoteTrackKinds = new Map<string, 'camera' | 'screen' | 'audio'>();
  private pendingCandidates = new Map<string, RTCIceCandidateInit[]>();
  private makingOffer = new Map<string, boolean>();
  // Peers that need a renegotiation offer but were not 'stable' when the
  // change happened (e.g. screen track attached mid-negotiation). The offer
  // is created as soon as the peer returns to 'stable'.
  private pendingRenegotiation = new Set<string>();
  // Explicit per-peer bookkeeping of the SCREEN sender. Camera and screen are
  // separate tracks; identifying the screen sender by sniffing contentHint is
  // fragile, so we track the RTCRtpSender directly per peer.
  private screenSenderByPeer = new Map<string, RTCRtpSender | null>();
  // trackId -> remoteUserId that sent it. Lets late-arriving track-meta
  // reclassify a video track already committed to cameraStream as screen
  // (signaling and ontrack can arrive in either order).
  private trackOwners = new Map<string, string>();
  private isDestroyed = false;
  private cameraStartPromise: Promise<boolean> | null = null;
  private lastCameraAttemptTime = 0;
  /** Stable identity of this manager instance. Every camera diagnostic logs it
   *  so StrictMode double-mount / stale-manager races are provable in traces. */
  public readonly managerId: string;
  public cameraState: CameraState = 'IDLE';
  private cameraRecoveryAttempts = 0;
  private cameraAcquisitionInFlight = false;
  private static managerCounter = 0;

  constructor(options: WebRTCOptions) {
    this.roomId = options.roomId;
    this.myUserId = options.myUserId;
    this.onRemoteStreamChange = options.onRemoteStreamChange;
    this.onLocalStreamChange = options.onLocalStreamChange;
    this.onLocalScreenStreamChange = options.onLocalScreenStreamChange;
    this.onError = options.onError;
    this.sendSignal = options.sendSignal;
    this.managerId = `${options.myUserId}-${++WebRTCManager.managerCounter}`;
  }

  /** Synchronize active peer connections with current room participants */
  public syncPeers(remoteUserIds: string[]) {
    if (this.isDestroyed) return;

    // Close and remove peers that left
    const remoteSet = new Set(remoteUserIds);
    for (const [userId] of this.peerConnections) {
      if (!remoteSet.has(userId)) {
        this.closePeerConnection(userId);
      }
    }

    // Connect to newly joined peers
    for (const userId of remoteUserIds) {
      if (userId === this.myUserId) continue;
      if (!this.peerConnections.has(userId)) {
        this.getOrCreatePeerConnection(userId);
      }
    }
  }

  /** Get or create an RTCPeerConnection for a remote peer with Perfect Negotiation */
  private getOrCreatePeerConnection(remoteUserId: string): RTCPeerConnection {
    let pc = this.peerConnections.get(remoteUserId);
    if (pc && pc.connectionState !== 'closed') {
      return pc;
    }

    console.log('[WEBRTC] creating peer', remoteUserId);
    console.log('[SCREEN DEBUG] peer created, local media state:', {
      ts: new Date().toISOString(),
      remoteUserId,
      screenStreamId: this.screenStream?.id ?? null,
      screenTracks: this.screenStream?.getTracks().map((t) => `${t.kind}:${t.readyState}`) ?? [],
      localStreamId: this.localStream?.id ?? null,
      localTracks: this.localStream?.getTracks().map((t) => `${t.kind}:${t.readyState}`) ?? [],
    });

    const config: RTCConfiguration = {
      iceServers: getIceServers(),
      iceCandidatePoolSize: 10,
    };

    pc = new RTCPeerConnection(config);
    this.peerConnections.set(remoteUserId, pc);
    this.makingOffer.set(remoteUserId, false);
    this.screenSenderByPeer.set(remoteUserId, null);

    // W3C Perfect Negotiation: onnegotiationneeded handles offer creation
    pc.onnegotiationneeded = async () => {
      if (this.isDestroyed || !pc) return;
      console.log(`[WEBRTC] onnegotiationneeded fired for ${remoteUserId}`);
      await this.createAndSendOffer(remoteUserId, pc);
    };

    // ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && !this.isDestroyed) {
        console.log(`[SIGNAL OUT] candidate -> ${remoteUserId} (${event.candidate.candidate.slice(0, 30)}...)`);
        this.sendSignal(remoteUserId, {
          type: 'candidate',
          candidate: event.candidate.toJSON(),
        }).catch((err) => console.warn(`[WebRTC] Failed sending candidate to ${remoteUserId}:`, err));
      }
    };

    // Remote media tracks
    pc.ontrack = (event) => {
      if (this.isDestroyed) return;

      const track = event.track;
      const isAudio = track.kind === 'audio';
      const explicitKind = this.remoteTrackKinds.get(track.id);
      const isScreen =
        explicitKind === 'screen' ||
        track.contentHint === 'detail' ||
        track.label.toLowerCase().includes('screen') ||
        track.label.toLowerCase().includes('window') ||
        track.label.toLowerCase().includes('display');

      console.group(`[Diagnostics] [REMOTE TRACK] from user: ${remoteUserId}`);
      console.log('track.id:', track.id);
      console.log('track.kind:', track.kind);
      console.log('track.contentHint:', track.contentHint);
      console.log('explicitKind from signal:', explicitKind);
      console.log('isScreen:', isScreen);
      console.groupEnd();

      console.log('[SCREEN DEBUG] GUEST remote track:', {
        ts: new Date().toISOString(),
        fromUserId: remoteUserId,
        trackId: track.id,
        kind: track.kind,
        readyState: track.readyState,
        receiverReadyState: event.receiver?.track?.readyState ?? null,
        transceiverMid: pc.getTransceivers().find((t) => t.receiver.track === track)?.mid ?? null,
        explicitKind: explicitKind ?? null,
        pendingTrackMeta: this.remoteTrackKinds.has(track.id),
        inferredScreen: (explicitKind ?? null) === null && isScreen,
        streamIds: event.streams?.map((s) => s.id) ?? [],
      });

      this.trackOwners.set(track.id, remoteUserId);

      if (isAudio) {
        let camStream = this.remoteCameraStreams.get(remoteUserId);
        if (!camStream) {
          camStream = new MediaStream();
          this.remoteCameraStreams.set(remoteUserId, camStream);
        }
        if (!camStream.getTracks().some((t) => t.id === track.id)) {
          camStream.addTrack(track);
        }
        console.log(`[Diagnostics] Assigned track ${track.id} (audio) to cameraStream for ${remoteUserId}`);
      } else if (isScreen) {
        let scrStream = this.remoteScreenStreams.get(remoteUserId);
        if (!scrStream) {
          scrStream = new MediaStream();
          this.remoteScreenStreams.set(remoteUserId, scrStream);
        }
        if (!scrStream.getTracks().some((t) => t.id === track.id)) {
          scrStream.addTrack(track);
        }
        console.log('[SCREEN DEBUG] remote screen track received:', {
          ts: new Date().toISOString(),
          remoteUserId,
          trackId: track.id,
          kind: track.kind,
          readyState: track.readyState,
          explicitKind: explicitKind ?? null,
        });
        console.log(`[Diagnostics] Assigned track ${track.id} (video) to screenStream for ${remoteUserId}`);
        // STEP 11: confirm the store used the exact same key the Stage reads back
        const storedScr = this.remoteScreenStreams.get(remoteUserId);
        console.log('[SCREEN DEBUG] storing remote screen stream:', {
          ts: new Date().toISOString(),
          key: remoteUserId,
          mapHasKey: this.remoteScreenStreams.has(remoteUserId),
          trackCount: storedScr?.getTracks().length ?? 0,
          liveTracks: storedScr?.getTracks().map((t) => `${t.kind}:${t.readyState}`) ?? [],
        });
      } else {
        // Camera video
        let camStream = this.remoteCameraStreams.get(remoteUserId);
        if (!camStream) {
          camStream = new MediaStream();
          this.remoteCameraStreams.set(remoteUserId, camStream);
        }

        console.log('[CAMERA DEBUG] remote camera track received:', {
          ts: new Date().toISOString(),
          fromUserId: remoteUserId,
          track: {
            id: track.id,
            kind: track.kind,
            readyState: track.readyState,
            enabled: track.enabled,
            label: track.label,
          },
          receiverReadyState: event.receiver?.track?.readyState ?? null,
          transceiverMid: pc.getTransceivers().find((t) => t.receiver.track === track)?.mid ?? null,
        });

        // Replace any stale camera video track from a previous camera session.
        // When the sender calls replaceTrack(null) on camera off, the remote
        // track stays `live` but black; appending the new track alongside it
        // leaves the <video> element bound to the dead track, so the new
        // camera never renders.
        const staleVideoTracks = camStream.getVideoTracks().filter((t) => t.id !== track.id);
        if (staleVideoTracks.length > 0) {
          const fresh = new MediaStream();
          camStream.getAudioTracks().forEach((t) => fresh.addTrack(t));
          fresh.addTrack(track);
          this.remoteCameraStreams.set(remoteUserId, fresh);
          camStream = fresh;
        } else if (!camStream.getTracks().some((t) => t.id === track.id)) {
          camStream.addTrack(track);
        }
        console.log(`[Diagnostics] Assigned track ${track.id} (video) to cameraStream for ${remoteUserId}`);
      }

      this.notifyRemoteStreamUpdate(remoteUserId);

      const notifyChange = () => {
        if (!this.isDestroyed) {
          this.notifyRemoteStreamUpdate(remoteUserId);
        }
      };

      track.onmute = notifyChange;
      track.onunmute = notifyChange;
      track.onended = () => {
        this.trackOwners.delete(track.id);
        this.remoteTrackKinds.delete(track.id);
        notifyChange();
      };
    };

    // Connection state diagnostics and automatic ICE restart
    pc.onconnectionstatechange = () => {
      console.log('[WEBRTC] connection state', pc?.connectionState);
      if (pc?.connectionState === 'failed') {
        console.warn(`[WebRTC] Connection failed with ${remoteUserId}, restarting ICE...`);
        pc.restartIce?.();
      } else if (pc?.connectionState === 'closed') {
        this.closePeerConnection(remoteUserId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[WEBRTC] ICE state', pc?.iceConnectionState);
      // STEP 6: per-m-line health — a second m-line added via renegotiation can
      // stay unconnected even while the first m-line keeps flowing.
      const transceivers = pc.getTransceivers().map((t) => ({
        mid: t.mid,
        kind: t.receiver.track?.kind ?? null,
        direction: t.direction,
        currentDirection: t.currentDirection,
        senderTrack: t.sender.track ? `${t.sender.track.kind}:${t.sender.track.contentHint ?? 'none'}` : null,
        receiverReady: t.receiver.track?.readyState ?? null,
      }));
      console.log('[WEBRTC] ICE state transceivers:', { ts: new Date().toISOString(), transceivers });
      if (pc?.iceConnectionState === 'failed') {
        pc.restartIce?.();
      }
    };

    // Attach local media tracks to this peer connection
    this.attachLocalTracksToPeer(remoteUserId, pc);

    // A peer created AFTER screen sharing started must also receive the
    // track-meta for the already-attached screen track (its initial offer
    // carries the screen m-line; metadata makes guest classification
    // order-independent).
    const screenTrack = this.screenStream?.getVideoTracks()[0] || null;
    if (screenTrack) {
      this.sendSignal(remoteUserId, {
        type: 'track-meta',
        trackId: screenTrack.id,
        trackKind: 'screen',
      }).catch((err: any) => {
        console.warn(`[WebRTC] track-meta send failed to ${remoteUserId}:`, { name: err?.name, message: err?.message });
      });
    }

    return pc;
  }

  private notifyRemoteStreamUpdate(remoteUserId: string) {
    const camStream = this.remoteCameraStreams.get(remoteUserId);
    const scrStream = this.remoteScreenStreams.get(remoteUserId);
    const validCam = camStream && camStream.getTracks().some((t) => t.readyState === 'live') ? camStream : null;
    const validScr = scrStream && scrStream.getTracks().some((t) => t.readyState === 'live') ? scrStream : null;
    this.onRemoteStreamChange(remoteUserId, validCam, validScr);
  }

  /** Create and send a new offer to a peer (Perfect Negotiation compatible, duplicate-safe) */
  private async createAndSendOffer(remoteUserId: string, pc: RTCPeerConnection): Promise<void> {
    if (this.isDestroyed || !pc) return;
    if (this.makingOffer.get(remoteUserId)) {
      console.log(`[WEBRTC] negotiation already in flight for ${remoteUserId}, skipping duplicate offer`);
      return;
    }
    try {
      this.makingOffer.set(remoteUserId, true);
      console.log(`[WEBRTC] creating offer for ${remoteUserId} (signalingState: ${pc.signalingState})`);
      await pc.setLocalDescription();
      if (pc.localDescription) {
        const summary = summarizeSdp(pc.localDescription.sdp);
        const videoMlines = (summary ?? []).filter((b) => b.section.startsWith('m=video'));
        const screenStreamId = this.screenStream?.id ?? null;
        const screenInSdp = screenStreamId
          ? videoMlines.some((b) => b.msid?.startsWith(`${screenStreamId} `))
          : videoMlines.length > 1;
        console.log('[SCREEN DEBUG] screen offer created:', {
          ts: new Date().toISOString(),
          remoteUserId,
          videoMlineCount: videoMlines.length,
          signalingState: pc.signalingState,
          screenTrackAttached: this.screenStream?.getVideoTracks().some((t) => t.readyState === 'live') ?? false,
          screenInSdp,
          videoMlines: videoMlines.map((b) => `${b.mid ?? '?'}:${b.dir ?? '?'}:msid=${b.msid ?? 'none'}`),
        });
        // STEP 3: verify the offer actually carries the screen m-line, not just that "an offer was sent"
        console.groupCollapsed(`[SIGNAL OUT] offer -> ${remoteUserId} SDP (from: ${this.myUserId}, ts: ${new Date().toISOString()})`);
        console.log('m-line summary:', summary);
        console.log('full SDP:', pc.localDescription.sdp);
        console.groupEnd();
        await this.sendSignal(remoteUserId, {
          type: 'offer',
          sdp: pc.localDescription,
        });
        console.log('[SCREEN DEBUG] screen SDP sent:', { ts: new Date().toISOString(), remoteUserId, screenInSdp });
      }
    } catch (err: any) {
      console.warn(`[WebRTC] Negotiation error for ${remoteUserId}:`, { name: err?.name, message: err?.message, detail: err });
    } finally {
      this.makingOffer.set(remoteUserId, false);
    }
  }

  /** Attach local audio / video tracks to a specific peer connection */
  private attachLocalTracksToPeer(remoteUserId: string, pc: RTCPeerConnection) {
    if (this.isDestroyed) return;

    const audioTrack = this.localStream?.getAudioTracks()[0] || null;
    const cameraVideoTrack = this.localStream?.getVideoTracks()[0] || null;
    const screenVideoTrack = this.screenStream?.getVideoTracks()[0] || null;

    console.log(`[WEBRTC] attachLocalTracksToPeer -> ${remoteUserId}: audio=${audioTrack ? 'present' : 'none'} camera=${cameraVideoTrack ? 'present' : 'none'} screen=${screenVideoTrack ? 'present' : 'none'}`);

    if (cameraVideoTrack) {
      cameraVideoTrack.contentHint = 'motion';
    }
    if (screenVideoTrack) {
      screenVideoTrack.contentHint = 'detail';
    }

    // Audio
    const audioSender = pc.getSenders().find((s) => s.track?.kind === 'audio') ||
      pc.getTransceivers().find((t) => t.sender.track?.kind === 'audio' || t.receiver?.track?.kind === 'audio')?.sender;

    if (audioSender) {
      audioSender.replaceTrack(audioTrack).catch((err: any) => {
        console.warn(`[WebRTC] audio replaceTrack failed for ${remoteUserId}:`, { name: err?.name, message: err?.message });
      });
    } else if (audioTrack && this.localStream) {
      try {
        pc.addTrack(audioTrack, this.localStream);
        console.log(`[WEBRTC] added audio track for ${remoteUserId}`);
      } catch (err: any) {
        console.warn(`[WebRTC] addTrack(audio) failed for ${remoteUserId}:`, { name: err?.name, message: err?.message });
      }
    }

    // Camera Video Sender
    const senders = pc.getSenders();
    const bookkeptScreenSender = this.screenSenderByPeer.get(remoteUserId) ?? null;
    // Camera sender is any video sender that is NOT the bookkept screen
    // sender — explicit bookkeeping, never inferred from contentHint alone.
    let cameraSender = senders.find(
      (s) => s.track?.kind === 'video' && s !== bookkeptScreenSender && s.track !== screenVideoTrack && s.track?.contentHint !== 'detail'
    );

    if (cameraSender) {
      cameraSender.replaceTrack(cameraVideoTrack).catch((err: any) => {
        console.warn(`[WebRTC] camera replaceTrack failed for ${remoteUserId}:`, { name: err?.name, message: err?.message });
      });
    } else if (cameraVideoTrack && this.localStream) {
      try {
        pc.addTrack(cameraVideoTrack, this.localStream);
        console.log(`[WEBRTC] added camera track for ${remoteUserId}`);
      } catch (err: any) {
        console.warn(`[WebRTC] addTrack(camera) failed for ${remoteUserId}:`, { name: err?.name, message: err?.message });
      }
    }

    // Screen Video Sender — explicit per-peer bookkeeping
    this.attachScreenTrackToPeer(remoteUserId, pc);

    // STEP 2 (post-verification): confirm the screen track is actually present on a sender
    const sendersAfter = pc.getSenders().map((s) => ({
      id: s.track?.id ?? null,
      kind: s.track?.kind ?? null,
      label: s.track?.label ?? null,
      readyState: s.track?.readyState ?? null,
      contentHint: s.track?.contentHint ?? null,
    }));
    const screenInSenders = pc.getSenders().some((s) => s.track && screenVideoTrack && s.track.id === screenVideoTrack.id);
    console.log(`[SCREEN DEBUG] peer senders after screen attach (${remoteUserId}):`, {
      ts: new Date().toISOString(),
      screenInSenders,
      senders: sendersAfter,
    });
  }

  /**
   * Attach / replace / remove the SCREEN track on one peer using explicit
   * per-peer sender bookkeeping (screenSenderByPeer).
   * - screen stream present + no screen sender  -> pc.addTrack(screenTrack, screenStream)
   * - screen stream present + existing sender   -> sender.replaceTrack(screenTrack)
   * - screen stream absent                      -> sender.replaceTrack(null) (keeps m-line for restart)
   */
  private attachScreenTrackToPeer(remoteUserId: string, pc: RTCPeerConnection) {
    if (this.isDestroyed) return;
    const screenStream = this.screenStream;
    const screenTrack = screenStream?.getVideoTracks()[0] || null;

    let screenSender = this.screenSenderByPeer.get(remoteUserId) ?? null;
    if (screenSender && !pc.getSenders().includes(screenSender)) {
      // Bookkeeping references a sender from a previous pc — reset it.
      screenSender = null;
      this.screenSenderByPeer.set(remoteUserId, null);
    }

    if (screenTrack && screenStream) {
      screenTrack.contentHint = 'detail';
      if (screenSender) {
        if (screenSender.track === screenTrack) {
          console.log('[SCREEN DEBUG] screen track already attached to peer:', {
            ts: new Date().toISOString(),
            remoteUserId,
            trackId: screenTrack.id,
            readyState: screenTrack.readyState,
          });
          return;
        }
        console.log('[SCREEN DEBUG] replacing screen sender on peer:', {
          ts: new Date().toISOString(),
          remoteUserId,
          trackId: screenTrack.id,
          readyState: screenTrack.readyState,
        });
        screenSender.replaceTrack(screenTrack).catch((err: any) => {
          console.warn(`[WebRTC] screen replaceTrack failed for ${remoteUserId}:`, { name: err?.name, message: err?.message });
        });
        this.screenSenderByPeer.set(remoteUserId, screenSender);
      } else {
        console.log('[SCREEN DEBUG] adding screen track to peer:', {
          ts: new Date().toISOString(),
          remoteUserId,
          trackId: screenTrack.id,
          existingScreenSender: null,
          senderCountBefore: pc.getSenders().length,
        });
        try {
          const sender = pc.addTrack(screenTrack, screenStream);
          this.screenSenderByPeer.set(remoteUserId, sender);
          console.log('[SCREEN DEBUG] screen track attached to existing peer:', {
            ts: new Date().toISOString(),
            remoteUserId,
            trackId: screenTrack.id,
            readyState: screenTrack.readyState,
            senderCount: pc.getSenders().length,
            videoSenderCount: pc.getSenders().filter((s) => s.track?.kind === 'video').length,
          });
        } catch (err: any) {
          console.warn(`[WebRTC] addTrack(screen) failed for ${remoteUserId}:`, { name: err?.name, message: err?.message });
        }
      }
    } else if (screenSender && screenSender.track) {
      console.log('[SCREEN DEBUG] clearing screen sender on peer:', {
        ts: new Date().toISOString(),
        remoteUserId,
        previousTrackId: screenSender.track.id,
      });
      screenSender.replaceTrack(null).catch((err: any) => {
        console.warn(`[WebRTC] screen replaceTrack(null) failed for ${remoteUserId}:`, { name: err?.name, message: err?.message });
      });
      this.screenSenderByPeer.set(remoteUserId, screenSender);
    }
  }

  /** Update or replace tracks across all active peer connections */
  public updateLocalTracksOnAllPeers() {
    if (this.isDestroyed) return;

    for (const [remoteUserId, pc] of this.peerConnections) {
      if (pc.connectionState === 'closed') continue;
      console.log(`[WEBRTC] updateLocalTracksOnAllPeers -> ${remoteUserId} (signalingState: ${pc.signalingState})`);
      this.attachLocalTracksToPeer(remoteUserId, pc);
    }
  }

  /**
   * Request a renegotiation offer for a peer. Duplicate-safe and
   * state-aware: if the peer is mid-negotiation the offer is deferred until
   * it returns to 'stable' (see handleSignal), so a screen track added at
   * ANY moment is always negotiated — never silently dropped.
   */
  public requestRenegotiation(remoteUserId: string, reason: string) {
    if (this.isDestroyed) return;
    const pc = this.peerConnections.get(remoteUserId);
    if (!pc || pc.connectionState === 'closed') {
      console.log(`[SCREEN DEBUG] renegotiation required but no live peer for ${remoteUserId} (${reason}); will be attached when peer is created`);
      return;
    }
    if (pc.signalingState !== 'stable') {
      console.log(`[SCREEN DEBUG] renegotiation required for ${remoteUserId} (${reason}) but signalingState=${pc.signalingState}; queueing until stable`);
      this.pendingRenegotiation.add(remoteUserId);
      return;
    }
    console.log(`[SCREEN DEBUG] renegotiation required for ${remoteUserId} (${reason})`);
    this.createAndSendOffer(remoteUserId, pc);
  }

  /** Handle incoming WebRTC signaling message from remote peer (Perfect Negotiation) */
  public async handleSignal(fromUserId: string, payload: WebRTCSignalPayload) {
    if (this.isDestroyed || fromUserId === this.myUserId) return;

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[SIGNAL IN] ${payload.type} from: ${fromUserId} (my: ${this.myUserId})`);
    }

    const pc = this.getOrCreatePeerConnection(fromUserId);
    const isPolite = this.myUserId > fromUserId;

    try {
      if (payload.type === 'offer' && payload.sdp) {
        const isMakingOffer = Boolean(this.makingOffer.get(fromUserId));
        const offerCollision = isMakingOffer || pc.signalingState !== 'stable';

        if (offerCollision && !isPolite) {
          return;
        }

        if (offerCollision && isPolite) {
          await pc.setLocalDescription({ type: 'rollback' } as RTCSessionDescriptionInit).catch(() => {});
        }

        // STEP 7: confirm the received offer actually contains the screen m-line
        const remoteSummary = summarizeSdp(payload.sdp.sdp);
        const remoteVideoMlines = (remoteSummary ?? []).filter((b) => b.section.startsWith('m=video'));
        console.log('[SCREEN DEBUG] remote offer received:', {
          ts: new Date().toISOString(),
          fromUserId,
          videoMlines: remoteVideoMlines.map((b) => `${b.mid ?? '?'}:${b.dir ?? '?'}:msid=${b.msid ?? 'none'}`),
        });
        console.groupCollapsed(`[SIGNAL IN] offer from: ${fromUserId} SDP (ts: ${new Date().toISOString()})`);
        console.log('m-line summary:', remoteSummary);
        console.log('full SDP:', payload.sdp.sdp);
        console.groupEnd();

        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        // STEP 8: confirm setRemoteDescription succeeded and the resulting state
        console.log('[SCREEN DEBUG] remote transceivers:', {
          ts: new Date().toISOString(),
          fromUserId,
          transceivers: pc.getTransceivers().map((t) => ({ mid: t.mid, kind: t.receiver.track?.kind ?? null, dir: t.direction })),
        });
        console.log('[WEBRTC] offer setRemoteDescription OK:', {
          ts: new Date().toISOString(),
          signalingState: pc.signalingState,
          transceivers: pc.getTransceivers().map((t) => ({ mid: t.mid, dir: t.direction, kind: t.receiver.track?.kind ?? null })),
        });

        // Drain pending candidates
        const pending = this.pendingCandidates.get(fromUserId) || [];
        for (const candidate of pending) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
        }
        this.pendingCandidates.delete(fromUserId);

        // Create and send answer
        await pc.setLocalDescription();
        if (pc.localDescription) {
          if (process.env.NODE_ENV !== 'production') {
            console.log(`[SIGNAL OUT] answer -> ${fromUserId} (from: ${this.myUserId})`);
          }
          await this.sendSignal(fromUserId, {
            type: 'answer',
            sdp: pc.localDescription,
          });
        }
      } else if (payload.type === 'answer' && payload.sdp) {
        console.log('[WEBRTC] answer received');
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          // STEP 5: confirm the answer was applied and the pc is stable again
          console.log('[WEBRTC] answer setRemoteDescription OK:', {
            ts: new Date().toISOString(),
            signalingState: pc.signalingState,
            iceState: pc.iceConnectionState,
            transceivers: pc.getTransceivers().map((t) => ({ mid: t.mid, dir: t.currentDirection, kind: t.receiver.track?.kind ?? null })),
          });

          // Deferred renegotiation: a screen track (or other track change) that
          // arrived while this peer was mid-negotiation is offered NOW.
          if (this.pendingRenegotiation.delete(fromUserId)) {
            console.log('[SCREEN DEBUG] peer stable again, sending deferred renegotiation offer:', { ts: new Date().toISOString(), fromUserId });
            this.createAndSendOffer(fromUserId, pc);
          }

          // Drain pending candidates
          const pending = this.pendingCandidates.get(fromUserId) || [];
          for (const candidate of pending) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
          }
          this.pendingCandidates.delete(fromUserId);
        }
      } else if (payload.type === 'candidate' && payload.candidate) {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {});
        } else {
          const pending = this.pendingCandidates.get(fromUserId) || [];
          pending.push(payload.candidate);
          this.pendingCandidates.set(fromUserId, pending);
        }
      } else if (payload.type === 'track-meta' && payload.trackId && payload.trackKind) {
        this.remoteTrackKinds.set(payload.trackId, payload.trackKind);
        console.log(`[Diagnostics] Received track-meta from ${fromUserId}: track ${payload.trackId} is ${payload.trackKind}`);

        // Order-independence: if the video track's ontrack already fired
        // before this track-meta (order B), it was committed to the peer's
        // cameraStream. Reclassify it to the screenStream now.
        if (payload.trackKind === 'screen') {
          const owner = this.trackOwners.get(payload.trackId);
          if (owner && this.remoteCameraStreams.has(owner)) {
            const cam = this.remoteCameraStreams.get(owner)!;
            const migrated = cam.getTracks().filter((t) => t.id === payload.trackId);
            if (migrated.length > 0) {
              migrated.forEach((t) => cam.removeTrack(t));
              let scr = this.remoteScreenStreams.get(owner);
              if (!scr) {
                scr = new MediaStream();
                this.remoteScreenStreams.set(owner, scr);
              }
              migrated.forEach((t) => scr!.addTrack(t));
              console.log('[SCREEN DEBUG] late track-meta: migrated video track to screenStream:', {
                ts: new Date().toISOString(),
                fromUserId: owner,
                trackId: payload.trackId,
                screenTrackCount: scr.getTracks().length,
              });
              this.notifyRemoteStreamUpdate(owner);
            }
          }
        }
        this.notifyRemoteStreamUpdate(fromUserId);
      }
    } catch (err) {
      console.warn(`[WebRTC] Signal handling error from ${fromUserId}:`, err);
    }
  }

  /**
   * Log + stop a track. Every track.stop() in this manager goes through here
   * so any path that could kill the camera is identifiable in traces.
   */
  private stopTrackSafely(track: MediaStreamTrack, caller: string, media: 'camera' | 'screen' | 'audio') {
    const inCameraStream = this.localStream?.getTracks().some((t) => t.id === track.id) ?? false;
    const inScreenStream = this.screenStream?.getTracks().some((t) => t.id === track.id) ?? false;
    console.log(`[${media.toUpperCase()} DEBUG] ABOUT TO STOP TRACK`, {
      ts: new Date().toISOString(),
      caller,
      streamKind: track.kind,
      trackId: track.id,
      label: track.label,
      readyState: track.readyState,
      enabled: track.enabled,
      muted: track.muted,
      inCameraStream,
      inScreenStream,
      owningStreamId: inCameraStream
        ? (this.localStream?.id ?? null)
        : inScreenStream
        ? (this.screenStream?.id ?? null)
        : 'unowned/transient',
      cameraTracks: this.localStream?.getVideoTracks().map((t) => `${t.kind}:${t.readyState}`) ?? [],
      screenTracks: this.screenStream?.getTracks().map((t) => `${t.kind}:${t.readyState}`) ?? [],
    });
    console.trace('[MEDIA DEBUG] TRACK STOPPED', {
      trackId: track.id,
      kind: track.kind,
      label: track.label,
      readyState: track.readyState,
      caller,
      intendedMedia: media,
    });
    // Separation invariant: a "camera" stop must never touch screen tracks and
    // a "screen" stop must never touch camera tracks. If this ever fires, the
    // camera/screen ownership model is broken.
    if (media === 'screen' && inCameraStream) {
      console.warn('[MEDIA DEBUG] SEPARATION VIOLATION: attempting to stop a CAMERA track as SCREEN', {
        trackId: track.id, caller,
      });
    }
    if (media === 'camera' && inScreenStream) {
      console.warn('[MEDIA DEBUG] SEPARATION VIOLATION: attempting to stop a SCREEN track as CAMERA', {
        trackId: track.id, caller,
      });
    }
    try {
      track.stop();
    } catch (err: any) {
      console.warn(`[MEDIA DEBUG] track.stop() threw in ${caller}:`, { name: err?.name, message: err?.message });
    }
  }

  /**
   * Bounded, one-shot camera recovery. When enumerateDevices() reports zero
   * video inputs (permission granted), getUserMedia can only throw
   * NotFoundError. Instead of retry loops, we wait for a devicechange event
   * and retry exactly once when the browser reports a video input again.
   * Multiple failures re-arm the watcher; it never loops.
   */
  private cameraRecoveryDisarm: (() => void) | null = null;

  private armCameraDeviceRecovery() {
    if (this.cameraRecoveryDisarm) {
      console.log('[CAMERA LIFECYCLE] recovery watcher already armed');
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.addEventListener) {
      console.log('[CAMERA LIFECYCLE] devicechange not available — recovery watcher cannot be armed');
      return;
    }
    console.log('[CAMERA LIFECYCLE] arming one-shot devicechange recovery watcher:', {
      ts: new Date().toISOString(),
      videoInputsReported: 0,
    });

    const handler = async () => {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === 'videoinput');
      const audioInputs = devices.filter((d) => d.kind === 'audioinput');

      // Diagnostic H — every devicechange observed by the recovery watcher.
      console.log('[CAMERA DEBUG] devicechange:', {
        ts: new Date().toISOString(),
        videoInputCount: videoInputs.length,
        audioInputCount: audioInputs.length,
        recoveryAttempt: this.cameraRecoveryAttempts,
        destroyed: this.isDestroyed,
        managerId: this.managerId,
        cameraState: this.cameraState,
      });

      if (this.isDestroyed || videoInputs.length === 0) {
        return;
      }
      this.cameraRecoveryAttempts += 1;
      console.log('[CAMERA LIFECYCLE] video input reappeared — performing one-shot camera retry', {
        ts: new Date().toISOString(),
        videoInputs: videoInputs.map((d) => ({ kind: d.kind, label: d.label, deviceId: d.deviceId })),
        recoveryAttempt: this.cameraRecoveryAttempts,
        managerId: this.managerId,
      });
      this.disarmCameraDeviceRecovery();
      // Bypass the 1500ms cooldown so a freshly reappeared device is
      // acquired immediately instead of being silently throttled.
      this.lastCameraAttemptTime = 0;
      this.setCameraState('RECOVERING', 'devicechange reported a video input — one-shot retry');
      this.startCamera().catch(() => {});
    };

    navigator.mediaDevices.addEventListener('devicechange', handler);
    this.cameraRecoveryDisarm = () => {
      navigator.mediaDevices.removeEventListener('devicechange', handler);
      this.cameraRecoveryDisarm = null;
    };
  }

  private disarmCameraDeviceRecovery() {
    if (this.cameraRecoveryDisarm) {
      this.cameraRecoveryDisarm();
    }
  }

  /** Log camera state transitions. Only the current (non-destroyed) manager
   *  may advance the camera state machine. */
  private setCameraState(next: CameraState, reason: string) {
    if (this.cameraState !== next) {
      console.log('[CAMERA STATE]', `${this.cameraState} -> ${next}`, {
        ts: new Date().toISOString(),
        reason,
        managerId: this.managerId,
        destroyed: this.isDestroyed,
      });
      this.cameraState = next;
    }
  }

  /**
   * Separation invariant check: a camera track must never live inside
   * screenStream, and a screen track must never live inside localStream.
   * Pure diagnostic — never mutates anything.
   */
  private assertMediaSeparation(action: string) {
    const cameraTrackIds = new Set((this.localStream?.getTracks() ?? []).map((t) => t.id));
    const screenTrackIds = new Set((this.screenStream?.getTracks() ?? []).map((t) => t.id));
    const cameraTrackInScreenStream = (this.screenStream?.getTracks() ?? [])
      .filter((t) => cameraTrackIds.has(t.id))
      .map((t) => `${t.kind}:${t.id}`);
    const screenTrackInCameraStream = (this.localStream?.getTracks() ?? [])
      .filter((t) => screenTrackIds.has(t.id))
      .map((t) => `${t.kind}:${t.id}`);

    if (cameraTrackInScreenStream.length > 0 || screenTrackInCameraStream.length > 0) {
      console.error('[MEDIA SEPARATION DEBUG] VIOLATION:', {
        ts: new Date().toISOString(),
        action,
        managerId: this.managerId,
        cameraTrackInScreenStream,
        screenTrackInCameraStream,
      });
    } else {
      console.log('[MEDIA SEPARATION DEBUG] ok:', {
        ts: new Date().toISOString(),
        action,
        managerId: this.managerId,
        cameraTrackCount: this.localStream?.getTracks().length ?? 0,
        screenTrackCount: this.screenStream?.getTracks().length ?? 0,
      });
    }
  }

  /** Snapshot of the camera state machine for UI-level diagnostics. */
  public getCameraDiagnostics() {
    return {
      managerId: this.managerId,
      destroyed: this.isDestroyed,
      cameraState: this.cameraState,
      cameraRecoveryAttempts: this.cameraRecoveryAttempts,
      cameraAcquisitionInFlight: this.cameraAcquisitionInFlight,
      hasCameraStream: Boolean(this.localStream?.getVideoTracks().some((t) => t.readyState === 'live')),
      hasScreenStream: Boolean(this.screenStream?.getTracks().some((t) => t.readyState === 'live')),
    };
  }

  /** Start local camera track via getUserMedia with robust fallback constraints */
  public async startCamera(): Promise<boolean> {
    if (this.isDestroyed) return false;

    // 1. In-flight guard: If startCamera is already executing, return active promise
    if (this.cameraStartPromise) {
      console.log('[Diagnostics] [WebRTC] Camera start already in-flight. Reusing active request.');
      return this.cameraStartPromise;
    }

    // 2. Cooldown throttle: Prevent spamming getUserMedia within 1500ms
    const now = Date.now();
    if (now - this.lastCameraAttemptTime < 1500) {
      console.log('[Diagnostics] [WebRTC] Camera start called too quickly after previous attempt. Throttled.');
      return false;
    }
    this.lastCameraAttemptTime = now;

    this.setCameraState('REQUESTING', 'startCamera invoked');
    this.cameraAcquisitionInFlight = true;

    this.cameraStartPromise = (async () => {
      try {
        console.log('[CAMERA DEBUG] startCamera requested:', {
          ts: new Date().toISOString(),
          throttled: false,
          existingCameraTracks: this.localStream?.getVideoTracks().length ?? 0,
          screenTracksLive: this.screenStream?.getTracks().filter((t) => t.readyState === 'live').length ?? 0,
          peerCount: this.peerConnections.size,
        });

        const existingVideoTracks = this.localStream?.getVideoTracks() || [];
        const hasLiveVideoTracks = existingVideoTracks.some((t) => t.readyState === 'live');
        console.log(`[TRIGGER] startCamera() called. Existing video tracks: ${existingVideoTracks.length} (hasLive: ${hasLiveVideoTracks})`);

        // Stop and release any existing camera tracks before attempting new hardware acquisition
        this.stopCamera();

        // Allow Windows COM / DirectShow graph 150ms to release device pins
        await new Promise((resolve) => setTimeout(resolve, 150));

        await logMediaEnvironmentDiagnostics('startCamera (user requested camera)', { video: true, audio: false });
        await logMediaPermissions();
        const permissionState = await queryCameraPermissionState();
        const devCounts = await logFullDeviceEnumeration('startCamera (immediately before getUserMedia)');

        if (this.isDestroyed) return false;

        const support = checkMediaSupport();
        if (!support.supported) {
          this.onError(support.reason!);
          return false;
        }

        // Recovery path: when the browser reports ZERO video inputs with
        // permission granted (or denied), getUserMedia can only ever throw
        // NotFoundError — hammering it changes nothing. Instead arm a bounded
        // one-shot devicechange watcher and surface a useful diagnostic.
        // 'prompt' / unknown permission still attempts getUserMedia once,
        // because the permission prompt itself can make devices appear.
        const skipAcquisition = devCounts.videoInputs === 0 && (permissionState === 'granted' || permissionState === 'denied');
        if (skipAcquisition) {
          this.setCameraState('FAILED_NO_DEVICE', `videoinput===0 with permission=${permissionState}`);
          console.log('[CAMERA DEBUG] CAMERA DEVICE NOT EXPOSED BY BROWSER:', {
            ts: new Date().toISOString(),
            videoInputsReported: devCounts.videoInputs,
            audioInputsReported: devCounts.audioInputs,
            permissionState,
            managerId: this.managerId,
            destroyed: this.isDestroyed,
            action: 'skipping getUserMedia — waiting for devicechange',
          });
          console.log('[CAMERA LIFECYCLE] videoinput === 0, permission =', permissionState, '— skipping getUserMedia, arming device recovery watcher');
          this.setCameraState('WAITING_FOR_DEVICE', 'arming one-shot devicechange watcher');
          this.armCameraDeviceRecovery();
          if (permissionState === 'denied') {
            const deniedDiag: MediaDiagnosticError = {
              type: 'permission_denied',
              title: 'Camera Permission Blocked',
              message: 'Camera permission for localhost:3000 is blocked. Allow camera access in Chrome site settings.',
              actionableHint: 'Click the lock icon next to localhost:3000 in the address bar, set Camera to Allow, then click Try Again.',
              originalErrorName: 'NotAllowedError',
            };
            this.onError(deniedDiag);
          } else {
            const noCamDiag: MediaDiagnosticError = {
              type: 'device_not_found',
              title: 'No Camera Detected',
              message:
                'The browser reports no camera device (permission is granted, videoinput count is 0). Check Windows camera privacy settings, Device Manager, or VM/remote-session camera pass-through.',
              actionableHint:
                'Check OS-level camera availability (Windows Settings > Privacy & security > Camera, Device Manager) — the app will retry automatically when the device reappears.',
              originalErrorName: 'NotFoundError',
            };
            this.onError(noCamDiag);
          }
          return false;
        }

        let stream: MediaStream | null = null;
        let lastError: any = null;

        // Try native video constraint first for optimal DirectShow & MediaFoundation driver compatibility
        const constraintCandidates: (boolean | MediaTrackConstraints)[] = [
          true,
          { width: { ideal: 640 }, height: { ideal: 480 } },
        ];

        // Diagnostic B — immediately BEFORE the getUserMedia call.
        console.log('[CAMERA DEBUG] getUserMedia requested:', {
          ts: new Date().toISOString(),
          constraints: constraintCandidates,
          videoInputsReported: devCounts.videoInputs,
          permissionState,
          managerId: this.managerId,
          destroyed: this.isDestroyed,
          cameraState: this.cameraState,
        });

        for (let i = 0; i < constraintCandidates.length; i++) {
          console.log(`[CAMERA LIFECYCLE] getUserMedia invocation ${i + 1}/${constraintCandidates.length}:`, {
            ts: new Date().toISOString(),
            constraints: constraintCandidates[i],
            videoInputsReported: devCounts.videoInputs,
          });
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: constraintCandidates[i],
              audio: false,
            });
            if (this.isDestroyed) {
              if (stream) {
                stream.getVideoTracks().forEach((t) => this.stopTrackSafely(t, 'startCamera (manager destroyed mid-flight)', 'camera'));
              }
              return false;
            }
            if (stream && stream.getVideoTracks().length > 0) {
              break;
            }
          } catch (err: any) {
            lastError = err;
            const errName = err?.name || '';
            const errMsg = (err?.message || '').toLowerCase();

            // Fail-fast on permission denied, hardware lock, or driver timeout
            if (
              errName === 'NotAllowedError' ||
              errName === 'PermissionDeniedError' ||
              errName === 'AbortError' ||
              errName === 'NotReadableError' ||
              errMsg.includes('timeout')
            ) {
              throw err;
            }

            console.warn(`[WebRTC] getUserMedia attempt ${i + 1} failed (${errName}):`, err.message);
          }
        }

        if (!stream || stream.getVideoTracks().length === 0) {
          throw lastError || new Error('Failed to acquire camera stream.');
        }

        console.log('[CAMERA DEBUG] camera stream acquired:', {
          ts: new Date().toISOString(),
          streamId: stream.id,
          videoTrackId: stream.getVideoTracks()[0]?.id ?? null,
          videoTrackReadyState: stream.getVideoTracks()[0]?.readyState ?? null,
          videoTrackEnabled: stream.getVideoTracks()[0]?.enabled ?? null,
          videoTrackLabel: stream.getVideoTracks()[0]?.label ?? null,
        });
        console.log('[CAMERA DEBUG] getUserMedia success:', { ts: new Date().toISOString(), streamId: stream.id });
        console.log('[CAMERA DEBUG] camera stream created:', { ts: new Date().toISOString(), streamId: stream.id });

        const videoTrack = stream.getVideoTracks()[0];
        if (!videoTrack) {
          this.onError('No video track returned from camera device.');
          return false;
        }

        // Diagnostic D — immediately after successful getUserMedia.
        console.log('[CAMERA DEBUG] camera acquired:', {
          ts: new Date().toISOString(),
          streamId: stream.id,
          videoTrackId: videoTrack.id,
          trackReadyState: videoTrack.readyState,
          trackEnabled: videoTrack.enabled,
          trackMuted: videoTrack.muted,
          trackSettings: videoTrack.getSettings ? videoTrack.getSettings() : {},
          managerId: this.managerId,
        });
        console.log('[CAMERA DEBUG] camera track created:', {
          ts: new Date().toISOString(),
          trackId: videoTrack.id,
          label: videoTrack.label,
          readyState: videoTrack.readyState,
          enabled: videoTrack.enabled,
        });

        console.group('[GET USER MEDIA]');
        console.log('constraints:', { video: true, audio: false });
        console.log('status: SUCCESS');
        console.groupEnd();

        console.group('[LOCAL TRACK]');
        console.log('label:', videoTrack.label);
        console.log('readyState:', videoTrack.readyState);
        console.log('enabled:', videoTrack.enabled);
        console.log('muted:', videoTrack.muted);
        console.log('settings:', videoTrack.getSettings ? videoTrack.getSettings() : {});
        console.groupEnd();

        if (!this.localStream) {
          this.localStream = new MediaStream();
        }

        // Stop old video tracks
        this.localStream.getVideoTracks().forEach((t) => {
          this.stopTrackSafely(t, 'startCamera (replacing old camera tracks)', 'camera');
          this.localStream?.removeTrack(t);
        });

        this.localStream.addTrack(videoTrack);
        videoTrack.enabled = true;

        if (this.isDestroyed) {
          this.stopTrackSafely(videoTrack, 'startCamera (manager destroyed before commit)', 'camera');
          this.localStream.removeTrack(videoTrack);
          return false;
        }

        // Diagnostic E — immediately BEFORE attaching the camera track to peers.
        console.log('[CAMERA DEBUG] attaching camera track:', {
          ts: new Date().toISOString(),
          trackId: videoTrack.id,
          peerCount: this.peerConnections.size,
          managerId: this.managerId,
        });

        this.onLocalStreamChange(this.localStream);
        this.updateLocalTracksOnAllPeers();

        console.log('[CAMERA DEBUG] camera attached to peer(s):', {
          ts: new Date().toISOString(),
          peerCount: this.peerConnections.size,
          cameraSenders: Array.from(this.peerConnections.entries()).map(([uid, pc]) => ({
            uid,
            videoSenders: pc.getSenders().filter((s) => s.track?.kind === 'video').map((s) => ({
              trackId: s.track?.id ?? null,
              label: s.track?.label ?? null,
              readyState: s.track?.readyState ?? null,
              contentHint: s.track?.contentHint ?? null,
            })),
          })),
          screenSendersStillPresent: this.screenStream
            ? Array.from(this.peerConnections.entries()).map(([uid, pc]) => ({
                uid,
                hasScreen: pc.getSenders().some((s) => s.track && this.screenStream?.getTracks().some((t) => t.id === s.track?.id)) ?? false,
              }))
            : [],
        });
        console.log('[CAMERA DEBUG] camera attached, media state:', {
          ts: new Date().toISOString(),
          cameraTracks: this.localStream.getVideoTracks().map((t) => `${t.id}:${t.readyState}:${t.enabled ? 'enabled' : 'disabled'}`),
          screenTracks: this.screenStream?.getTracks().map((t) => `${t.kind}:${t.readyState}`) ?? [],
          peers: Array.from(this.peerConnections.keys()),
        });
        for (const [remoteUserId, pc] of this.peerConnections) {
          console.log('[CAMERA DEBUG] peer senders:', {
            ts: new Date().toISOString(),
            remoteUserId,
            senders: pc.getSenders().map((s) => ({ kind: s.track?.kind ?? null, trackId: s.track?.id ?? null, label: s.track?.label ?? null, readyState: s.track?.readyState ?? null })),
          });
        }

        // Diagnostic F — per-peer camera sender verification. The camera sender
        // is any video sender that is NOT the bookkept screen sender.
        const screenTrackId = this.screenStream?.getVideoTracks()[0]?.id ?? null;
        for (const [remoteUserId, pc] of this.peerConnections) {
          if (pc.connectionState === 'closed') continue;
          const bookkeptScreenSender = this.screenSenderByPeer.get(remoteUserId) ?? null;
          const videoSenders = pc.getSenders().filter((s) => s.track?.kind === 'video');
          const cameraSenders = videoSenders.filter((s) => s !== bookkeptScreenSender && s.track?.id !== screenTrackId);
          const cameraSender = cameraSenders[0] ?? null;
          console.log('[CAMERA DEBUG] camera sender attached:', {
            ts: new Date().toISOString(),
            remotePeerId: remoteUserId,
            senderKind: cameraSender?.track?.kind ?? null,
            senderTrackId: cameraSender?.track?.id ?? null,
            senderTrackReadyState: cameraSender?.track?.readyState ?? null,
            totalVideoSenders: videoSenders.length,
            managerId: this.managerId,
          });
          const cameraOnSender = cameraSenders.some((s) => s.track && s.track.id === videoTrack.id);
          if (!cameraOnSender) {
            console.warn('[CAMERA DEBUG] camera track NOT present on any sender of peer:', {
              remotePeerId: remoteUserId,
              videoSenders: videoSenders.length,
              trackId: videoTrack.id,
            });
          }
          if (this.screenStream && videoSenders.length < 2) {
            console.warn('[CAMERA DEBUG] screen sharing active but peer has < 2 video senders (camera+screen expected):', {
              remotePeerId: remoteUserId,
              videoSenders: videoSenders.length,
            });
          }
        }

        this.assertMediaSeparation('startCamera commit');
        this.setCameraState('ACQUIRED', 'camera committed and attached to peers');
        return true;
      } catch (err: any) {
        console.group('[GET USER MEDIA]');
        console.log('status: FAILED');
        console.log('error.name:', err?.name);
        console.log('error.message:', err?.message);
        console.log('error.constraint:', err?.constraint);
        console.groupEnd();

        const errName = err?.name || '';
        const errMsg = (err?.message || '').toLowerCase();

        // If hardware is locked/busy by another app or timed out, show clear error with retry option
        if (
          errName === 'AbortError' ||
          errName === 'NotReadableError' ||
          errName === 'TrackStartError' ||
          errName === 'SourceUnavailableError' ||
          errMsg.includes('timeout')
        ) {
          const diag: MediaDiagnosticError = {
            type: 'device_busy',
            title: 'Camera Couldn\'t Start',
            message:
              'Camera couldn\'t start — it may be in use by another app or browser tab. Close other apps/tabs using your camera, then click Retry.',
            actionableHint:
              'Close Zoom, Teams, Discord, or other browser tabs using the camera, then click Try Again.',
            originalErrorName: errName,
          };
          this.onError(diag);
          return false;
        }

        if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
          try {
            const permissionState = await queryCameraPermissionState();
            const devSummary = await inspectAvailableMediaDevices();
            console.group('[CAMERA DEBUG] NotFoundError — evidence categorization');
            console.log('error.name:', err?.name);
            console.log('error.message:', err?.message);
            console.log('permissionState:', permissionState);
            console.log('videoDeviceCount:', devSummary.videoDeviceCount);
            console.log('audioDeviceCount:', devSummary.audioDeviceCount);
            console.log('A. no physical camera  -> videoDeviceCount === 0 AND audioDeviceCount also 0 (whole device class missing):', devSummary.videoDeviceCount === 0 && devSummary.audioDeviceCount === 0);
            console.log('B. browser permission denied -> videoDeviceCount === 0 while audio devices still enumerate (Chromium hides videoinput on denied permission):', devSummary.videoDeviceCount === 0 && devSummary.audioDeviceCount > 0);
            console.log('C. device temporarily unavailable -> videoDeviceCount === 0, OS may re-expose it later (devicechange event will auto-retry):', devSummary.videoDeviceCount === 0);
            console.log('D. our code stopped/released camera -> track stopped BUT device STILL enumerates; videoDeviceCount > 0 in that case:', devSummary.videoDeviceCount > 0);
            console.log('E. wrong lifecycle moment -> videoDeviceCount > 0 but getUserMedia failed:', devSummary.videoDeviceCount > 0);
            console.log('F. OS/browser issue outside app -> enumeration and permission look fine yet capture fails:', devSummary.videoDeviceCount > 0 && permissionState !== 'denied');
            console.groupEnd();
            if (devSummary.videoDeviceCount === 0) {
              this.setCameraState('FAILED_NO_DEVICE', `NotFoundError with videoDeviceCount===0 (permission=${permissionState})`);
              console.log('[CAMERA DEBUG] CAMERA DEVICE NOT EXPOSED BY BROWSER:', {
                ts: new Date().toISOString(),
                videoInputsReported: devSummary.videoDeviceCount,
                audioInputsReported: devSummary.audioDeviceCount,
                permissionState,
                managerId: this.managerId,
                destroyed: this.isDestroyed,
                action: 'NotFoundError — waiting for devicechange',
              });
              this.setCameraState('WAITING_FOR_DEVICE', 'arming one-shot devicechange watcher');
              this.armCameraDeviceRecovery();
              const noCamDiag: MediaDiagnosticError = {
                type: 'device_not_found',
                title: 'No Camera Detected',
                message:
                  'No camera detected. Check OS-level camera permissions for this browser, or that a camera is connected/passed through if running in a VM or remote session.',
                actionableHint:
                  'Check OS-level camera permissions for this browser, or ensure a camera is connected/passed through.',
                originalErrorName: err?.name,
              };
              this.onError(noCamDiag);
              return false;
            }
          } catch (inspectErr) {
            console.warn('[WebRTC] Failed checking device enumeration on NotFoundError:', inspectErr);
          }
        }

        const diag = diagnoseMediaError(err, 'camera');
        this.onError(diag);
        this.setCameraState('IDLE', `camera acquisition failed with ${errName || 'unknown'} — user can retry`);
        return false;
      } finally {
        this.cameraStartPromise = null;
        this.cameraAcquisitionInFlight = false;
      }
    })();

    return this.cameraStartPromise;
  }

  /** Stop local camera track */
  public stopCamera() {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((track) => {
        track.enabled = false;
        this.stopTrackSafely(track, 'stopCamera', 'camera');
        this.localStream?.removeTrack(track);
      });
      console.log('[CAMERA DEBUG] camera stopped:', {
        ts: new Date().toISOString(),
        screenTracks: this.screenStream?.getTracks().map((t) => `${t.kind}:${t.readyState}`) ?? [],
        peers: Array.from(this.peerConnections.keys()),
        managerId: this.managerId,
      });
      console.log('[CAMERA LIFECYCLE] after camera track stop:', {
        ts: new Date().toISOString(),
        remainingCameraTracks: this.localStream.getVideoTracks().map((t) => `${t.id}:${t.readyState}`),
        screenTracksStillLive: this.screenStream?.getTracks().filter((t) => t.readyState === 'live').length ?? 0,
      });
      logFullDeviceEnumeration('stopCamera (immediately after camera track stopped)').catch(() => {});
      this.assertMediaSeparation('stopCamera');
      this.setCameraState('IDLE', 'stopCamera');
      this.onLocalStreamChange(this.localStream);
      this.updateLocalTracksOnAllPeers();
    }
  }

  /**
   * ISOLATED raw camera acquisition test. Touches NOTHING in the WebRTC
   * lifecycle: no peers, no renegotiation, no localStream bookkeeping, no
   * AppContext sync. If this succeeds while startCamera() fails, the bug is
   * inside WebRTCManager/AppContext. If this ALSO fails with videoinput
   * count 0, the browser/OS has no camera available to this origin — the
   * application cannot be the cause.
   */
  public async testRawCamera(): Promise<MediaStream | null> {
    console.log('[RAW CAMERA TEST] BEFORE');

    const devicesBefore = await navigator.mediaDevices.enumerateDevices();
    const videoInputsBefore = devicesBefore.filter((d) => d.kind === 'videoinput');
    console.log(
      '[RAW CAMERA TEST] video inputs BEFORE:',
      videoInputsBefore.map((d) => ({ kind: d.kind, deviceId: d.deviceId, groupId: d.groupId, label: d.label }))
    );

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });

      console.log('[RAW CAMERA TEST] SUCCESS', {
        streamId: stream.id,
        tracks: stream.getVideoTracks().map((track) => ({
          id: track.id,
          label: track.label,
          readyState: track.readyState,
          enabled: track.enabled,
          muted: track.muted,
          settings: track.getSettings(),
        })),
      });

      return stream;
    } catch (error: any) {
      console.error('[RAW CAMERA TEST] FAILED', {
        name: error?.name,
        message: error?.message,
        constraint: error?.constraint,
      });

      const permissionState = await queryCameraPermissionState();
      const after = await navigator.mediaDevices.enumerateDevices();
      const videoInputsAfter = after.filter((d) => d.kind === 'videoinput');
      console.log('[RAW CAMERA TEST] evidence:', {
        permissionState,
        videoInputsBeforeCount: videoInputsBefore.length,
        videoInputsAfterCount: videoInputsAfter.length,
        totalDevicesAfter: after.length,
        audioInputsAfter: after.filter((d) => d.kind === 'audioinput').length,
      });
      throw error;
    }
  }

  /**
   * Start or enable local microphone */
  public async startMic(): Promise<boolean> {
    if (this.isDestroyed) return false;

    const support = checkMediaSupport();
    if (!support.supported) {
      this.onError(support.reason!);
      return false;
    }

    try {
      const existingAudio = this.localStream?.getAudioTracks()[0];
      if (existingAudio && existingAudio.readyState === 'live') {
        existingAudio.enabled = true;
        this.updateLocalTracksOnAllPeers();
        return true;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });

      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) {
        this.onError('No audio track returned from microphone.');
        return false;
      }

      if (!this.localStream) {
        this.localStream = new MediaStream();
      }

      this.localStream.getAudioTracks().forEach((t) => {
        this.stopTrackSafely(t, 'startMic (replacing old audio track)', 'audio');
        this.localStream?.removeTrack(t);
      });

      this.localStream.addTrack(audioTrack);
      audioTrack.enabled = true;

      this.onLocalStreamChange(this.localStream);
      this.updateLocalTracksOnAllPeers();
      return true;
    } catch (err: any) {
      const diag = diagnoseMediaError(err, 'microphone');
      this.onError(diag);
      return false;
    }
  }

  /** Stop or mute local microphone */
  public stopMic() {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
      this.updateLocalTracksOnAllPeers();
    }
  }

  /** Start host screen sharing */
  public async startScreenShare(onEndedCallback?: () => void): Promise<boolean> {
    if (this.isDestroyed) return false;

    console.log('[SCREEN SHARE] startScreenShare() called');

    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        console.warn('[SCREEN SHARE] getDisplayMedia is not available in this browser');
        this.onError('Screen sharing is not supported in this browser environment.');
        return false;
      }

      console.log('[SCREEN SHARE] calling navigator.mediaDevices.getDisplayMedia()...');
      console.log('[CAMERA LIFECYCLE] camera stream BEFORE screen share:', {
        ts: new Date().toISOString(),
        cameraTracks: this.localStream?.getVideoTracks().map((t) => `${t.id}:${t.readyState}:${t.enabled ? 'enabled' : 'disabled'}`) ?? [],
        audioTracks: this.localStream?.getAudioTracks().length ?? 0,
        screenTracks: this.screenStream?.getTracks().map((t) => `${t.kind}:${t.readyState}`) ?? [],
      });
      const devicesBeforeScreenShare = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
      const videoInputsBeforeScreenShare = devicesBeforeScreenShare.filter((d) => d.kind === 'videoinput').length;
      console.log('[CAMERA DEBUG] enumerateDevices before screen share:', {
        ts: new Date().toISOString(),
        videoInputsBeforeScreenShare,
        managerId: this.managerId,
      });
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' } as MediaTrackConstraints,
        audio: false,
      });

      console.log('[SCREEN SHARE] getDisplayMedia() RESOLVED:', {
        streamId: stream.id,
        tracks: stream.getTracks().map((t) => ({ kind: t.kind, readyState: t.readyState, label: t.label, id: t.id })),
      });
      console.log('[CAMERA LIFECYCLE] enumeration immediately after getDisplayMedia():');
      await logFullDeviceEnumeration('startScreenShare (immediately after getDisplayMedia resolved)');
      // Diagnostic C — critical: compare videoinput count before vs after
      // getDisplayMedia resolved (screen capture must not hide the camera).
      const devicesAfterScreenShare = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
      const videoInputsAfterScreenShare = devicesAfterScreenShare.filter((d) => d.kind === 'videoinput').length;
      console.log('[CAMERA DEBUG] enumerateDevices after screen share:', {
        ts: new Date().toISOString(),
        videoInputsBeforeScreenShare,
        videoInputsAfterScreenShare,
        delta: videoInputsAfterScreenShare - videoInputsBeforeScreenShare,
        managerId: this.managerId,
        destroyed: this.isDestroyed,
      });
      console.log('[CAMERA LIFECYCLE] camera stream AFTER getDisplayMedia (before screen attach):', {
        ts: new Date().toISOString(),
        cameraTracks: this.localStream?.getVideoTracks().map((t) => `${t.id}:${t.readyState}:${t.enabled ? 'enabled' : 'disabled'}`) ?? [],
        audioTracks: this.localStream?.getAudioTracks().length ?? 0,
      });

      const screenTrack = stream.getVideoTracks()[0];
      if (!screenTrack) {
        console.warn('[SCREEN SHARE] getDisplayMedia() resolved but returned no video track:', stream.getTracks().map((t) => t.kind));
        this.onError('Screen capture returned no video track. Please try again.');
        stream.getTracks().forEach((t) => this.stopTrackSafely(t, 'startScreenShare (no video track)', 'screen'));
        return false;
      }

      // Hand the stream to the SAME manager that owns all PeerConnections.
      // setLocalScreenStream attaches it to every existing peer and forces
      // renegotiation — it does NOT depend on peer creation timing.
      const ok = this.setLocalScreenStream(stream);
      if (!ok) {
        stream.getTracks().forEach((t) => this.stopTrackSafely(t, 'startScreenShare (setLocalScreenStream rejected stream)', 'screen'));
        return false;
      }

      screenTrack.onended = () => {
        console.log('[SCREEN SHARE] screen track ended (native browser stop detected)');
        this.setLocalScreenStream(null);
        onEndedCallback?.();
      };

      return true;
    } catch (err: any) {
      console.warn('[SCREEN SHARE] getDisplayMedia() REJECTED:', { name: err?.name, message: err?.message, detail: err });
      if (err.name !== 'NotAllowedError') {
        const diag = diagnoseMediaError(err, 'screen');
        this.onError(diag);
      }
      return false;
    }
  }

  /**
   * Authoritative screen-stream setter. Passed a non-null stream it:
   *   1. stores it as the manager's local screen stream
   *   2. verifies the video track (kind/readyState/enabled)
   *   3. attaches the screen sender to EVERY existing peer (addTrack or
   *      replaceTrack — explicit per-peer bookkeeping)
   *   4. verifies the sender actually holds the screen track
   *   5. requests renegotiation for every peer (queued if mid-negotiation)
   *   6. sends track-meta AFTER attachment + renegotiation initiation
   * Passed null it stops capture, clears senders and renegotiates.
   */
  public setLocalScreenStream(stream: MediaStream | null): boolean {
    if (this.isDestroyed) return false;

    const previous = this.screenStream;
    this.screenStream = stream;
    this.onLocalScreenStreamChange?.(stream ? new MediaStream(stream.getTracks()) : null);

    if (!stream) {
      if (previous) {
        previous.getTracks().forEach((t) => this.stopTrackSafely(t, 'setLocalScreenStream(null)', 'screen'));
      }
      console.log('[SCREEN DEBUG] HOST screen share stopped:', { ts: new Date().toISOString() });
      console.log('[CAMERA LIFECYCLE] local media state AFTER screen share stop:', {
        ts: new Date().toISOString(),
        cameraTracks: this.localStream?.getVideoTracks().map((t) => `${t.id}:${t.readyState}:${t.enabled ? 'enabled' : 'disabled'}`) ?? [],
        audioTracks: this.localStream?.getAudioTracks().length ?? 0,
        screenTracksRemaining: this.screenStream?.getTracks().map((t) => `${t.kind}:${t.readyState}`) ?? [],
      });
      logFullDeviceEnumeration('setLocalScreenStream(null) (immediately after screen share stopped)').catch(() => {});
      this.assertMediaSeparation('setLocalScreenStream(null)');
      this.updateLocalTracksOnAllPeers();
      if (previous) {
        for (const [remoteUserId, pc] of this.peerConnections) {
          if (pc.connectionState === 'closed') continue;
          console.log('[SCREEN DEBUG] HOST peer senders after screen stop:', {
            ts: new Date().toISOString(),
            remoteUserId,
            senders: pc.getSenders().map((s) => ({ id: s.track?.id ?? null, kind: s.track?.kind ?? null, label: s.track?.label ?? null, readyState: s.track?.readyState ?? null })),
          });
          this.requestRenegotiation(remoteUserId, 'screen-share-stopped');
        }
      }
      return true;
    }

    const screenTrack = stream.getVideoTracks()[0];
    if (!screenTrack) {
      console.warn('[SCREEN DEBUG] setLocalScreenStream: stream has no video track', {
        ts: new Date().toISOString(),
        streamId: stream.id,
        kinds: stream.getTracks().map((t) => t.kind),
      });
      return false;
    }
    screenTrack.contentHint = 'detail';

    console.log('[CAMERA LIFECYCLE] camera tracks AFTER screen share started:', {
      ts: new Date().toISOString(),
      cameraTracks: this.localStream?.getVideoTracks().map((t) => `${t.id}:${t.readyState}:${t.enabled ? 'enabled' : 'disabled'}`) ?? [],
      audioTracks: this.localStream?.getAudioTracks().length ?? 0,
      screenStreamId: stream.id,
    });

    console.log('[SCREEN DEBUG] HOST screen share started:', {
      ts: new Date().toISOString(),
      streamId: stream.id,
      tracks: stream.getTracks().map((t) => `${t.kind}:${t.readyState}:${t.enabled ? 'enabled' : 'disabled'}`),
      videoTrackId: screenTrack.id,
      kind: screenTrack.kind,
      readyState: screenTrack.readyState,
      enabled: screenTrack.enabled,
      peerCount: this.peerConnections.size,
    });

    if (screenTrack.kind !== 'video' || screenTrack.readyState !== 'live' || !screenTrack.enabled) {
      console.warn('[SCREEN DEBUG] screen track not fully live — proceeding anyway:', {
        kind: screenTrack.kind,
        readyState: screenTrack.readyState,
        enabled: screenTrack.enabled,
      });
    }

    // Attach to every existing peer, verify the sender, then renegotiate.
    for (const [remoteUserId, pc] of this.peerConnections) {
      if (pc.connectionState === 'closed') continue;
      this.attachScreenTrackToPeer(remoteUserId, pc);
      const senders = pc.getSenders().map((s) => ({
        kind: s.track?.kind ?? null,
        trackId: s.track?.id ?? null,
        label: s.track?.label ?? null,
        readyState: s.track?.readyState ?? null,
      }));
      const screenOnSender = pc.getSenders().some((s) => s.track && s.track.id === screenTrack.id);
      console.log('[SCREEN DEBUG] HOST peer senders after screen attach:', {
        ts: new Date().toISOString(),
        remoteUserId,
        screenOnSender,
        senders,
      });
      if (!screenOnSender) {
        console.warn(`[SCREEN DEBUG] screen track NOT on a sender of ${remoteUserId} — re-attaching`);
        this.attachScreenTrackToPeer(remoteUserId, pc);
      }
      this.requestRenegotiation(remoteUserId, 'screen-share-started');
    }

    // track-meta ONLY after the track is attached and renegotiation is
    // initiated/queued — never metadata for a track absent from the pc.
    for (const [remoteUserId, pc] of this.peerConnections) {
      if (pc.connectionState === 'closed') continue;
      const attached = pc.getSenders().some((s) => s.track && s.track.id === screenTrack.id);
      if (!attached) {
        console.warn(`[SCREEN DEBUG] skipping track-meta for ${remoteUserId}: screen track not on any sender`);
        continue;
      }
      this.sendSignal(remoteUserId, {
        type: 'track-meta',
        trackId: screenTrack.id,
        trackKind: 'screen',
      }).catch((err: any) => {
        console.warn(`[WebRTC] track-meta send failed to ${remoteUserId}:`, { name: err?.name, message: err?.message });
      });
    }
    console.log('[SCREEN DEBUG] track-meta signals dispatched to all peers');

    this.assertMediaSeparation('setLocalScreenStream(non-null)');

    return true;
  }

  /** Stop host screen sharing */
  public stopScreenShare() {
    this.setLocalScreenStream(null);
  }

  /** Close a single peer connection */
  public closePeerConnection(remoteUserId: string) {
    const pc = this.peerConnections.get(remoteUserId);
    if (pc) {
      try {
        pc.close();
      } catch {}
      this.peerConnections.delete(remoteUserId);
    }
    this.remoteCameraStreams.delete(remoteUserId);
    this.remoteScreenStreams.delete(remoteUserId);
    this.pendingCandidates.delete(remoteUserId);
    this.makingOffer.delete(remoteUserId);
    this.pendingRenegotiation.delete(remoteUserId);
    this.screenSenderByPeer.delete(remoteUserId);
    for (const [trackId, owner] of this.trackOwners) {
      if (owner === remoteUserId) this.trackOwners.delete(trackId);
    }
    this.onRemoteStreamChange(remoteUserId, null, null);
  }

  /** Cleanup all peer connections and release media devices */
  public destroy() {
    this.isDestroyed = true;
    this.disarmCameraDeviceRecovery();

    // Diagnostic G — manager destruction with full camera state snapshot.
    const cameraTracksToStop = this.localStream?.getTracks().filter((t) => t.kind === 'video').length ?? 0;
    console.log('[CAMERA DEBUG] manager destroyed:', {
      ts: new Date().toISOString(),
      managerId: this.managerId,
      cameraAcquisitionInFlight: this.cameraAcquisitionInFlight,
      cameraStreamExisted: Boolean(this.localStream),
      cameraTracksStopped: cameraTracksToStop,
      screenStreamExisted: Boolean(this.screenStream),
      cameraState: this.cameraState,
    });
    this.setCameraState('IDLE', 'manager destroyed');

    this.stopScreenShare();
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => this.stopTrackSafely(t, 'destroy', t.kind === 'audio' ? 'audio' : 'camera'));
      this.localStream = null;
    }
    for (const [userId] of this.peerConnections) {
      this.closePeerConnection(userId);
    }
    this.peerConnections.clear();
    this.remoteCameraStreams.clear();
    this.remoteScreenStreams.clear();
    this.remoteTrackKinds.clear();
    this.pendingCandidates.clear();
    this.makingOffer.clear();
    this.pendingRenegotiation.clear();
    this.screenSenderByPeer.clear();
    this.trackOwners.clear();
    this.assertMediaSeparation('destroy');
    this.onLocalStreamChange(null);
    this.onLocalScreenStreamChange?.(null);
  }
}
