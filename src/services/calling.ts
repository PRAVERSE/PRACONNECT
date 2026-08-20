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
  private role: 'caller' | 'callee' | null = null;
  private pcInitPromise: Promise<void> | null = null;
  private pendingOffer: any = null;
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
    listener(this.currentSession ? { ...this.currentSession } : null, this.localStream, this.remoteStream);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.currentSession ? { ...this.currentSession } : null, this.localStream, this.remoteStream);
    }
  }

  private updateSession(updater: (prev: CallSession) => Partial<CallSession>, tag: string): void {
    if (!this.currentSession) return;
    const prev = this.currentSession;
    const updates = updater(prev);
    this.currentSession = {
      ...prev,
      ...updates,
    };
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[CALL_TRACE][SESSION_UPDATE][${tag}]`, {
        role: this.role,
        callId: this.currentSession.callId,
        prevState: prev.state,
        newState: this.currentSession.state,
        updates,
      });
    }
    this.notify();
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
    this.role = 'caller';
    if (process.env.NODE_ENV !== 'production') {
      console.log('[CALL UI DEBUG] startCall initiated:', { peerUserId, peerName, type, callId, role: this.role });
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
      this.updateSession(() => ({
        state: 'failed',
        errorMessage: 'Realtime connection is not active. Please reconnect.',
      }), 'START_CALL_WS_FAIL');
      this.scheduleErrorCleanup(12000);
      return false;
    }

    // 2. Concurrently acquire local media and initialize peer connection + CREATE OFFER
    this.pcInitPromise = (async () => {
      try {
        const { stream, fallbackToAudio, notice } = await this.acquireMediaWithFallback(type);
        this.localStream = stream;

        if (process.env.NODE_ENV !== 'production') {
          console.log('[CALL DEBUG] local tracks', {
            audio: this.localStream.getAudioTracks().length,
            video: this.localStream.getVideoTracks().length,
          });
        }

        if (this.currentSession && this.currentSession.callId === callId) {
          if (fallbackToAudio) {
            this.updateSession(() => ({
              type: 'audio',
              isCameraOff: true,
              errorMessage: notice || null,
            }), 'CALLER_MEDIA_FALLBACK');
          } else {
            this.notify();
          }
        }

        await this.initPeerConnection();

        if (!this.pc || !this.currentSession || this.currentSession.callId !== callId) return;

        // Caller creates offer
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);

        if (process.env.NODE_ENV !== 'production') {
          console.log('[CALL DEBUG] Caller created offer:', {
            callId,
            targetUserId: peerUserId,
            hasAudio: offer.sdp?.includes('m=audio'),
            hasVideo: offer.sdp?.includes('m=video'),
          });
        }

        wsService.send({
          type: 'sdp:offer',
          callId,
          targetUserId: peerUserId,
          sdp: offer,
        });
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
          this.updateSession(() => ({
            state: 'failed',
            errorMessage: userMessage,
          }), 'CALLER_MEDIA_ERROR');
          this.scheduleErrorCleanup(12000);
        }
      }
    })();

    return true;
  }

  public async acceptCall(): Promise<void> {
    if (!this.currentSession || (this.currentSession.state !== 'ringing' && this.currentSession.state !== 'calling')) return;

    this.role = 'callee';
    this.clearCallTimeoutTimer();
    this.updateSession(() => ({ state: 'connecting' }), 'ACCEPT_CALL');

    const callId = this.currentSession.callId;
    const peerUserId = this.currentSession.peerUserId;

    this.pcInitPromise = (async () => {
      try {
        const { stream, fallbackToAudio, notice } = await this.acquireMediaWithFallback(this.currentSession!.type);
        this.localStream = stream;

        if (process.env.NODE_ENV !== 'production') {
          console.log('[CALL DEBUG] callee local media acquired');
          console.log('[CALL DEBUG] local tracks', {
            audio: this.localStream.getAudioTracks().length,
            video: this.localStream.getVideoTracks().length,
          });
        }

        if (this.currentSession && this.currentSession.callId === callId) {
          if (fallbackToAudio) {
            this.updateSession(() => ({
              type: 'audio',
              isCameraOff: true,
              errorMessage: notice || null,
            }), 'CALLEE_MEDIA_FALLBACK');
          } else {
            this.notify();
          }
        }

        // Callee initializes RTCPeerConnection and adds its local tracks
        await this.initPeerConnection();

        if (!this.pc || !this.currentSession || this.currentSession.callId !== callId) return;

        // Callee sends call:accept confirmation to caller
        wsService.send({
          type: 'call:accept',
          callId,
          targetUserId: peerUserId,
        });

        // Callee processes caller's offer and generates SDP answer
        if (this.pendingOffer && this.pendingOffer.callId === callId) {
          const offerToProcess = this.pendingOffer;
          this.pendingOffer = null;
          await this.handleOffer(offerToProcess);
        }
      } catch (err: any) {
        console.error('[CALL_TRACE][CLIENT_CALLEE] acceptCall media acquisition failed:', err);
        const userMessage = this.formatMediaErrorMessage(err);

        if (this.currentSession && this.currentSession.callId === callId) {
          wsService.send({
            type: 'call:reject',
            callId,
            targetUserId: peerUserId,
            reason: 'MEDIA_ERROR',
          });

          this.updateSession(() => ({
            state: 'failed',
            errorMessage: userMessage,
          }), 'CALLEE_MEDIA_ERROR');
          this.scheduleErrorCleanup(12000);
        }
      }
    })();
  }

  public rejectCall(): void {
    if (!this.currentSession) return;
    this.clearCallTimeoutTimer();
    wsService.send({
      type: 'call:reject',
      callId: this.currentSession.callId,
      targetUserId: this.currentSession.peerUserId,
    });
    this.updateSession(() => ({ state: 'declined' }), 'REJECT_CALL');
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
    this.updateSession(() => ({ state: 'cancelled' }), 'CANCEL_CALL');
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
      this.updateSession(() => ({ state: 'ended' }), 'END_CALL');
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
    this.updateSession(() => ({ isMuted: !newEnabledState }), 'TOGGLE_MUTE');
  }

  public toggleCamera(): void {
    if (!this.localStream || !this.currentSession) return;
    const videoTracks = this.localStream.getVideoTracks();
    if (videoTracks.length === 0) return;
    const newEnabledState = !videoTracks[0].enabled;
    videoTracks.forEach((t) => (t.enabled = newEnabledState));
    this.updateSession(() => ({ isCameraOff: !newEnabledState }), 'TOGGLE_CAMERA');
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
      if (process.env.NODE_ENV !== 'production') {
        console.log('[CALL DEBUG] local tracks added', {
          audioSenders: this.pc.getSenders().filter((s) => s.track?.kind === 'audio').length,
          videoSenders: this.pc.getSenders().filter((s) => s.track?.kind === 'video').length,
        });
      }
    }

    this.remoteStream = new MediaStream();

    this.pc.ontrack = (event) => {
      const roleTag = (this.role || 'PEER').toUpperCase();
      if (process.env.NODE_ENV !== 'production') {
        console.log('[CALL DEBUG] ontrack', {
          callId: this.currentSession?.callId,
          role: this.role,
          kind: event.track?.kind,
          streamCount: event.streams ? event.streams.length : 0,
          trackId: event.track?.id,
          readyState: event.track?.readyState,
        });
      }

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

      const capturedCallId = this.currentSession?.callId;
      const currentTracks = this.remoteStream
        ? this.remoteStream.getTracks().map((t) => ({ id: t.id, kind: t.kind, readyState: t.readyState }))
        : null;

      console.log(`[CALL_TRACE][${roleTag}] remoteStream immediately after ontrack:`, {
        callId: capturedCallId,
        hasRemoteStream: !!this.remoteStream,
        tracks: currentTracks,
      });

      setTimeout(() => {
        if (this.currentSession && this.currentSession.callId === capturedCallId) {
          const delayedTracks = this.remoteStream
            ? this.remoteStream.getTracks().map((t) => ({ id: t.id, kind: t.kind, readyState: t.readyState }))
            : null;
          console.log(`[CALL_TRACE][${roleTag}] remoteStream 500ms post-ontrack check:`, {
            callId: capturedCallId,
            hasRemoteStream: !!this.remoteStream,
            tracks: delayedTracks,
            sessionState: this.currentSession.state,
          });
        }
      }, 500);

      this.updateSession(() => ({ state: 'connected' }), 'PC_ONTRACK');
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
          role: this.role,
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
          this.updateSession(() => ({ state: 'connected' }), 'ICE_CONNECTED');
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
      this.updateSession(() => ({
        state: 'failed',
        errorMessage: 'Unable to establish a network connection.',
      }), 'ICE_FAILED');
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

  private async handleOffer(event: any): Promise<void> {
    if (!this.pc || !this.currentSession || this.currentSession.callId !== event.callId) return;
    if (process.env.NODE_ENV !== 'production') {
      console.log('[CALL DEBUG] Callee handling sdp:offer from peer:', event.senderUserId);
    }
    await this.setRemoteDescriptionAndDrainCandidates(event.sdp);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    if (process.env.NODE_ENV !== 'production') {
      console.log('[CALL DEBUG] Callee created answer:', {
        callId: event.callId,
        targetUserId: event.senderUserId,
        hasAudio: answer.sdp?.includes('m=audio'),
        hasVideo: answer.sdp?.includes('m=video'),
      });
    }

    wsService.send({
      type: 'sdp:answer',
      callId: event.callId,
      targetUserId: event.senderUserId,
      sdp: answer,
    });
  }

  private async handleSignalingMessage(event: any): Promise<void> {
    if (!event || typeof event.type !== 'string') return;

    switch (event.type) {
      case 'call:invite': {
        this.role = 'callee';
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
          this.updateSession(() => ({ state: 'connecting' }), 'SIGNALING_CALL_ACCEPT');
        }
        break;
      }

      case 'call:reject': {
        if (this.currentSession && this.currentSession.callId === event.callId) {
          this.clearCallTimeoutTimer();
          this.updateSession(() => ({
            state: 'declined',
            errorMessage: 'Call declined.',
          }), 'SIGNALING_CALL_REJECT');
          setTimeout(() => this.cleanup(), 2000);
        }
        break;
      }

      case 'call:cancel': {
        if (this.currentSession && this.currentSession.callId === event.callId) {
          this.clearCallTimeoutTimer();
          this.updateSession(() => ({ state: 'cancelled' }), 'SIGNALING_CALL_CANCEL');
          this.cleanup();
        }
        break;
      }

      case 'call:ended': {
        if (this.currentSession && this.currentSession.callId === event.callId) {
          this.clearCallTimeoutTimer();
          this.updateSession(() => ({ state: 'ended' }), 'SIGNALING_CALL_ENDED');
          this.cleanup();
        }
        break;
      }

      case 'sdp:offer': {
        // Callee receives caller's SDP offer
        if (this.currentSession && this.currentSession.callId === event.callId) {
          if (!this.pc) {
            console.log('[CALL DEBUG] Received sdp:offer before PC initialized, queueing offer');
            this.pendingOffer = event;
            if (this.pcInitPromise) {
              await this.pcInitPromise;
            }
          } else {
            await this.handleOffer(event);
          }
        }
        break;
      }

      case 'sdp:answer': {
        // Caller receives callee's SDP answer
        if (this.currentSession && this.currentSession.callId === event.callId && this.pc) {
          if (process.env.NODE_ENV !== 'production') {
            console.log('[CALL DEBUG] Caller processing sdp:answer from callee');
          }
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
          this.updateSession(() => ({
            state: 'failed',
            errorMessage: event.message || 'Call failed.',
          }), 'SIGNALING_ERROR');
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
    this.pendingOffer = null;
    this.pcInitPromise = null;
    this.isRestartingIce = false;
    this.role = null;

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
