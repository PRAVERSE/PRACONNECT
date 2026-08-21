// server/uploads/lifecycle.ts
// Phase 6.8: filesystem lifecycle for uploaded media.
//  - Room deletion removes the media files owned by that room (DB records
//    already cascade via ON DELETE CASCADE).
//  - A periodic orphan sweep removes generated media files that have no
//    uploads-table record and are older than a configurable grace period.
// All path handling is confined to uploadsDir: filenames are validated
// against the exact server-generated naming scheme and basename-constrained,
// so unrelated files can never be touched. Missing files and Windows file
// locks are tolerated (locked files are retried by the next sweep).

import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/index';
import { uploadsDir } from './config';

/** Exact server-generated media filename scheme: media-<ts>-<uuid12>.<ext>. */
export const MEDIA_FILENAME_PATTERN = /^media-\d+-[0-9a-f]{8}-[0-9a-f]{3,4}\.(mp4|webm|mov|mkv)$/i;

/** Grace period before an orphaned file is deleted (default: 1 hour). */
export const ORPHAN_UPLOAD_RETENTION_MS = Math.max(
  0,
  parseInt(process.env.ORPHAN_UPLOAD_RETENTION_MS ?? '3600000', 10) || 3600000
);

/** Absolute path inside uploadsDir for a generated filename, or null when the
 *  name is not one of ours (never resolves or touches other files). */
function safeUploadPath(filename: string): string | null {
  const base = path.basename(filename);
  if (base !== filename) return null; // any path component is rejected
  if (!MEDIA_FILENAME_PATTERN.test(base)) return null;
  const target = path.resolve(uploadsDir, base);
  if (path.dirname(target) !== path.resolve(uploadsDir)) return null;
  return target;
}

/** Delete the given upload files, tolerating missing files and Windows locks. */
export function deleteUploadFiles(filenames: string[]): number {
  let deleted = 0;
  for (const name of filenames) {
    const target = safeUploadPath(name);
    if (!target) continue;
    try {
      fs.rmSync(target, { force: true });
      deleted += 1;
    } catch {
      // Locked (Windows) or already gone — the orphan sweep retries later.
    }
  }
  return deleted;
}

/** Delete every media file owned by a room (used after room deletion). */
export function deleteRoomUploadFiles(roomId: string): number {
  const names = (
    db.prepare('SELECT filename FROM uploads WHERE roomId = ?').all(roomId) as { filename: string }[]
  ).map((r) => r.filename);
  return deleteUploadFiles(names);
}

/**
 * Delete generated media files in uploadsDir that have no uploads-table record
 * and are older than the grace period. Tolerates a missing directory and files
 * disappearing mid-sweep. Never touches unrelated files.
 */
export function sweepOrphanUploads(now = Date.now()): number {
  if (!fs.existsSync(uploadsDir)) return 0;

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(uploadsDir);
  } catch {
    return 0;
  }
  if (entries.length === 0) return 0;

  const known = new Set<string>(
    (db.prepare('SELECT filename FROM uploads').all() as { filename: string }[]).map((r) => r.filename)
  );
  const cutoff = now - ORPHAN_UPLOAD_RETENTION_MS;
  let deleted = 0;

  for (const name of entries) {
    const isMedia = MEDIA_FILENAME_PATTERN.test(name);
    const isPart = name.endsWith('.part') && MEDIA_FILENAME_PATTERN.test(name.slice(0, -'.part'.length));
    if (!isMedia && !isPart) continue;
    if (isMedia && known.has(name)) continue;

    const target = path.resolve(uploadsDir, name);
    if (path.dirname(target) !== path.resolve(uploadsDir)) continue;
    try {
      const st = fs.statSync(target);
      if (!st.isFile()) continue;
      if (st.mtimeMs > cutoff) continue; // still within the grace period
    } catch {
      continue; // file disappeared during the sweep
    }
    try {
      fs.rmSync(target, { force: true });
      deleted += 1;
    } catch {
      // Locked (Windows) — try again next sweep.
    }
  }
  return deleted;
}
