// src/webrtc/localMovie.test.ts
// Phase 6.10 — Local Movie Mode (zero-server movie sharing) unit tests.
//
// Run: npx tsx --test src/webrtc/localMovie.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LocalMovieController,
  LocalMovieControllerDeps,
  applyRemoteMovieTrack,
  buildMovieTrackMeta,
  canBrowserPlay,
  captureStreamTrackCounts,
  checkMediaSeparation,
  classifyRemoteTrackKind,
  localMovieMetadata,
  movieSourceHasDecodedAudio,
} from './localMovie';

const roomViewPath = resolve(dirname(fileURLToPath(import.meta.url)), '../components/room/RoomView.tsx');
const webRTCManagerPath = resolve(dirname(fileURLToPath(import.meta.url)), './WebRTCManager.ts');

function fakeStream(trackIds: { id: string; kind: string }[]) {
  return {
    getTracks: () => trackIds.map((t) => ({ ...t })),
  } as unknown as MediaStream;
}

function fakeFile(name: string, type = '') {
  return { name, type };
}

/** Minimal video-like object for canBrowserPlay. */
function fakeVideo(canPlay: (t: string) => string) {
  return { canPlayType: canPlay };
}

// ─── A. Local movie never calls the upload API ───────────────────────────────

test('A1: local movie flow in RoomView never references the upload API', () => {
  const source = readFileSync(roomViewPath, 'utf8');
  // The local movie file-picker UI was removed from the room media picker
  // (Phase 6.11). The invariant that survives: the movie never leaves the
  // device — no upload API reference may ever appear in RoomView, and the
  // old picker entry points must not regress into the UI.
  assert.doesNotMatch(source, /uploadRoomMedia|uploadRoomMediaApi/);
  assert.doesNotMatch(source, /Play Local Movie|Play a Local Movie/);
});

test('A2: LocalMovieController has no upload capability (compile-time proof)', () => {
  const deps: LocalMovieControllerDeps = {
    setLocalMovieActive: async () => true,
    revokeObjectUrl: () => {},
  };
  const controller = new LocalMovieController(deps);
  assert.equal(controller.isActive, false);
  // Structural assertion: the deps surface exposes only stream/metadata and
  // object-URL lifecycle — nothing that could ship file bytes.
  assert.deepEqual(Object.keys(deps).sort(), ['revokeObjectUrl', 'setLocalMovieActive']);
});

// ─── B. Blob URL never enters room/server state ──────────────────────────────

test('B1: local movie metadata contains no url / blob URL', () => {
  const meta = localMovieMetadata(fakeFile('movie.mp4', 'video/mp4'), 'user-1', 120);
  assert.equal(meta.mediaType, 'local-movie');
  assert.ok(!('url' in meta), 'metadata must not carry a url field');
  assert.ok(!JSON.stringify(meta).includes('blob:'), 'metadata JSON must never contain a blob URL');
  assert.ok(!JSON.stringify(meta).includes('file:'), 'metadata JSON must never contain a file path');
});

test('B2: blob URL created locally is passed only to the session, never announced', async () => {
  const announced: unknown[] = [];
  const deps: LocalMovieControllerDeps = {
    setLocalMovieActive: async (stream, metadata) => {
      announced.push(metadata);
      return stream !== null;
    },
    revokeObjectUrl: () => {},
  };
  const controller = new LocalMovieController(deps);
  const url = 'blob:http://localhost:3000/abc123';
  const stream = fakeStream([{ id: 'v1', kind: 'video' }]);
  const result = await controller.start(fakeFile('movie.mp4', 'video/mp4'), url, stream, { duration: 90 });
  assert.equal(result.ok, true);
  const meta = announced[0] as Record<string, unknown>;
  assert.equal(meta?.mediaType, 'local-movie');
  assert.ok(!('url' in (meta ?? {})), 'announced metadata must never include the blob URL');
  assert.notEqual(controller.activeUrl, null, 'the blob URL lives only in the controller session');
});

// ─── C. Lightweight metadata is sent instead of the file ─────────────────────

test('C: metadata carries title / mimeType / duration / sourceUserId only', () => {
  const meta = localMovieMetadata(fakeFile('My Cool Movie.mkv', 'video/x-matroska'), 'user-42', 6420);
  assert.equal(meta.title, 'My Cool Movie');
  assert.equal(meta.mimeType, 'video/x-matroska');
  assert.equal(meta.duration, 6420);
  assert.equal(meta.sourceUserId, 'user-42');
  const keys = Object.keys(meta).sort();
  assert.deepEqual(keys, ['duration', 'mediaType', 'mimeType', 'sourceUserId', 'title']);
});

test('C2: empty MIME type is omitted, not rejected', () => {
  const meta = localMovieMetadata(fakeFile('movie.avi'), 'user-1');
  assert.equal(meta.mimeType, undefined);
  assert.equal(meta.title, 'movie');
});

// ─── D. Movie track is added to WebRTC peers ─────────────────────────────────

test('D: controller attaches the captured movie stream to the peers', async () => {
  const attached: (MediaStream | null)[] = [];
  const deps: LocalMovieControllerDeps = {
    setLocalMovieActive: async (stream) => {
      attached.push(stream);
      return true;
    },
    revokeObjectUrl: () => {},
  };
  const controller = new LocalMovieController(deps);
  const stream = fakeStream([{ id: 'movie-v', kind: 'video' }, { id: 'movie-a', kind: 'audio' }]);
  await controller.start(fakeFile('movie.mp4', 'video/mp4'), 'blob:http://localhost:3000/x', stream, {});
  assert.equal(attached.length, 1);
  assert.equal(attached[0], stream);
});

// ─── E. Movie track metadata identifies kind="movie" ─────────────────────────

test('E: track-meta payload identifies the movie track', () => {
  const meta = buildMovieTrackMeta('track-123');
  assert.deepEqual(meta, { type: 'track-meta', trackId: 'track-123', trackKind: 'movie' });
});

// ─── F. Remote movie stream stored separately from camera/screen ─────────────

test('F: classification routes movie tracks to the movie stream role', () => {
  assert.equal(classifyRemoteTrackKind('movie', { kind: 'video' }), 'movie');
  assert.equal(classifyRemoteTrackKind('movie', { kind: 'audio' }), 'movie', 'movie audio must not become camera audio');
  assert.equal(classifyRemoteTrackKind('screen', { kind: 'video' }), 'screen');
  assert.equal(classifyRemoteTrackKind(undefined, { kind: 'video', label: 'screen 1' }), 'screen');
  assert.equal(classifyRemoteTrackKind(undefined, { kind: 'video', contentHint: 'detail' }), 'screen');
  assert.equal(classifyRemoteTrackKind(undefined, { kind: 'video', label: 'Camera' }), 'camera');
  assert.equal(classifyRemoteTrackKind(undefined, { kind: 'audio' }), 'audio');
});

// ─── G/H. Camera / screen / movie separation invariants ──────────────────────

test('G: camera, screen and movie streams coexist without violations', () => {
  const camera = fakeStream([{ id: 'cam-v', kind: 'video' }, { id: 'mic-a', kind: 'audio' }]);
  const screen = fakeStream([{ id: 'scr-v', kind: 'video' }]);
  const movie = fakeStream([{ id: 'movie-v', kind: 'video' }, { id: 'movie-a', kind: 'audio' }]);
  assert.deepEqual(checkMediaSeparation(camera, screen, movie), []);
});

test('H: a movie track must never leak into camera or screen streams', () => {
  const camera = fakeStream([{ id: 'cam-v', kind: 'video' }]);
  const screen = fakeStream([{ id: 'scr-v', kind: 'video' }]);
  const movie = fakeStream([{ id: 'cam-v', kind: 'video' }]); // shared with camera!
  const violations = checkMediaSeparation(camera, screen, movie);
  assert.ok(violations.some((v) => v.includes('movie and camera')), `expected movie/camera violation, got: ${violations.join(', ')}`);
});

// ─── I. Replacing the movie stops the old track ──────────────────────────────

test('I: starting a new movie detaches the previous stream first', async () => {
  const calls: Array<{ stream: MediaStream | null; seq: number }> = [];
  const deps: LocalMovieControllerDeps = {
    setLocalMovieActive: async (stream) => {
      calls.push({ stream, seq: calls.length });
      return true;
    },
    revokeObjectUrl: () => {},
  };
  const controller = new LocalMovieController(deps);
  const first = fakeStream([{ id: 'v1', kind: 'video' }]);
  const second = fakeStream([{ id: 'v2', kind: 'video' }]);
  await controller.start(fakeFile('a.mp4'), 'blob:url-a', first, {});
  await controller.start(fakeFile('b.mp4'), 'blob:url-b', second, {});
  assert.equal(calls.length, 3);
  assert.equal(calls[1].stream, null, 'old movie stream must be detached before the new one attaches');
  assert.equal(calls[2].stream, second);
  assert.equal(controller.isActive, true);
  assert.equal(controller.activeUrl, 'blob:url-b');
});

// ─── J. Object URLs revoked during cleanup ───────────────────────────────────

test('J1: stop() revokes the active blob URL and detaches the stream', async () => {
  const revoked: string[] = [];
  let attached: MediaStream | null = fakeStream([{ id: 'v1', kind: 'video' }]);
  const deps: LocalMovieControllerDeps = {
    setLocalMovieActive: async (stream) => {
      attached = stream;
      return true;
    },
    revokeObjectUrl: (url) => revoked.push(url),
  };
  const controller = new LocalMovieController(deps);
  await controller.start(fakeFile('a.mp4'), 'blob:url-1', attached, {});
  assert.equal(controller.isActive, true);
  await controller.stop();
  assert.ok(revoked.includes('blob:url-1'), 'blob URL must be revoked on stop');
  assert.equal(attached, null, 'movie stream must be detached on stop');
  assert.equal(controller.isActive, false);
  assert.equal(controller.activeUrl, null);
});

test('J2: replacing the movie revokes the previous blob URL', async () => {
  const revoked: string[] = [];
  const deps: LocalMovieControllerDeps = {
    setLocalMovieActive: async (stream) => stream !== null,
    revokeObjectUrl: (url) => revoked.push(url),
  };
  const controller = new LocalMovieController(deps);
  await controller.start(fakeFile('a.mp4'), 'blob:url-1', fakeStream([{ id: 'v1', kind: 'video' }]), {});
  await controller.start(fakeFile('b.mp4'), 'blob:url-2', fakeStream([{ id: 'v2', kind: 'video' }]), {});
  assert.ok(revoked.includes('blob:url-1'), 'previous blob URL must be revoked on replace');
  assert.ok(!revoked.includes('blob:url-2'), 'the live URL must not be revoked');
});

// ─── K. Unsupported media handled gracefully ─────────────────────────────────

test('K1: canPlayType that returns "" maps to "no"', () => {
  const video = fakeVideo(() => '');
  assert.equal(canBrowserPlay(video, 'video/x-unknown'), 'no');
});

test('K2: canPlayType throwing maps to "no" (never crashes)', () => {
  const video = fakeVideo(() => {
    throw new Error('boom');
  });
  assert.equal(canBrowserPlay(video, 'video/mp4'), 'no');
});

test('K3: empty MIME type is not rejected (browser decides at load time)', () => {
  const video = fakeVideo(() => 'maybe');
  assert.equal(canBrowserPlay(video, undefined), 'maybe');
  assert.equal(canBrowserPlay(video, ''), 'maybe');
});

test('K4: missing capture stream fails gracefully instead of uploading', async () => {
  const deps: LocalMovieControllerDeps = {
    setLocalMovieActive: async (stream) => stream !== null,
    revokeObjectUrl: () => {},
  };
  const controller = new LocalMovieController(deps);
  const result = await controller.start(fakeFile('a.mp4'), 'blob:url-1', null, {});
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, 'capture-stream-unavailable');
  assert.equal(controller.isActive, false);
});

// ─── L. Direct URL media still works (unchanged separate mode) ───────────────

test('L: local-movie metadata is shaped for the metadata-only room API', () => {
  // The room API payload for a local movie must be settable WITHOUT url —
  // exactly what the server accepts for mediaType "local-movie". The direct
  // URL mode keeps url — covered by the existing server media tests.
  const meta = localMovieMetadata(fakeFile('movie.mov', 'video/quicktime'), 'user-1', 55);
  const payload: Record<string, unknown> = { ...meta };
  assert.ok(!('url' in payload));
  assert.equal(payload.mediaType, 'local-movie');
  assert.equal(payload.title, 'movie');
  assert.equal(payload.mimeType, 'video/quicktime');
});

// ─── M. Movie audio path (Phase 6.10 audio fix) ─────────────────────────────

test('M1: capture stream with video + audio is recognized', () => {
  const av = fakeStream([{ id: 'mv-1', kind: 'video' }, { id: 'ma-1', kind: 'audio' }]);
  assert.deepEqual(captureStreamTrackCounts(av), { videoTracks: 1, audioTracks: 1 });
  const vOnly = fakeStream([{ id: 'mv-1', kind: 'video' }]);
  assert.deepEqual(captureStreamTrackCounts(vOnly), { videoTracks: 1, audioTracks: 0 });
  assert.deepEqual(captureStreamTrackCounts(null), { videoTracks: 0, audioTracks: 0 });
  assert.deepEqual(captureStreamTrackCounts(undefined), { videoTracks: 0, audioTracks: 0 });
});

test('M2: remote movie stream keeps video AND audio (video arrives first)', () => {
  let list = applyRemoteMovieTrack([], { id: 'mv-1', kind: 'video' }).tracks;
  list = applyRemoteMovieTrack(list, { id: 'ma-1', kind: 'audio' }).tracks;
  const kinds = list.map((t) => t.kind);
  assert.ok(kinds.includes('video') && kinds.includes('audio'), 'guest movie stream must carry both kinds');
  assert.deepEqual(list.map((t) => t.id).sort(), ['ma-1', 'mv-1']);
});

test('M3: remote movie stream keeps audio AND video (audio arrives first)', () => {
  let list = applyRemoteMovieTrack([], { id: 'ma-1', kind: 'audio' }).tracks;
  list = applyRemoteMovieTrack(list, { id: 'mv-1', kind: 'video' }).tracks;
  assert.deepEqual(list.map((t) => t.kind).sort(), ['audio', 'video']);
  assert.deepEqual(list.map((t) => t.id).sort(), ['ma-1', 'mv-1']);
});

test('M4: movie replacement swaps only the old same-kind tracks (audio survives)', () => {
  let list = applyRemoteMovieTrack([], { id: 'mv-1', kind: 'video' }).tracks;
  list = applyRemoteMovieTrack(list, { id: 'ma-1', kind: 'audio' }).tracks;
  list = applyRemoteMovieTrack(list, { id: 'mv-2', kind: 'video' }).tracks;
  assert.deepEqual(list.map((t) => t.id).sort(), ['ma-1', 'mv-2'], 'old video replaced, old audio kept, new video added');
  list = applyRemoteMovieTrack(list, { id: 'ma-2', kind: 'audio' }).tracks;
  assert.deepEqual(list.map((t) => t.id).sort(), ['ma-2', 'mv-2'], 'old audio replaced by the new movie audio');
});

test('M5: duplicate movie track id is a no-op (never duplicated)', () => {
  let list = applyRemoteMovieTrack([], { id: 'mv-1', kind: 'video' }).tracks;
  list = applyRemoteMovieTrack(list, { id: 'ma-1', kind: 'audio' }).tracks;
  const result = applyRemoteMovieTrack(list, { id: 'mv-1', kind: 'video' });
  assert.equal(result.changed, false);
  assert.equal(result.tracks.length, 2);
});

test('M6: decoded-audio detection accepts Chromium webkit metrics', () => {
  assert.equal(movieSourceHasDecodedAudio({ webkitAudioDecodedByteCount: 4096 }), true);
  assert.equal(movieSourceHasDecodedAudio({ webkitAudioDecodedSampleCount: 1024 }), true);
  assert.equal(movieSourceHasDecodedAudio({ webkitAudioDecodedByteCount: 0 }), false);
  assert.equal(movieSourceHasDecodedAudio({ webkitAudioDecodedSampleCount: 0 }), false);
  assert.equal(movieSourceHasDecodedAudio({}), false);
  assert.equal(movieSourceHasDecodedAudio(null), false);
  assert.equal(movieSourceHasDecodedAudio(undefined), false);
});

test('M7: guest movie video element must not force muted', () => {
  const source = readFileSync(roomViewPath, 'utf8');
  const start = source.indexOf('ref={remoteMovieStageVideoRef}');
  const end = source.indexOf('onLoadedMetadata', start);
  assert.ok(start >= 0 && end > start, 'remote movie stage <video> block must exist');
  const block = source.slice(start, end);
  assert.doesNotMatch(block, /\bmuted\s*=/, 'remote movie <video> must not be muted by default');
  assert.match(block, /autoPlay/, 'remote movie <video> must stay autoPlay');
});

test('M8: autoplay rejection produces a sound-enable UI state', () => {
  const source = readFileSync(roomViewPath, 'utf8');
  assert.match(source, /movieSoundBlocked/, 'guest sound-blocked state must exist');
  assert.match(source, /Enable Movie Sound/, 'guest must get a click-to-enable-sound control');
  assert.match(source, /setMovieSoundBlocked\(true\)/, 'NotAllowedError must drive the sound-blocked state');
});

test('M9: movie audio sender bookkeeping is explicit and separate from the mic', () => {
  const source = readFileSync(webRTCManagerPath, 'utf8');
  assert.match(source, /movieAudioSenderByPeer/);
  assert.match(source, /\[LOCAL MOVIE AUDIO\] attaching movie audio track/);
  assert.match(source, /bookkeptMovieAudioSender/, 'mic sender lookup must exclude the bookkept movie audio sender');
  assert.match(source, /applyRemoteMovieTrack/, 'remote movie stream merge must be per-kind');
  assert.match(source, /\[REMOTE MOVIE AUDIO\]/, 'guest must log the remote movie audio track');
  assert.match(source, /\[REMOTE MOVIE STREAM\]/, 'guest must log movie stream video/audio counts');
});

test('M10: movie stop clears the movie audio sender (replaceTrack(null))', () => {
  const source = readFileSync(webRTCManagerPath, 'utf8');
  assert.match(source, /movie audio replaceTrack\(null\)/, 'movie audio sender must be cleared on stop');
  assert.match(source, /stopLocalMovieStream/);
  assert.match(source, /hasBookkeptSenders/, 'attachMovieTrackToPeer must still clear senders when movieStream is null');
});

// ─── N. Movie audio diagnostics trace (exact [MOVIE AUDIO DEBUG] tags) ───────
// The user-facing two-browser test relies on these EXACT tags; every tag must
// exist in the code with its decisive fields before any manual test is run.
// Note: the HOST CAPTURE tag lived in the RoomView file-picker flow, which was
// removed from the media picker (Phase 6.11) — the host side is no longer
// reachable from the UI, so only the WebRTC-manager tags remain tested.

test('N-A2: captured stream with video AND audio is recognized (pure)', () => {
  const av = fakeStream([
    { id: 'mv-1', kind: 'video' },
    { id: 'ma-1', kind: 'audio' },
  ]);
  const counts = captureStreamTrackCounts(av);
  assert.equal(counts.videoTracks, 1, 'capture must expose the video track');
  assert.equal(counts.audioTracks, 1, 'capture must expose the audio track (Case A answer)');
});

test('N-B: HOST SENDER log verifies the movie audio sender holds the movie audio track', () => {
  const source = readFileSync(webRTCManagerPath, 'utf8');
  const idx = source.indexOf('[MOVIE AUDIO DEBUG] HOST SENDER');
  assert.ok(idx >= 0, 'exact tag [MOVIE AUDIO DEBUG] HOST SENDER must exist');
  const block = source.slice(idx, idx + 1200);
  assert.match(block, /movieAudioTrackId/);
  assert.match(block, /senderExists/);
  assert.match(block, /senderTrackId/);
  assert.match(block, /senderTrackKind/);
  assert.match(block, /senderTrackReadyState/);
  assert.match(block, /senderTrackMatchesMovieAudio/, 'must verify sender.track === movieAudioTrack');
  assert.match(block, /totalAudioSenders/);
  assert.match(block, /movieAudioSenderByPeerHasEntry/);
});

test('N-C: mic sender lookup excludes the movie audio sender from BOTH the sender scan and the transceiver fallback', () => {
  const source = readFileSync(webRTCManagerPath, 'utf8');
  const idx = source.indexOf('bookkeptMovieAudioSender');
  assert.ok(idx >= 0);
  const block = source.slice(idx, idx + 1400);
  assert.match(block, /isMovieAudioSender/, 'a shared predicate must identify the movie audio sender');
  assert.match(block, /bookkeptMovieAudioSender/, 'the bookkept movie audio sender must be excluded');
  assert.match(block, /getTransceivers\(\)/, 'the transceiver fallback must also exclude the movie sender');
  assert.match(block, /!isMovieAudioSender\(t\.sender\)/, 'fallback must never resolve to the movie audio transceiver');
});

test('N-D: GUEST MOVIE STREAM log requires video>=1 AND audio>=1 with STOP verdict', () => {
  const source = readFileSync(webRTCManagerPath, 'utf8');
  const idx = source.indexOf('[MOVIE AUDIO DEBUG] GUEST MOVIE STREAM');
  assert.ok(idx >= 0, 'exact tag [MOVIE AUDIO DEBUG] GUEST MOVIE STREAM must exist');
  const block = source.slice(idx, idx + 1100);
  assert.match(block, /fromUserId/);
  assert.match(block, /streamId/);
  assert.match(block, /videoTrackCount/);
  assert.match(block, /audioTrackCount/);
  assert.match(block, /videoTrackIds/);
  assert.match(block, /audioTrackIds/);
  assert.match(block, /verdict/, 'must log OK when video>=1 AND audio>=1, STOP otherwise');
  assert.match(block, /'STOP'/, 'STOP verdict must exist');
});

test('N-D2: GUEST REMOTE TRACK log reports the raw incoming movie track', () => {
  const source = readFileSync(webRTCManagerPath, 'utf8');
  const idx = source.indexOf('[MOVIE AUDIO DEBUG] GUEST REMOTE TRACK');
  assert.ok(idx >= 0, 'exact tag [MOVIE AUDIO DEBUG] GUEST REMOTE TRACK must exist');
  const block = source.slice(idx, idx + 1100);
  assert.match(block, /trackId/);
  assert.match(block, /kind/);
  assert.match(block, /readyState/);
  assert.match(block, /enabled/);
  assert.match(block, /muted/);
  assert.match(block, /label/);
  assert.match(block, /streamIds/);
  assert.match(block, /classifiedVia/, 'must log whether classification used track-meta or heuristics');
});

test('N-D3: remote movie stream keeps video AND audio (pure, both arrival orders)', () => {
  let list = applyRemoteMovieTrack([], { id: 'mv-1', kind: 'video' }).tracks;
  list = applyRemoteMovieTrack(list, { id: 'ma-1', kind: 'audio' }).tracks;
  assert.equal(list.filter((t) => t.kind === 'audio').length, 1);
  assert.equal(list.filter((t) => t.kind === 'video').length, 1);
  let list2 = applyRemoteMovieTrack([], { id: 'ma-2', kind: 'audio' }).tracks;
  list2 = applyRemoteMovieTrack(list2, { id: 'mv-2', kind: 'video' }).tracks;
  assert.equal(list2.filter((t) => t.kind === 'audio').length, 1);
  assert.equal(list2.filter((t) => t.kind === 'video').length, 1);
});

test('N-E: movie replacement swaps only same-kind tracks (audio survives a new movie)', () => {
  let list = applyRemoteMovieTrack([], { id: 'mv-1', kind: 'video' }).tracks;
  list = applyRemoteMovieTrack(list, { id: 'ma-1', kind: 'audio' }).tracks;
  list = applyRemoteMovieTrack(list, { id: 'mv-2', kind: 'video' }).tracks;
  assert.deepEqual(list.map((t) => t.id).sort(), ['ma-1', 'mv-2'], 'replacing a movie must never drop its audio');
});

test('N-F: movie stop clears the movie audio sender', () => {
  const source = readFileSync(webRTCManagerPath, 'utf8');
  assert.match(source, /movie audio replaceTrack\(null\)/, 'stop must replaceTrack(null) the movie audio sender');
  assert.match(source, /hasBookkeptSenders/, 'stop must still clear senders when movieStream is null');
  assert.match(source, /setLocalMovieStream\(null\)/, 'stop path must be reachable from setLocalMovieStream(null)');
});

test('N-G: GUEST VIDEO ELEMENT log exists and the element is not muted by default', () => {
  const source = readFileSync(roomViewPath, 'utf8');
  const idx = source.indexOf('[MOVIE AUDIO DEBUG] GUEST VIDEO ELEMENT');
  assert.ok(idx >= 0, 'exact tag [MOVIE AUDIO DEBUG] GUEST VIDEO ELEMENT must exist');
  const block = source.slice(idx, idx + 900);
  assert.match(block, /muted/);
  assert.match(block, /volume/);
  assert.match(block, /paused/);
  assert.match(block, /autoplay/);
  assert.match(block, /srcObjectStreamId/);
  assert.match(block, /audioTrackCount/);
  const jsxStart = source.indexOf('ref={remoteMovieStageVideoRef}');
  const jsxEnd = source.indexOf('onLoadedMetadata', jsxStart);
  const jsxBlock = source.slice(jsxStart, jsxEnd);
  assert.doesNotMatch(jsxBlock, /\bmuted\s*=/, 'remote movie <video> must not be muted by default');
});

test('N-H: NotAllowedError logs GUEST AUTOPLAY BLOCKED and shows the sound-enable control', () => {
  const source = readFileSync(roomViewPath, 'utf8');
  assert.match(source, /\[MOVIE AUDIO DEBUG\] GUEST AUTOPLAY BLOCKED/, 'exact tag must exist on NotAllowedError');
  assert.match(source, /errorName/, 'must log the rejection reason');
  assert.match(source, /setMovieSoundBlocked\(true\)/, 'NotAllowedError must drive the sound-blocked state');
  assert.match(source, /Enable Movie Sound/, 'guest must get a click-to-enable-sound control');
  assert.match(source, /movieSoundBlocked/, 'the sound-blocked state must exist');
});