// server/uploads/transcode.ts
// MKV / browser-incompatible movie conversion pipeline (Phase 6.9).
//
// Browsers cannot reliably play Matroska (.mkv) containers, so MKV uploads are
// never assigned directly to <video src>. The source is stored after the
// server has verified the EBML/Matroska signature, then transcoded to a
// browser-compatible MP4 (H.264 video + AAC audio, progressive fast-start)
// with FFmpeg. The room only receives the playable MP4 URL once conversion has
// completed successfully.
//
// Safety rules enforced here:
//   - FFmpeg is executed ONLY on the server via execFile (argument array,
//     never a shell string, never shell=true).
//   - User-controlled strings never appear in command arguments — only
//     server-generated filenames inside uploadsDir.
//   - A hard timeout bounds every conversion; process errors are logged as a
//     safe summary and never exposed to end users.
//   - Temporary/partial output files are removed on success and failure.
//
// FFmpeg is an OPTIONAL system dependency. When it (or FFprobe) is not
// installed, MKV uploads are rejected up front with a clear message — the
// room is never left referencing an unplayable file.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { uploadsDir } from './config';
import { db } from '../db/index';

export type ConversionStatus = 'uploaded' | 'processing' | 'ready' | 'failed';

export interface FfmpegRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Injectable command executor (tests swap in a fake; production uses the real
 * FFmpeg binary via execFile). The command is passed as a full argv array —
 * argv[0] is 'ffmpeg' or 'ffprobe'. Never concatenated into a shell string.
 */
export type FfmpegExecutor = (args: string[], timeoutMs: number) => Promise<FfmpegRunResult>;

let testExecutor: FfmpegExecutor | null = null;
let forcedAvailability: boolean | null = null;

/** Tests: inject a fake FFmpeg/FFprobe runner (implies availability). */
export function setFfmpegExecutorForTesting(fn: FfmpegExecutor | null): void {
  testExecutor = fn;
}

/** Tests: force availability on/off regardless of the host binary (null = auto). */
export function setFfmpegAvailabilityForTesting(available: boolean | null): void {
  forcedAvailability = available;
}

const DEFAULT_CONVERT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const PROBE_TIMEOUT_MS = 15_000;

function convertTimeoutMs(): number {
  const raw = process.env.MEDIA_CONVERT_TIMEOUT_MS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CONVERT_TIMEOUT_MS;
}

function findBinary(name: 'ffmpeg' | 'ffprobe'): string | null {
  const override = process.env[name === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH'];
  if (override) return fs.existsSync(override) ? override : null;
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, exe);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function isFfmpegAvailable(): boolean {
  if (testExecutor) return true;
  if (forcedAvailability !== null) return forcedAvailability;
  return findBinary('ffmpeg') !== null;
}

export function isFfprobeAvailable(): boolean {
  if (testExecutor) return true;
  if (forcedAvailability !== null) return forcedAvailability;
  return findBinary('ffprobe') !== null;
}

const MAX_CONCURRENT_FFMPEG = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_FFMPEG_JOBS ?? '2', 10) || 2
);

let activeFfmpegJobs = 0;
const ffmpegQueue: (() => void)[] = [];

async function acquireFfmpegSlot(): Promise<void> {
  if (activeFfmpegJobs < MAX_CONCURRENT_FFMPEG) {
    activeFfmpegJobs++;
    return;
  }
  return new Promise<void>((resolve) => {
    ffmpegQueue.push(() => {
      activeFfmpegJobs++;
      resolve();
    });
  });
}

function releaseFfmpegSlot(): void {
  activeFfmpegJobs--;
  const next = ffmpegQueue.shift();
  if (next) {
    next();
  }
}

async function runCommand(args: string[], timeoutMs: number): Promise<FfmpegRunResult> {
  if (testExecutor) return testExecutor(args, timeoutMs);
  const isHeavyJob = args[0] === 'ffmpeg';
  if (isHeavyJob) await acquireFfmpegSlot();
  try {
    const exe =
      args[0] === 'ffmpeg' || args[0] === 'ffprobe'
        ? (findBinary(args[0]) ?? args[0])
        : args[0];
    return await new Promise<FfmpegRunResult>((resolve) => {
      execFile(
        exe,
        args.slice(1),
        { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          let code = 0;
          if (error) {
            const errCode = (error as NodeJS.ErrnoException & { code?: unknown }).code;
            code = typeof errCode === 'number' ? errCode : 1;
          }
          resolve({
            code,
            stdout: String(stdout),
            stderr: String(stderr),
          });
        }
      );
    });
  } finally {
    if (isHeavyJob) releaseFfmpegSlot();
  }
}

/**
 * Shared safe FFmpeg/FFprobe runner for other pipelines (e.g. the admin media
 * library in server/media/pipeline.ts). argv is passed verbatim — never a
 * shell string — and honors the injected test executor.
 */
export function runFfmpegCommand(args: string[], timeoutMs: number): Promise<FfmpegRunResult> {
  return runCommand(args, timeoutMs);
}

/**
 * Probe the codecs of an uploaded file with FFprobe. Returns 'compatible'
 * when the browser can likely play it directly (H.264 video + a supported
 * audio codec), 'convert' when it should be transcoded, or 'unknown' when the
 * probe cannot determine compatibility (callers fall back to direct play —
 * the historical behavior).
 */
export async function probeBrowserCompatibility(sourceName: string): Promise<'compatible' | 'convert' | 'unknown'> {
  if (!isFfprobeAvailable()) return 'unknown';
  const src = path.join(uploadsDir, sourceName);

  const video = await runCommand(
    ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'default=nw=1:nk=1', src],
    PROBE_TIMEOUT_MS
  );
  const audio = await runCommand(
    ['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'default=nw=1:nk=1', src],
    PROBE_TIMEOUT_MS
  );

  if (video.code !== 0 || audio.code !== 0) return 'unknown';
  const v = video.stdout.trim().toLowerCase();
  const a = audio.stdout.trim().toLowerCase();
  if (!v) return 'unknown'; // no video stream — not a watchable movie

  const videoOk = v === 'h264';
  const audioOk = a === '' || a === 'aac' || a === 'mp3' || a === 'opus' || a === 'vorbis' || a === 'flac';
  return videoOk && audioOk ? 'compatible' : 'convert';
}

export interface ReadyMedia {
  title: string;
  url: string;
  poster?: string;
  type: string;
}

export interface ConvertOptions {
  sourceName: string;
  roomId: string;
  userId: string;
  title: string;
  poster?: string;
  /** Called with the playable media ONLY after the MP4 exists on disk. */
  onReady: (media: ReadyMedia) => void;
  /** Called when conversion failed; the room is never given an unplayable URL. */
  onFailed: () => void;
}

/**
 * Transcode the stored source file into a browser-compatible MP4
 * (H.264 + AAC, `-movflags +faststart` for progressive playback), record the
 * playable file in the uploads table, and publish it via onReady. Temporary
 * output is always removed; failures mark the source row 'failed' and never
 * publish anything.
 */
export async function convertToPlayable(opts: ConvertOptions): Promise<void> {
  const sourceAbs = path.join(uploadsDir, opts.sourceName);
  const playableName = `media-${Date.now()}-${crypto.randomUUID().slice(0, 12)}.mp4`;
  const outputAbs = path.join(uploadsDir, playableName);

  const markStatus = (status: ConversionStatus, playable?: string): void => {
    try {
      db.prepare(
        `UPDATE uploads SET conversionStatus = ?, playableFilename = ? WHERE filename = ?`
      ).run(status, playable ?? null, opts.sourceName);
    } catch {
      // DB closed during shutdown — nothing left to record.
    }
  };

  markStatus('processing');

  try {
    const result = await runCommand(
      [
        'ffmpeg',
        '-y',
        '-loglevel',
        'error',
        '-i',
        sourceAbs,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        '-max_muxing_queue_size',
        '1024',
        outputAbs,
      ],
      convertTimeoutMs()
    );

    if (result.code !== 0 || !fs.existsSync(outputAbs) || fs.statSync(outputAbs).size === 0) {
      throw new Error(`ffmpeg exited with code ${result.code} (stderr logged separately)`);
    }
    if (result.stderr) {
      // Safe summarized log — FFmpeg stderr is never exposed to end users.
      console.error(
        `[transcode] ffmpeg warnings for ${opts.sourceName}: ${result.stderr.split('\n').slice(0, 5).join(' | ')}`
      );
    }

    const playableSize = fs.statSync(outputAbs).size;
    const now = new Date().toISOString();

    const publish = db.transaction(() => {
      db.prepare(
        `INSERT INTO uploads (filename, roomId, userId, size, mimeType, createdAt, sourceFilename, playableFilename, conversionStatus)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(playableName, opts.roomId, opts.userId, playableSize, 'video/mp4', now, opts.sourceName, playableName, 'ready');
      markStatus('ready', playableName);
    });
    publish();

    opts.onReady({
      title: opts.title,
      url: `/api/uploads/${playableName}`,
      poster: opts.poster,
      type: 'video',
    });
  } catch (err) {
    // Remove any partial output on failure (and on success paths that died
    // mid-rename); the source file itself is kept but marked failed.
    try {
      fs.rmSync(outputAbs, { force: true });
    } catch {
      // already gone or locked — orphan sweep retries later
    }
    console.error(`[transcode] conversion failed for ${opts.sourceName}: ${(err as Error)?.message ?? 'unknown error'}`);
    markStatus('failed');
    opts.onFailed();
  }
}