// server/media/config.ts
// Phase C: media pipeline configuration.
//
// Production knobs (all optional — local development works out of the box):
//   MAX_ADMIN_MEDIA_BYTES      hard cap per library file (default 10 GiB)
//   MEDIA_UPLOAD_CHUNK_BYTES   client chunk size hint (default 8 MiB)
//   MEDIA_CONVERT_TIMEOUT_MS   FFmpeg conversion hard timeout (default 30 min)
//   MEDIA_RETAIN_ORIGINAL      keep the uploaded original after conversion
//   ORPHAN_MEDIA_RETENTION_MS  grace period before unreferenced media files
//                              are swept (default 1 hour)
//
// The cap is a SAFE UPPER BOUND on purpose — a true "unlimited upload" is
// never allowed. Storage location lives in server/storage/mediaStorage.ts
// (MEDIA_STORAGE_DIR, default uploads/library); FFmpeg binary locations live
// in server/uploads/transcode.ts (FFMPEG_PATH / FFPROBE_PATH).

const GIB = 1024 * 1024 * 1024;
const MIB = 1024 * 1024;

function positiveEnv(raw: string | undefined, fallback: number): number {
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Maximum accepted file size for a single library upload (default 10 GiB). */
export const MAX_ADMIN_MEDIA_BYTES: number = (() => {
  const legacy = process.env.MEDIA_MAX_SIZE_BYTES; // Phase B env — kept as alias
  return positiveEnv(process.env.MAX_ADMIN_MEDIA_BYTES ?? legacy, 10 * GIB);
})();

/** Default chunk size used when a client does not request one (8 MiB). */
export const MEDIA_UPLOAD_CHUNK_BYTES: number = positiveEnv(
  process.env.MEDIA_UPLOAD_CHUNK_BYTES,
  8 * MIB
);

/** Client-requested chunk sizes are clamped to [256 KiB, 64 MiB]. */
export const MEDIA_CHUNK_MIN_BYTES = 256 * 1024;
export const MEDIA_CHUNK_MAX_BYTES = 64 * MIB;

/** Hard timeout for a single FFmpeg conversion (default 30 minutes). */
export const MEDIA_CONVERT_TIMEOUT_MS: number = positiveEnv(
  process.env.MEDIA_CONVERT_TIMEOUT_MS,
  30 * 60 * 1000
);

/** Retain the uploaded original file after a successful conversion? */
export const MEDIA_RETAIN_ORIGINAL: boolean = process.env.MEDIA_RETAIN_ORIGINAL === '1' ||
  process.env.MEDIA_RETAIN_ORIGINAL === 'true';

/** Upload sessions expire after this long without progress (default 24 h). */
export const MEDIA_SESSION_TTL_MS: number = positiveEnv(
  process.env.MEDIA_SESSION_TTL_MS,
      24 * 60 * 60 * 1000
);

/** Grace period for orphaned media files (default 1 hour). */
export const ORPHAN_MEDIA_RETENTION_MS: number = positiveEnv(
  process.env.ORPHAN_MEDIA_RETENTION_MS,
      60 * 60 * 1000
);