// src/webrtc/localMovie.ts
// Phase 6.10 — Local Movie Mode (zero-server movie sharing).
//
// The host picks a local video file. The file NEVER leaves the device:
//   - no upload, no FormData, no server-visible URL or path
//   - a blob URL exists only inside the host browser (rendered <video>)
//   - the <video> is captured with video.captureStream() and the captured
//     MediaStream is attached to the existing WebRTC peers (movie tracks)
//   - the server receives ONLY lightweight metadata: mediaType 'local-movie',
//     title, mimeType, duration, sourceUserId
//
// This module holds the pure, unit-testable pieces of that pipeline:
//   - localMovieMetadata()      — metadata only, never a URL
//   - buildMovieTrackMeta()     — WebRTC track-meta payload with kind 'movie'
//   - classifyRemoteTrackKind() — explicit-kind-first remote track classification
//   - canBrowserPlay()          — canPlayType gate for the unsupported-format UX
//   - checkMediaSeparation()    — camera/screen/movie ownership invariant
//   - LocalMovieController      — replace/stop lifecycle + object-URL bookkeeping

/** Lightweight metadata sent to the room. Deliberately contains NO url, NO
 *  blob URL, NO path — the movie itself travels only host → WebRTC → peers. */
export interface LocalMovieMetadata {
  mediaType: 'local-movie';
  title: string;
  mimeType?: string;
  duration?: number;
  sourceUserId?: string;
}

/** Title used for the room media row when the file name is missing. */
const DEFAULT_LOCAL_MOVIE_TITLE = 'Local movie';

/** Build the room metadata for a local movie file. */
export function localMovieMetadata(
  file: { name: string; type?: string },
  sourceUserId?: string,
  duration?: number
): LocalMovieMetadata {
  const baseName = (file.name || '').trim();
  const title = baseName.replace(/\.[^.]+$/, '') || DEFAULT_LOCAL_MOVIE_TITLE;
  const mimeType = file.type && file.type.trim() ? file.type.trim() : undefined;
  return {
    mediaType: 'local-movie',
    title,
    ...(mimeType ? { mimeType } : {}),
    ...(typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 ? { duration } : {}),
    ...(sourceUserId ? { sourceUserId } : {}),
  };
}

/** WebRTC track-meta payload identifying a captured movie track. */
export function buildMovieTrackMeta(trackId: string): {
  type: 'track-meta';
  trackId: string;
  trackKind: 'movie';
} {
  return { type: 'track-meta', trackId, trackKind: 'movie' };
}

/** Roles a remote track can play in the room. 'movie' is the Phase 6.10
 *  peer-to-peer movie stream; it must never be folded into camera or screen. */
export type RemoteTrackRole = 'camera' | 'screen' | 'movie' | 'audio';

/**
 * Order-independent classification of an incoming remote track.
 * Explicit track-meta wins; the screen heuristics only apply to video tracks
 * whose meta has not arrived yet; audio with no meta is camera audio (a late
 * 'movie' meta migrates it via track-meta handling).
 */
export function classifyRemoteTrackKind(
  explicitKind: string | undefined,
  info: { kind: string; contentHint?: string; label?: string }
): RemoteTrackRole {
  if (info.kind === 'audio') {
    return explicitKind === 'movie' ? 'movie' : 'audio';
  }
  if (explicitKind === 'movie') return 'movie';
  if (explicitKind === 'screen') return 'screen';
  const label = (info.label || '').toLowerCase();
  if (info.contentHint === 'detail' || label.includes('screen') || label.includes('window') || label.includes('display')) {
    return 'screen';
  }
  return 'camera';
}

export type Playability = 'probably' | 'maybe' | 'no';

/**
 * Browser codec gate. Returns 'probably'/'maybe' when canPlayType() supports
 * the container, 'no' when it returns '' or throws. An empty MIME type is
 * unknowable and therefore NOT rejected (playability is decided by the
 * element's load/error events anyway).
 */
export function canBrowserPlay(
  video: { canPlayType(type: string): string },
  mimeType: string | undefined
): Playability {
  if (!mimeType || !mimeType.trim()) return 'maybe';
  try {
    const result = video.canPlayType(mimeType);
    return result === 'probably' ? 'probably' : result === 'maybe' ? 'maybe' : 'no';
  } catch {
    return 'no';
  }
}

export interface TrackLike {
  id: string;
  kind: string;
}

/**
 * Phase 6.10 audio path — count the video/audio tracks of a captured or
 * remote movie stream. Pure and unit-testable; browsers are NOT guaranteed
 * to expose captureStream audio (0 audio tracks must be handled gracefully).
 */
export function captureStreamTrackCounts(
  stream: { getTracks(): TrackLike[] } | null | undefined
): { videoTracks: number; audioTracks: number } {
  const tracks = stream?.getTracks() ?? [];
  return {
    videoTracks: tracks.filter((t) => t.kind === 'video').length,
    audioTracks: tracks.filter((t) => t.kind === 'audio').length,
  };
}

/**
 * Phase 6.10 audio fix — merge an incoming remote movie track into the
 * existing movie-track list. Only SAME-KIND stale tracks (a previous movie
 * session) are replaced; other-kind tracks are preserved, so a movie's video
 * AND audio always coexist on the guest. The naive "any different id is
 * stale" replacement destroyed the earlier track, leaving the guest with a
 * video-only (silent) movie stream.
 * Returns { changed, tracks } where `tracks` is the desired new list.
 */
export function applyRemoteMovieTrack(
  current: TrackLike[] | null | undefined,
  incoming: TrackLike
): { changed: boolean; tracks: TrackLike[] } {
  const existing = current ?? [];
  if (existing.some((t) => t.id === incoming.id)) {
    return { changed: false, tracks: existing };
  }
  const staleSameKind = existing.filter((t) => t.kind === incoming.kind);
  if (staleSameKind.length > 0) {
    const kept = existing.filter((t) => t.kind !== incoming.kind);
    return { changed: true, tracks: [...kept, incoming] };
  }
  return { changed: true, tracks: [...existing, incoming] };
}

/**
 * True when the host <video> element has actually decoded audio samples
 * (Chromium webkit* metrics). Used to distinguish "movie has no audio" from
 * "the browser did not expose the movie's audio track via captureStream()".
 */
export function movieSourceHasDecodedAudio(
  video: { webkitAudioDecodedByteCount?: number; webkitAudioDecodedSampleCount?: number } | null | undefined
): boolean {
  if (!video) return false;
  const bytes = video.webkitAudioDecodedByteCount;
  const samples = video.webkitAudioDecodedSampleCount;
  if (typeof bytes === 'number' && bytes > 0) return true;
  if (typeof samples === 'number' && samples > 0) return true;
  return false;
}

export interface StreamLike {
  getTracks(): TrackLike[];
}

/**
 * Camera / screen / movie ownership invariant (Phase 6.10 item: movie must be
 * separate from camera and screen). Pure diagnostic — never mutates.
 * Returns the list of violations; an empty array means the invariant holds.
 */
export function checkMediaSeparation(
  camera: StreamLike | null | undefined,
  screen: StreamLike | null | undefined,
  movie: StreamLike | null | undefined
): string[] {
  const ids = (s: StreamLike | null | undefined) => new Set((s?.getTracks() ?? []).map((t) => t.id));
  const camIds = ids(camera);
  const scrIds = ids(screen);
  const movIds = ids(movie);
  const violations: string[] = [];

  const cross = (a: TrackLike[], bIds: Set<string>, label: string) => {
    for (const t of a) {
      if (bIds.has(t.id)) violations.push(`${t.kind} track ${t.id} appears in both ${label}`);
    }
  };

  cross(screen?.getTracks() ?? [], camIds, 'screen and camera');
  cross(camera?.getTracks() ?? [], scrIds, 'camera and screen');
  cross(movie?.getTracks() ?? [], camIds, 'movie and camera');
  cross(camera?.getTracks() ?? [], movIds, 'camera and movie');
  cross(movie?.getTracks() ?? [], scrIds, 'movie and screen');
  cross(screen?.getTracks() ?? [], movIds, 'screen and movie');
  return violations;
}

export interface LocalMovieControllerDeps {
  /**
   * Start (stream + metadata) or stop (null) the peer-to-peer movie session.
   * Implementation attaches/detaches the movie stream on the WebRTC peers and
   * announces lightweight room metadata — never the file, never a URL.
   */
  setLocalMovieActive(stream: MediaStream | null, metadata?: LocalMovieMetadata): Promise<boolean>;
  revokeObjectUrl(url: string): void;
}

export type LocalMovieStartResult =
  | { ok: true; metadata: LocalMovieMetadata }
  | { ok: false; error: 'capture-stream-unavailable' | 'attach-failed' };

/**
 * Lifecycle bookkeeping for the local movie session:
 *  - start: detaches the previous movie stream (stops its WebRTC sender
 *    tracks) and revokes the previous object URL before the new movie starts
 *  - stop: detaches and revokes everything
 *  - it never touches camera/mic/screen streams and has NO upload capability
 */
export class LocalMovieController {
  private activeStream: MediaStream | null = null;
  private currentUrl: string | null = null;

  constructor(private readonly deps: LocalMovieControllerDeps) {}

  /**
   * Start (or replace) a local movie session.
   * `url` is the blob URL the caller already assigned to the host <video>;
   * `stream` is the captured MediaStream from video.captureStream().
   * When replacing, the old movie stream is detached and the old blob URL is
   * revoked BEFORE the new session takes over.
   */
  async start(
    file: { name: string; type?: string },
    url: string,
    stream: MediaStream | null,
    opts: { duration?: number; sourceUserId?: string }
  ): Promise<LocalMovieStartResult> {
    if (this.activeStream || this.currentUrl) {
      await this.deps.setLocalMovieActive(null);
      this.activeStream = null;
      if (this.currentUrl) {
        this.deps.revokeObjectUrl(this.currentUrl);
        this.currentUrl = null;
      }
    }
    if (!stream) {
      return { ok: false, error: 'capture-stream-unavailable' };
    }
    const metadata = localMovieMetadata(file, opts.sourceUserId, opts.duration);
    const ok = await this.deps.setLocalMovieActive(stream, metadata);
    if (!ok) {
      this.deps.revokeObjectUrl(url);
      return { ok: false, error: 'attach-failed' };
    }
    this.activeStream = stream;
    this.currentUrl = url;
    return { ok: true, metadata };
  }

  /** Stop the local movie: detach the movie stream and revoke the blob URL. */
  async stop(): Promise<void> {
    if (this.activeStream || this.currentUrl) {
      await this.deps.setLocalMovieActive(null);
      this.activeStream = null;
      if (this.currentUrl) {
        this.deps.revokeObjectUrl(this.currentUrl);
        this.currentUrl = null;
      }
    }
  }

  /** True while a local movie session is active (for cleanup assertions). */
  get isActive(): boolean {
    return this.activeStream !== null;
  }

  /** Current blob URL held by this session (for cleanup assertions). */
  get activeUrl(): string | null {
    return this.currentUrl;
  }
}