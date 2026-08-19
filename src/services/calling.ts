// src/services/calling.ts
// Decoupled 1-on-1 WebRTC calling service that handles WebRTC peer connection,
// short-lived ICE servers (STUN/TURN), candidate queueing, automatic ICE restart,
// track attachment, audio/video toggles, and signaling integration with wsService.

import { wsService } from './websocket';

export type CallType = 'audio' | 'video';
export type CallState =
  | 'idle'
  | 'calling'
  | 'ringing'
  | 'connecting'
  | 'connected'
  | 'rejected'
  | 'declined'
  | 'cancelled'
  | 'ended'
  | 'failed';

export interface CallSession {
  callId: string;
  peerUserId: string;
  peerName: string;
  type: CallType;
  state: CallState;
  isMuted: boolean;
  isCameraOff: boolean;
  errorMessage?: string | null;
}

type CallListener = (session: CallSession | null, localStream: MediaStream | null, remoteStream: MediaStream | null) => void;

class CallingService {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private currentSession: CallSession | null = null;
  private listeners: Set<CallListener> = new Set();
  private unsubscribes: (() => void)[] = [];
  private callTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private iceRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private cachedIceServers: RTCIceServer[] | null = null;
  private isRestartingIce = false;

  private errorCleanupTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const callEvents = [
      'call:invite',
      'call:accept',
      'call:reject',
      'call:cancel',
      'call:ended',
      'sdp:offer',
      'sdp:answer',
      'ice:candidate',
      'error',
    ];
    for (const evtType of callEvents) {
      const unsub = wsService.on(evtType, (evt: any) => this.handleSignalingMessage(evt));
      this.unsubscribes.push(unsub);
    }

    // Clean up on page unload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.endCall('PAGE_UNLOAD'));
    }
  }

  public subscribe(listener: CallListener): () => void {
    this.listeners.add(listener);
    listener(this.currentSession, this.localStream, this.remoteStream);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.currentSession, this.localStream, this.remoteStream);
    }
  }

  public getSession(): CallSession | null {
    return this.currentSession;
  }

  public async fetchIceServers(): Promise<RTCIceServer[]> {
    if (this.cachedIceServers) return this.cachedIceServers;
    try {
      const res = await fetch('/api/calling/ice-servers', { credentials: 'include' }).then((r) => r.json());
      if (res.ok && Array.isArray(res.iceServers)) {
        this.cachedIceServers = res.iceServers;
        return res.iceServers;
      }
    } catch {
      // Ignore fetch error; fall back to STUN default
    }
    const defaultStun: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
    this.cachedIceServers = defaultStun;
    return defaultStun;
  }

  /**
   * Pre-flight hardware check to detect available audio and video inputs.
   */
  public async getAvailableMediaDevices(): Promise<{ hasAudio: boolean; hasVideo: boolean }> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return { hasAudio: true, hasVideo: true };
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasAudio = devices.some((d) => d.kind === 'audioinput');
      const hasVideo = devices.some((d) => d.kind === 'videoinput');
      return { hasAudio, hasVideo };
    } catch {
      return { hasAudio: true, hasVideo: true };
    }
  }

  /**
   * Acquire local media stream with graceful degradation from video to audio.
   */
  private async acquireMediaWithFallback(type: CallType): Promise<{ stream: MediaStream; fallbackToAudio: boolean; notice?: string }> {
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Media devices are not supported by this browser.');
    }

    if (type === 'video') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        return { stream, fallbackToAudio: false };
      } catch (err: any) {
        console.warn('[CALL_MEDIA] Video + Audio acquisition failed:', err.name || err.message);
        const name = err.name || '';
        const msg = err.message || '';
        // If error is related to video device missing or in use, attempt fallback to audio
        if (
          name === 'NotFoundError' ||
          name === 'DevicesNotFoundError' ||
          name === 'NotReadableError' ||
          name === 'TrackStartError' ||
          name === 'OverconstrainedError' ||
          msg.includes('Requested device not found')
        ) {
          try {
            console.log('[CALL_MEDIA] Attempting fallback to audio-only...');
            const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            return {
              stream: audioStream,
              fallbackToAudio: true,
              notice: 'Camera unavailable — continuing with audio only.',
            };
          } catch (audioErr) {
            console.error('[CALL_MEDIA] Audio-only fallback also failed:', audioErr);
            throw err; // throw original error
          }
        }
        throw err;
      }
    }

    // Audio-only request
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    return { stream, fallbackToAudio: false };
  }

  public async startCall(peerUserId: string, peerName: string, type: CallType): Promise<boolean> {
    if (this.currentSession && this.currentSession.state !== 'idle') {
      return false;
    }

    const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    if (process.env.NODE_ENV !== 'production') {
      console.log('[CALL UI DEBUG] startCall initiated:', { peerUserId, peerName, type, callId });
    }
    this.currentSession = {
      callId,
      peerUserId,
      peerName,
      type,
      state: 'calling',
      isMuted: false,
      isCameraOff: type === 'audio',
      errorMessage: null,
    };
    this.notify();

    // 30-Second unanswered call timeout
    this.startCallTimeoutTimer(30000, 'NO_ANSWER');

    // 1. Send invite immediately over WebSocket so callee starts ringing right away
    console.log('[CALL_TRACE][CLIENT_CALLER] Emitting call:invite event:', {
      callId,
      targetUserId: peerUserId,
      recipientUserId: peerUserId,
      callType: type,
      wsReadyState: wsService.getState(),
      hasLocalStream: !!this.localStream,
    });

    const sent = wsService.send({
      type: 'call:invite',
      callId,
      targetUserId: peerUserId,
      recipientUserId: peerUserId,
      callType: type,
    });

    if (!sent) {
      console.error('[CALL_TRACE][CLIENT_CALLER] Failed to send call:invite over WebSocket (ws state:', wsService.getState(), ')');
      this.currentSession.state = 'failed';
      this.currentSession.errorMessage = 'Realtime connection is not active. Please reconnect.';
      this.notify();
      this.scheduleErrorCleanup(12000);
      return false;
    }

    // 2. Concurrently acquire local media and initialize peer connection
    (async () => {
      try {
        const { stream, fallbackToAudio, notice } = await this.acquireMediaWithFallback(type);
        this.localStream = stream;

        if (this.currentSession && this.currentSession.callId === callId) {
          if (fallbackToAudio) {
            this.currentSession.type = 'audio';
            this.currentSession.isCameraOff = true;
            this.currentSession.errorMessage = notice || null;
          }
          this.notify();
        }

        await this.initPeerConnection();
      } catch (err: any) {
        console.error('[CALL_TRACE][CLIENT_CALLER] Local media acquisition failed:', err);
        const userMessage = this.formatMediaErrorMessage(err);

        // Notify callee that call is cancelled due to caller media error
        wsService.send({
          type: 'call:cancel',
          callId,
          targetUserId: peerUserId,
          reason: 'MEDIA_ERROR',
        });

        if (this.currentSession && this.currentSession.callId === callId) {
          this.currentSession.state = 'failed';
          this.currentSession.errorMessage = userMessage;
          this.notify();
          this.scheduleErrorCleanup(12000);
        }
      }
    })();

    return true;
  }

  public async acceptCall(): Promise<void> {
    if (!this.currentSession || (this.currentSession.state !== 'ringing' && this.currentSession.state !== 'calling')) return;

    this.clearCallTimeoutTimer();
    this.currentSession.state = 'connecting';
    this.notify();

    try {
      const { stream, fallbackToAudio, notice } = await this.acquireMediaWithFallback(this.currentSession.type);
      this.localStream = stream;

      if (fallbackToAudio && this.currentSession) {
        this.currentSession.type = 'audio';
        this.currentSession.isCameraOff = true;
        this.currentSession.errorMessage = notice || null;
      }
      this.notify();

      await this.initPeerConnection();

      wsService.send({
        type: 'call:accept',
        callId: this.currentSession.callId,
        targetUserId: this.currentSession.peerUserId,
      });

      // Sender creates offer
      const offer = await this.pc!.createOffer();
      await this.pc!.setLocalDescription(offer);

      wsService.send({
        type: 'sdp:offer',
        callId: this.currentSession.callId,
        targetUserId: this.currentSession.peerUserId,
        sdp: offer,
      });
    } catch (err: any) {
      console.error('[CALL_TRACE][CLIENT_CALLEE] acceptCall media acquisition failed:', err);
      const userMessage = this.formatMediaErrorMessage(err);

      wsService.send({
        type: 'call:reject',
        callId: this.currentSession.callId,
        targetUserId: this.currentSession.peerUserId,
        reason: 'MEDIA_ERROR',
      });

      this.currentSession.state = 'failed';
      this.currentSession.errorMessage = userMessage;
      this.notify();
      this.scheduleErrorCleanup(12000);
    }
  }

  public rejectCall(): void {
    if (!this.currentSession) return;
    this.clearCallTimeoutTimer();
    wsService.send({
      type: 'call:reject',
      callId: this.currentSession.callId,
      targetUserId: this.currentSession.peerUserId,
    });
    this.currentSession.state = 'declined';
    this.notify();
    this.scheduleErrorCleanup(2000);
  }

  public cancelCall(): void {
    if (!this.currentSession) return;
    this.clearCallTimeoutTimer();
    wsService.send({
      type: 'call:cancel',
      callId: this.currentSession.callId,
      targetUserId: this.currentSession.peerUserId,
    });
    this.currentSession.state = 'cancelled';
    this.notify();
    this.cleanup();
  }

  public endCall(reason?: string): void {
    this.clearCallTimeoutTimer();
    if (this.currentSession) {
      wsService.send({
        type: 'call:ended',
        callId: this.currentSession.callId,
        targetUserId: this.currentSession.peerUserId,
        reason,
      });
      this.currentSession.state = 'ended';
      this.notify();
    }
    this.cleanup();
  }

  public dismissError(): void {
    if (this.errorCleanupTimer) {
      clearTimeout(this.errorCleanupTimer);
      this.errorCleanupTimer = null;
    }
    this.cleanup();
  }

  private scheduleErrorCleanup(ms = 12000): void {
    if (this.errorCleanupTimer) clearTimeout(this.errorCleanupTimer);
    this.errorCleanupTimer = setTimeout(() => {
      if (this.currentSession && (this.currentSession.state === 'failed' || this.currentSession.state === 'declined')) {
        this.cleanup();
      }
    }, ms);
  }

  public toggleMute(): void {
    if (!this.localStream || !this.currentSession) return;
    const audioTracks = this.localStream.getAudioTracks();
    if (audioTracks.length === 0) return;
    const newEnabledState = !audioTracks[0].enabled;
    audioTracks.forEach((t) => (t.enabled = newEnabledState));
    this.currentSession.isMuted = !newEnabledState;
    this.notify();
  }

  public toggleCamera(): void {
    if (!this.localStream || !this.currentSession) return;
    const videoTracks = this.localStream.getVideoTracks();
    if (videoTracks.length === 0) return;
    const newEnabledState = !videoTracks[0].enabled;
    videoTracks.forEach((t) => (t.enabled = newEnabledState));
    this.currentSession.isCameraOff = !newEnabledState;
    this.notify();
  }

  private async initLocalStream(type: CallType): Promise<void> {
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Media devices not supported by browser.');
    }
    const constraints: MediaStreamConstraints = {
      audio: true,
      video: type === 'video',
    };
    this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
  }

  private async initPeerConnection(): Promise<void> {
    const iceServers = await this.fetchIceServers();
    const config: RTCConfiguration = {
      iceServers,
    };
    this.pc = new RTCPeerConnection(config);
    this.pendingIceCandidates = [];
    this.isRestartingIce = false;

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        this.pc!.addTrack(track, this.localStream!);
      });
    }

    this.remoteStream = new MediaStream();

    this.pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        event.streams[0].getTracks().forEach((track) => {
          if (this.remoteStream && !this.remoteStream.getTracks().some((t) => t.id === track.id)) {
            this.remoteStream.addTrack(track);
          }
        });
      } else if (event.track) {
        if (this.remoteStream && !this.remoteStream.getTracks().some((t) => t.id === event.track.id)) {
          this.remoteStream.addTrack(event.track);
        }
      }
      if (this.currentSession) {
        this.currentSession.state = 'connected';
      }
      this.notify();
      this.startStatsMonitoring();
    };

    this.pc.onicecandidate = (event) => {
      if (event.candidate && this.currentSession) {
        wsService.send({
          type: 'ice:candidate',
          callId: this.currentSession.callId,
          targetUserId: this.currentSession.peerUserId,
          candidate: event.candidate,
        });
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      if (!this.pc) return;
      const state = this.pc.iceConnectionState;
      if (process.env.NODE_ENV !== 'production') {
        console.log('[CALL DEBUG] ICE STATE:', {
          callId: this.currentSession?.callId,
          iceConnectionState: state,
          connectionState: this.pc.connectionState,
          iceGatheringState: this.pc.iceGatheringState,
        });
      }

      if (state === 'disconnected') {
        if (!this.iceRecoveryTimer) {
          this.iceRecoveryTimer = setTimeout(() => {
            if (this.pc && (this.pc.iceConnectionState === 'disconnected' || this.pc.iceConnectionState === 'failed')) {
              this.handleIceFailure();
            }
          }, 5000);
        }
      } else if (state === 'failed') {
        this.handleIceFailure();
      } else if (state === 'connected' || state === 'completed') {
        if (this.iceRecoveryTimer) {
          clearTimeout(this.iceRecoveryTimer);
          this.iceRecoveryTimer = null;
        }
        if (this.currentSession && (this.currentSession.state === 'connecting' || this.currentSession.state === 'calling')) {
          this.currentSession.state = 'connected';
          this.notify();
        }
      }
    };
  }

  private async handleIceFailure(): Promise<void> {
    if (!this.pc || !this.currentSession || this.isRestartingIce) return;
    this.isRestartingIce = true;

    try {
      if (typeof this.pc.restartIce === 'function') {
        this.pc.restartIce();
        const offer = await this.pc.createOffer({ iceRestart: true });
        await this.pc.setLocalDescription(offer);

        wsService.send({
          type: 'sdp:offer',
          callId: this.currentSession.callId,
          targetUserId: this.currentSession.peerUserId,
          sdp: offer,
        });
        return;
      }
    } catch (e) {
      console.warn('[CALL DEBUG] ICE restart attempt failed:', e);
    }

    if (this.currentSession) {
      this.currentSession.state = 'failed';
      this.currentSession.errorMessage = 'Unable to establish a network connection.';
      this.notify();
      setTimeout(() => this.cleanup(), 3000);
    }
  }

  private async setRemoteDescriptionAndDrainCandidates(sdp: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) return;
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const candidatesToDrain = [...this.pendingIceCandidates];
    this.pendingIceCandidates = [];
    for (const cand of candidatesToDrain) {
      await this.pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
    }
  }

  private async handleSignalingMessage(event: any): Promise<void> {
    if (!event || typeof event.type !== 'string') return;

    switch (event.type) {
      case 'call:invite': {
        // [CALL_TRACE] Client (callee): on receiving the incoming-call event
        console.log('[CALL_TRACE][CLIENT_CALLEE] Received incoming call:invite event:', {
          callId: event.callId,
          senderUserId: event.senderUserId,
          callerUserId: event.callerUserId,
          peerName: event.peerName,
          callType: event.callType,
        });

        if (this.currentSession && this.currentSession.state !== 'idle') {
          wsService.send({
            type: 'call:reject',
            callId: event.callId,
            targetUserId: event.senderUserId,
            reason: 'BUSY',
          });
          return;
        }

        this.currentSession = {
          callId: event.callId,
          peerUserId: event.senderUserId,
          peerName: event.peerName || 'Friend',
          type: event.callType || 'audio',
          state: 'ringing',
          isMuted: false,
          isCameraOff: (event.callType || 'audio') === 'audio',
          errorMessage: null,
        };
        this.startCallTimeoutTimer(30000, 'UNANSWERED');
        this.notify();
        break;
      }

      case 'call:accept': {
        if (this.currentSession && this.currentSession.callId === event.callId) {
          this.clearCallTimeoutTimer();
          this.currentSession.state = 'connecting';
          this.notify();
        }
        break;
      }

      case 'call:reject': {
        if (this.currentSession && this.currentSession.callId === event.callId) {
          this.clearCallTimeoutTimer();
          this.currentSession.state = 'declined';
          this.currentSession.errorMessage = 'Call declined.';
          this.notify();
          setTimeout(() => this.cleanup(), 2000);
        }
        break;
      }

      case 'call:cancel': {
        if (this.currentSession && this.currentSession.callId === event.callId) {
          this.clearCallTimeoutTimer();
          this.currentSession.state = 'cancelled';
          this.notify();
          this.cleanup();
        }
        break;
      }

      case 'call:ended': {
        if (this.currentSession && this.currentSession.callId === event.callId) {
          this.clearCallTimeoutTimer();
          this.currentSession.state = 'ended';
          this.notify();
          this.cleanup();
        }
        break;
      }

      case 'sdp:offer': {
        if (this.currentSession && this.currentSession.callId === event.callId && this.pc) {
          await this.setRemoteDescriptionAndDrainCandidates(event.sdp);
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);

          wsService.send({
            type: 'sdp:answer',
            callId: event.callId,
            targetUserId: event.senderUserId,
            sdp: answer,
          });
        }
        break;
      }

      case 'sdp:answer': {
        if (this.currentSession && this.currentSession.callId === event.callId && this.pc) {
          await this.setRemoteDescriptionAndDrainCandidates(event.sdp);
        }
        break;
      }

      case 'ice:candidate': {
        if (this.currentSession && this.currentSession.callId === event.callId && event.candidate) {
          if (!this.pc || !this.pc.remoteDescription) {
            this.pendingIceCandidates.push(event.candidate);
          } else {
            await this.pc.addIceCandidate(new RTCIceCandidate(event.candidate)).catch(() => {});
          }
        }
        break;
      }

      case 'error': {
        if (this.currentSession && this.currentSession.state !== 'idle') {
          this.clearCallTimeoutTimer();
          this.currentSession.state = 'failed';
          this.currentSession.errorMessage = event.message || 'Call failed.';
          this.notify();
          this.scheduleErrorCleanup(12000);
        }
        break;
      }
    }
  }

  private startStatsMonitoring(): void {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = setInterval(async () => {
      if (!this.pc || this.currentSession?.state !== 'connected') {
        if (this.statsTimer) clearInterval(this.statsTimer);
        this.statsTimer = null;
        return;
      }
      try {
        const stats = await this.pc.getStats();
        let selectedPair: any = null;
        let localCand: any = null;
        let remoteCand: any = null;

        stats.forEach((report) => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) {
            selectedPair = report;
          }
        });

        if (selectedPair) {
          localCand = stats.get(selectedPair.localCandidateId);
          remoteCand = stats.get(selectedPair.remoteCandidateId);

          const candType = localCand?.candidateType || remoteCand?.candidateType || 'unknown';
          if (process.env.NODE_ENV !== 'production') {
            console.log('[CALL DIAGNOSTICS]', {
              callId: this.currentSession.callId,
              candidatePairType: candType,
              localCandidateType: localCand?.candidateType,
              remoteCandidateType: remoteCand?.candidateType,
              bytesSent: selectedPair.bytesSent,
              bytesReceived: selectedPair.bytesReceived,
              currentRoundTripTime: selectedPair.currentRoundTripTime,
            });
          }
        }
      } catch {}
    }, 4000);
  }

  private startCallTimeoutTimer(ms: number, reason: string): void {
    this.clearCallTimeoutTimer();
    this.callTimeoutTimer = setTimeout(() => {
      if (this.currentSession && this.currentSession.state !== 'connected') {
        if (this.currentSession.state === 'calling') {
          this.cancelCall();
        } else {
          this.endCall(reason);
        }
      }
    }, ms);
  }

  private clearCallTimeoutTimer(): void {
    if (this.callTimeoutTimer) {
      clearTimeout(this.callTimeoutTimer);
      this.callTimeoutTimer = null;
    }
  }

  private formatMediaErrorMessage(err: any): string {
    if (!err) return 'Call failed to initialize.';
    const name = err.name || '';
    const msg = err.message || '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return 'Camera or microphone access was denied. Please allow device permissions in your browser or system settings.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || msg.includes('Requested device not found') || msg.includes('not found')) {
      return 'No camera or microphone found on your device. Please connect a device to make calls.';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError' || msg.includes('in use') || msg.includes('Could not start')) {
      return 'Camera or microphone is already in use by another application. Please close other apps and try again.';
    }
    if (name === 'OverconstrainedError') {
      return 'Requested camera or microphone settings are not supported by your hardware.';
    }
    return msg || 'Unable to access media devices.';
  }

  private cleanup(): void {
    this.clearCallTimeoutTimer();
    if (this.errorCleanupTimer) {
      clearTimeout(this.errorCleanupTimer);
      this.errorCleanupTimer = null;
    }
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    if (this.iceRecoveryTimer) {
      clearTimeout(this.iceRecoveryTimer);
      this.iceRecoveryTimer = null;
    }
    this.pendingIceCandidates = [];
    this.isRestartingIce = false;

    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.remoteStream = null;
    this.currentSession = null;
    this.notify();
  }
}

export const callingService = new CallingService();
