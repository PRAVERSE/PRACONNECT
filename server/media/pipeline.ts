// server/media/pipeline.ts
// Phase C: FFmpeg conversion pipeline for the admin media library.
//
// Pipeline (runs after the final chunk lands):
//   upload complete (media status: uploaded)
//     → assemble the seekable source file from chunk objects
//     → validate container + probe codecs with ffprobe
//     → remux (H.264/AAC source) or transcode (anything else) to MP4 with
//       H.264 + AAC + faststart — the browser-ready playable version
//     → generate a poster/thumbnail
//     → publish playable (+ original when MEDIA_RETAIN_ORIGINAL=1) into
//       MediaStorage, mark media ready, remove session chunks
//
// Safety (mirrors server/uploads/transcode.ts):
//   - FFmpeg runs ONLY via execFile with an argv array — never a shell string
//   - user filenames never appear in command arguments; source/output paths
//     are server-generated under the storage root temp directory
//   - a hard timeout bounds every conversion (MEDIA_CONVERT_TIMEOUT_MS)
//   - temporary and partial outputs are always removed; a failed conversion
//     marks the media 'failed' and keeps the completed session so the admin
//     can retry by calling complete again (chunks are never destroyed by a
//     failed conversion, and active uploads are never touched)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream';
import { createReadStream, createWriteStream } from 'node:fs';
import { getMediaStorage, resolveStorageRoot } from '../storage/mediaStorage';
import { runFfmpegCommand, isFfmpegAvailable, isFfprobeAvailable } from '../uploads/transcode';
import { getUploadSession, chunkKey, missingChunks, removeChunksForUpload } from './uploads';
import { getAdminMedia, transitionMediaStatus, applyConversionResult, safeExtensionFromFilename } from './service';
import { MEDIA_CONVERT_TIMEOUT_MS, MEDIA_RETAIN_ORIGINAL } from './config';
import { db } from '../db/index';

const PROBE_TIMEOUT_MS = 15_000;
const POSTER_TIMEOUT_MS = 30_000;

/** Where FFmpeg's seekable temp files live (inside the storage root). */
export function conversionTempDir(): string {
  return path.join(resolveStorageRoot(), 'tmp');
}

function tempPath(mediaId: string, suffix: string): string {
  return path.join(conversionTempDir(), `lib-${mediaId}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}${suffix}`);
}

export interface ProbeResult {
  videoCodec: string;
  audioCodec: string;
  durationSeconds: number | null;
}

/** Probe a file with FFprobe. Resolves null when probing fails (invalid or
 *  unreadable container). */
export async function probeFile(absPath: string): Promise<ProbeResult | null> {
  if (!isFfprobeAvailable()) return null;
  const result = await runFfmpegCommand(
    [
      'ffprobe',
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_type,codec_name',
      '-of',
      'json',
      absPath,
    ],
    PROBE_TIMEOUT_MS
  );
  if (result.code !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout) as {
      format?: { duration?: string };
      streams?: { codec_type?: string; codec_name?: string }[];
    };
    const video = (parsed.streams ?? []).find((s) => s.codec_type === 'video');
    const audio = (parsed.streams ?? []).find((s) => s.codec_type === 'audio');
    if (!video) return null; // not a watchable video
    const duration = parsed.format?.duration ? Number(parsed.format.duration) : NaN;
    return {
      videoCodec: video.codec_name ?? 'unknown',
      audioCodec: audio?.codec_name ?? '',
      durationSeconds: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
    };
  } catch {
    return null;
  }
}

function convertTimeoutMs(): number {
  return MEDIA_CONVERT_TIMEOUT_MS;
}

/** True when the probed codecs can be remuxed instead of transcoded. */
function isRemuxable(probe: ProbeResult): boolean {
  const audioOk = probe.audioCodec === '' || ['aac', 'mp3', 'opus', 'vorbis', 'flac'].includes(probe.audioCodec);
  return probe.videoCodec === 'h264' && audioOk;
}

/**
 * Assemble the seekable source file from the session's chunk objects
 * (streamed — never fully buffered). Returns the absolute temp path.
 */
async function assembleSource(mediaId: string, sessionId: string): Promise<string> {
  const session = getUploadSession(sessionId);
  if (!session) throw new Error('Upload session not found.');
  const missing = await missingChunks(session);
  if (missing.length > 0) {
    throw new Error(`Source assembly aborted: missing chunk(s) ${missing.slice(0, 10).join(', ')}.`);
  }

  const media = getAdminMedia(mediaId);
  const ext = safeExtensionFromFilename(media?.originalFilename ?? null) ?? 'mp4';
  const target = tempPath(mediaId, `.source.${ext}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const storage = getMediaStorage();
  const out = createWriteStream(target);
  try {
    for (let i = 0; i < session.chunkCount; i++) {
      const read = await storage.read(chunkKey(sessionId, i));
      if (!read) throw new Error(`Chunk ${i} is missing from storage.`);
      // Backpressure-aware copy — never buffers a chunk in memory.
      for await (const chunk of read.stream as AsyncIterable<Buffer>) {
        if (!out.write(chunk)) {
          await new Promise<void>((resolve) => out.once('drain', resolve));
        }
      }
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
  } catch (err) {
    fs.rmSync(target, { force: true });
    throw err;
  }
  return target;
}

/** Generate a poster thumbnail (best effort — failures never fail the item). */
async function generatePoster(sourceAbs: string, mediaId: string): Promise<string | null> {
  try {
    const posterAbs = tempPath(mediaId, '.poster.jpg');
    const result = await runFfmpegCommand(
      [
        'ffmpeg',
        '-y',
        '-loglevel',
        'error',
        '-ss',
        '2',
        '-i',
        sourceAbs,
        '-frames:v',
        '1',
        '-vf',
        'scale=320:-1',
        posterAbs,
      ],
      POSTER_TIMEOUT_MS
    );
    if (result.code !== 0 || !fs.existsSync(posterAbs) || fs.statSync(posterAbs).size === 0) {
      fs.rmSync(posterAbs, { force: true });
      return null;
    }
    return posterAbs;
  } catch {
    return null;
  }
}

export interface LibraryConversionResult {
  ok: true;
  playableKey: string;
  sizeBytes: number;
  durationSeconds: number | null;
} 

/**
 * Convert the completed upload into a playable library item.
 * - container/codec probing decides remux vs transcode
 * - playable MP4 (H.264/AAC/faststart) is streamed into MediaStorage
 * - poster is generated (best effort)
 * - original is retained only when MEDIA_RETAIN_ORIGINAL=1
 * - chunks + session row are removed on success; kept on failure for retry
 *
 * Fails fast when FFmpeg is unavailable (the media stays 'failed' with a
 * logged reason — never a half-ready item).
 */
export async function convertLibraryMedia(mediaId: string, sessionId: string): Promise<LibraryConversionResult> {
  const media = getAdminMedia(mediaId);
  if (!media) throw new Error('Media not found.');
  if (media.status !== 'uploaded' && media.status !== 'processing') {
    throw new Error(`Cannot convert media in status ${media.status}.`);
  }

  if (!isFfmpegAvailable() || !isFfprobeAvailable()) {
    transitionMediaStatus(mediaId, 'failed');
    throw new Error('FFmpeg is not available — conversion cannot run.');
  }

  transitionMediaStatus(mediaId, 'processing');

  const storage = getMediaStorage();
  let sourceAbs: string | null = null;
  let playableAbs: string | null = null;
  let posterAbs: string | null = null;
  let playableKey = '';
  let posterKey = '';

  try {
    // 1. Assemble the seekable source from chunk objects.
    sourceAbs = await assembleSource(mediaId, sessionId);
    const sourceSize = fs.statSync(sourceAbs).size;
    if (sourceSize === 0) throw new Error('The assembled source file is empty.');

    // 2. Validate the container and probe codecs.
    const probe = await probeFile(sourceAbs);
    if (!probe) throw new Error('The uploaded file is not a valid video container.');

    // 3. Remux or transcode to a playable MP4.
    const remux = isRemuxable(probe);
    playableAbs = tempPath(mediaId, '.playable.mp4');
    const args: string[] = ['ffmpeg', '-y', '-loglevel', 'error', '-i', sourceAbs];
    if (remux) {
      args.push('-c', 'copy');
    } else {
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k');
    }
    args.push('-movflags', '+faststart', '-max_muxing_queue_size', '1024', playableAbs);

    const convert = await runFfmpegCommand(args, convertTimeoutMs());
    if (convert.code !== 0 || !fs.existsSync(playableAbs) || fs.statSync(playableAbs).size === 0) {
      throw new Error(`FFmpeg conversion failed with code ${convert.code}${remux ? ' (remux)' : ' (transcode)'}.`);
    }
    if (convert.stderr) {
      console.error(`[media-pipeline] ffmpeg warnings for ${mediaId}: ${convert.stderr.split('\n').slice(0, 5).join(' | ')}`);
    }

    const playableSize = fs.statSync(playableAbs).size;
    playableKey = `playable-${mediaId}.mp4`;

    // 4. Poster (best effort).
    posterAbs = await generatePoster(playableAbs, mediaId);
    posterKey = posterAbs ? `poster-${mediaId}.jpg` : '';

    // 5. Publish playable (+ poster + optional original) into MediaStorage.
    await storage.write(playableKey, createReadStream(playableAbs));
    if (posterKey) {
      await storage.write(posterKey, createReadStream(posterAbs!)).catch(async () => {
        await storage.delete(posterKey).catch(() => {});
        posterKey = '';
      });
    }

    let originalKey: string | null = null;
    if (MEDIA_RETAIN_ORIGINAL) {
      const ext = safeExtensionFromFilename(media.originalFilename ?? null) ?? 'mp4';
      originalKey = `original-${mediaId}.${ext}`;
      await storage.write(originalKey, createReadStream(sourceAbs));
    }

    // 6. Record the outcome and mark the item ready.
    applyConversionResult(mediaId, {
      playableKey,
      storageKey: originalKey,
      posterKey: posterKey || null,
      sizeBytes: playableSize,
      mimeType: 'video/mp4',
      durationSeconds: probe.durationSeconds,
    });

    // 7. The upload session has served its purpose — remove its chunks and
    // row. The completed row only exists to let a FAILED conversion retry;
    // after success it would otherwise linger until the next upload start.
    const session = getUploadSession(sessionId);
    if (session) {
      await removeChunksForUpload(sessionId);
      db.prepare('DELETE FROM mediaUploadSessions WHERE id = ?').run(sessionId);
    }

    return { ok: true, playableKey, sizeBytes: playableSize, durationSeconds: probe.durationSeconds };
  } catch (err) {
    // Failure: mark the media failed (only when the pipeline actually owned
    // the lifecycle — a redundant complete on a ready/failed item is a no-op),
    // remove partial outputs, and KEEP the completed session + chunks so the
    // admin can retry conversion.
    try {
      if (playableKey) await storage.delete(playableKey).catch(() => {});
    } catch {
      // ignore
    }
    const current = getAdminMedia(mediaId);
    if (current && (current.status === 'uploaded' || current.status === 'processing')) {
      transitionMediaStatus(mediaId, 'failed');
    }
    console.error(`[media-pipeline] conversion failed for ${mediaId}: ${(err as Error)?.message ?? 'unknown error'}`);
    throw err;
  } finally {
    // Temporary FFmpeg outputs never survive the run.
    for (const tmp of [sourceAbs, playableAbs, posterAbs]) {
      if (tmp) fs.rmSync(tmp, { force: true });
    }
  }
}

/** Remove leftover temp files from interrupted conversions (grace period). */
export function sweepConversionTemps(maxAgeMs: number): number {
  const dir = conversionTempDir();
  let removed = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  const cutoff = Date.now() - maxAgeMs;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = path.join(dir, entry.name);
    try {
      const stat = fs.statSync(full);
      if (stat.mtimeMs < cutoff) {
        fs.rmSync(full, { force: true });
        removed++;
      }
    } catch {
      // ignore
    }
  }
  return removed;
}