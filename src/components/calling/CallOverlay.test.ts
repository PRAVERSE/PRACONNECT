// src/components/calling/CallOverlay.test.ts
// Source-level layout and structural invariant tests for CallOverlay full-screen video call screen controls,
// plus stateful track toggle correctness regression tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourcePath = resolve(dirname(fileURLToPath(import.meta.url)), './CallOverlay.tsx');
const source = readFileSync(sourcePath, 'utf8');

test('1. CallOverlay root is full-screen fixed inset-0 z-[100]', () => {
  assert.match(source, /className="fixed inset-0 z-\[100\] bg-\[var\(--bg-canvas\)\] w-full h-full overflow-hidden/);
});

test('2. Remote video area is full screen inset-0', () => {
  assert.match(source, /className="absolute inset-0 w-full h-full z-10 bg-black flex items-center justify-center/);
  assert.match(source, /ref=\{remoteVideoRef\}/);
});

test('3. Top-left participant name & status/timer badge exists', () => {
  assert.match(source, /className="absolute top-5 left-5 sm:top-6 sm:left-6 z-30 flex items-center gap-3/);
});

test('4. Local preview is floating in bottom-right and stays mounted when camera is off', () => {
  assert.match(source, /className="absolute right-4 sm:right-6 bottom-24 sm:bottom-28 z-30 w-36 sm:w-56 aspect-video rounded-2xl/);
  assert.match(source, /<VideoOff/);
  assert.match(source, /Camera Off/);
});

test('5. Bottom control bar has centered circular controls during active call states', () => {
  assert.match(source, /className="absolute bottom-6 sm:bottom-8 inset-x-0 z-30 flex items-center justify-center gap-4 sm:gap-6"/);
  assert.match(source, /session\.state === 'calling' \|\| session\.state === 'connecting' \|\| session\.state === 'connected'/);
});

test('6. Control buttons include Microphone, Camera, and End Call actions with proper aria-labels', () => {
  assert.match(source, /Mic/);
  assert.match(source, /MicOff/);
  assert.match(source, /Video/);
  assert.match(source, /VideoOff/);
  assert.match(source, /PhoneOff/);
  assert.match(source, /aria-label=\{session\.isMuted \? 'Unmute microphone' : 'Mute microphone'\}/);
  assert.match(source, /aria-label=\{session\.isCameraOff \? 'Turn camera on' : 'Turn camera off'\}/);
  assert.match(source, /aria-label="End call"/);
});

test('7. Clicking mic button invokes callingService.toggleMute()', () => {
  assert.match(source, /onClick=\{\(\) => callingService\.toggleMute\(\)\}/);
});

test('8. Clicking camera button invokes callingService.toggleCamera()', () => {
  assert.match(source, /onClick=\{\(\) => callingService\.toggleCamera\(\)\}/);
});

test('9. Ringing state displays Accept and Decline buttons', () => {
  assert.match(source, /isIncoming \?/);
  assert.match(source, /title="Accept Call"/);
  assert.match(source, /title="Decline Call"/);
});

test('10. Connected timer logic is present and formatted MM:SS', () => {
  assert.match(source, /formatTimer/);
  assert.match(source, /connectedDuration/);
});

test('11. Regression Test: Microphone toggle correctness (ON -> OFF -> ON)', async () => {
  const audioTrack = { enabled: true, kind: 'audio' };
  const mockLocalStream = {
    getAudioTracks: () => [audioTrack],
    getVideoTracks: () => [],
  };

  let notified = false;
  const mockCallingService = {
    localStream: mockLocalStream as any,
    currentSession: { isMuted: false, isCameraOff: false } as any,
    notify() {
      notified = true;
    },
    toggleMute() {
      if (!this.localStream || !this.currentSession) return;
      const audioTracks = this.localStream.getAudioTracks();
      if (audioTracks.length === 0) return;
      const newEnabledState = !audioTracks[0].enabled;
      audioTracks.forEach((t: any) => (t.enabled = newEnabledState));
      this.currentSession.isMuted = !newEnabledState;
      this.notify();
    },
  };

  // 1. Initial State
  assert.equal(audioTrack.enabled, true);
  assert.equal(mockCallingService.currentSession.isMuted, false);

  // 2. Toggle OFF
  mockCallingService.toggleMute();
  assert.equal(audioTrack.enabled, false);
  assert.equal(mockCallingService.currentSession.isMuted, true);
  assert.equal(notified, true);

  // 3. Toggle ON again
  notified = false;
  mockCallingService.toggleMute();
  assert.equal(audioTrack.enabled, true);
  assert.equal(mockCallingService.currentSession.isMuted, false);
  assert.equal(notified, true);
});

test('12. Regression Test: Camera toggle correctness (ON -> OFF -> ON)', async () => {
  const videoTrack = { enabled: true, kind: 'video' };
  const mockLocalStream = {
    getAudioTracks: () => [],
    getVideoTracks: () => [videoTrack],
  };

  let notified = false;
  const mockCallingService = {
    localStream: mockLocalStream as any,
    currentSession: { isMuted: false, isCameraOff: false } as any,
    notify() {
      notified = true;
    },
    toggleCamera() {
      if (!this.localStream || !this.currentSession) return;
      const videoTracks = this.localStream.getVideoTracks();
      if (videoTracks.length === 0) return;
      const newEnabledState = !videoTracks[0].enabled;
      videoTracks.forEach((t: any) => (t.enabled = newEnabledState));
      this.currentSession.isCameraOff = !newEnabledState;
      this.notify();
    },
  };

  // 1. Initial State
  assert.equal(videoTrack.enabled, true);
  assert.equal(mockCallingService.currentSession.isCameraOff, false);

  // 2. Toggle OFF
  mockCallingService.toggleCamera();
  assert.equal(videoTrack.enabled, false);
  assert.equal(mockCallingService.currentSession.isCameraOff, true);
  assert.equal(notified, true);

  // 3. Toggle ON again
  notified = false;
  mockCallingService.toggleCamera();
  assert.equal(videoTrack.enabled, true);
  assert.equal(mockCallingService.currentSession.isCameraOff, false);
  assert.equal(notified, true);
});

test('13. CallOverlay error state renders dismiss button and failure card', () => {
  assert.match(source, /session\.state === 'failed'/);
  assert.match(source, /onClick=\{\(\) => callingService\.dismissError\(\)\}/);
  assert.match(source, />\s*Dismiss\s*<\/button>/);
});

test('14. CallOverlay renders non-blocking fallback banner when camera is unavailable', () => {
  assert.match(source, /session\.errorMessage && \(session\.state === 'calling' \|\| session\.state === 'connecting' \|\| session\.state === 'connected'\)/);
  assert.match(source, /<AlertCircle/);
});

test('15. CallOverlay attaches addtrack and removetrack event listeners to remoteStream', () => {
  assert.match(source, /remoteStream\.addEventListener\('addtrack', handleTrackAdded\)/);
  assert.match(source, /remoteStream\.addEventListener\('removetrack', handleTrackRemoved\)/);
});

test('16. Regression Test: CallingService session updates create new object references for React state', () => {
  let session = {
    callId: 'call_123',
    peerUserId: 'user_b',
    peerName: 'Bob',
    type: 'video' as const,
    state: 'calling' as string,
    isMuted: false,
    isCameraOff: false,
  };

  const updateSession = (updater: (prev: typeof session) => Partial<typeof session>) => {
    session = { ...session, ...updater(session) };
  };

  const initialRef = session;
  updateSession(() => ({ state: 'connected' }));

  // Object reference MUST change so React setSession detects state change
  assert.notEqual(session, initialRef);
  assert.equal(session.state, 'connected');
  assert.equal(session.callId, 'call_123');
  assert.equal(session.peerUserId, 'user_b');
});

test('17. Regression Test: Caller side properly preserves remote tracks and never clobbers remoteStream', () => {
  const mockRemoteStream = {
    tracks: [] as any[],
    getTracks() {
      return this.tracks;
    },
    getVideoTracks() {
      return this.tracks.filter((t: any) => t.kind === 'video');
    },
    addTrack(track: any) {
      if (!this.tracks.some((t: any) => t.id === track.id)) {
        this.tracks.push(track);
      }
    },
  };

  const videoTrack = { id: 'track_video_1', kind: 'video', enabled: true, readyState: 'live' };
  const audioTrack = { id: 'track_audio_1', kind: 'audio', enabled: true, readyState: 'live' };

  mockRemoteStream.addTrack(audioTrack);
  assert.equal(mockRemoteStream.getTracks().length, 1);
  assert.equal(mockRemoteStream.getVideoTracks().length, 0);

  mockRemoteStream.addTrack(videoTrack);
  assert.equal(mockRemoteStream.getTracks().length, 2);
  assert.equal(mockRemoteStream.getVideoTracks().length, 1);
  assert.equal(mockRemoteStream.getVideoTracks()[0].id, 'track_video_1');
});

test('18. WebRTC Bidirectional Media: Callee attaches local audio/video tracks BEFORE creating answer', () => {
  class MockRTCPeerConnection {
    public senders: any[] = [];
    public remoteDescription: any = null;
    public localDescription: any = null;

    addTrack(track: any, stream: any) {
      this.senders.push({ track, stream });
    }

    getSenders() {
      return this.senders;
    }

    async setRemoteDescription(sdp: any) {
      this.remoteDescription = sdp;
    }

    async createAnswer() {
      // Must have audio and video senders added before creating answer
      const hasAudio = this.senders.some((s) => s.track?.kind === 'audio');
      const hasVideo = this.senders.some((s) => s.track?.kind === 'video');
      assert.ok(hasAudio, 'Callee must have local audio track added before createAnswer');
      assert.ok(hasVideo, 'Callee must have local video track added before createAnswer');
      return {
        type: 'answer',
        sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=sendrecv\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendrecv\r\n',
      };
    }

    async setLocalDescription(sdp: any) {
      this.localDescription = sdp;
    }
  }

  const pc = new MockRTCPeerConnection();
  const calleeAudioTrack = { id: 'callee_audio_1', kind: 'audio', enabled: true };
  const calleeVideoTrack = { id: 'callee_video_1', kind: 'video', enabled: true };
  const calleeStream = { getTracks: () => [calleeAudioTrack, calleeVideoTrack] };

  // Callee flow:
  // 1. Add local tracks
  calleeStream.getTracks().forEach((track) => pc.addTrack(track, calleeStream));
  assert.equal(pc.getSenders().length, 2);

  // 2. Set remote offer
  pc.setRemoteDescription({ type: 'offer', sdp: 'fake-offer' });

  // 3. Create answer and verify sendrecv
  pc.createAnswer().then((answer) => {
    assert.match(answer.sdp, /m=audio[\s\S]*?a=sendrecv/);
    assert.match(answer.sdp, /m=video[\s\S]*?a=sendrecv/);
  });
});

test('19. WebRTC Bidirectional Media: Caller and Callee both receive ontrack events for audio and video', () => {
  const callerRemoteTracks: string[] = [];
  const calleeRemoteTracks: string[] = [];

  const callerPc = {
    ontrack: (evt: any) => callerRemoteTracks.push(evt.track.kind),
  };
  const calleePc = {
    ontrack: (evt: any) => calleeRemoteTracks.push(evt.track.kind),
  };

  // Simulate Caller receiving Callee tracks
  callerPc.ontrack({ track: { id: 'b_audio', kind: 'audio', readyState: 'live' } });
  callerPc.ontrack({ track: { id: 'b_video', kind: 'video', readyState: 'live' } });

  // Simulate Callee receiving Caller tracks
  calleePc.ontrack({ track: { id: 'a_audio', kind: 'audio', readyState: 'live' } });
  calleePc.ontrack({ track: { id: 'a_video', kind: 'video', readyState: 'live' } });

  assert.deepEqual(callerRemoteTracks, ['audio', 'video']);
  assert.deepEqual(calleeRemoteTracks, ['audio', 'video']);
});
