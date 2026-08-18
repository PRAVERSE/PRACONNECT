// server/media/uploads.ts
// Phase C: resumable chunked upload sessions for the admin media library.
//
// Flow: start → PUT chunk i (raw bytes) → ... → complete → FFmpeg pipeline
// (server/media/pipeline.ts) → ready. Chunk bytes live in MediaStorage under
// keys `chunk-<uploadId>-<index>` — the DB row only tracks progress, so a
// client can resume after a disconnect by asking which indexes are missing.
//
// Safety: chunks are validated (index bounds, byte counts) server-side; the
// total is capped by MAX_ADMIN_MEDIA_BYTES; every stored byte passes through
// the same streaming pipeline — never Buffer.from(fullRequest).
//
// Lifecycle: a session is 'active' while uploading, 'completed' once every
// chunk exists (chunks are KEPT so a failed conversion can retry), then the
// row and its chunks are removed after a successful conversion. Expired
// sessions (active or completed) are swept by the cleanup worker.

import { db } from '../db/index';
import { Readable, Transform } from 'node:stream';
import { getMediaStorage } from '../storage/mediaStorage';
import { generateId } from '../auth/auth';
import {
  MAX_ADMIN_MEDIA_BYTES,
  MEDIA_UPLOAD_CHUNK_BYTES,
  MEDIA_CHUNK_MIN_BYTES,
  MEDIA_CHUNK_MAX_BYTES,
  MEDIA_SESSION_TTL_MS,
} from './config';
import { getAdminMedia, transitionMediaStatus, MEDIA_TRANSITIONS } from './service';
import type { MediaStatus } from './service';

export type UploadSessionStatus = 'active' | 'completed';

export interface UploadSession {
  id: string;
  mediaId: string;
  totalBytes: number;
  chunkSize: number;
  chunkCount: number;
  receivedBytes: number;
  receivedChunks: number;
  status: UploadSessionStatus;
  previousStatus: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface UploadSessionDetail extends UploadSession {
  missingChunks: number[];
}

export function chunkKey(uploadId: string, index: number): string {
  return `chunk-${uploadId}-${String(index).padStart(6, '0')}`;
}

export function chunkPrefix(uploadId: string): string {
  return `chunk-${uploadId}-`;
}

function rowToSession(row: Record<string, unknown>): UploadSession {
  return {
    id: row.id as string,
    mediaId: row.mediaId as string,
    totalBytes: row.totalBytes as number,
    chunkSize: row.chunkSize as number,
    chunkCount: row.chunkCount as number,
    receivedBytes: row.receivedBytes as number,
    receivedChunks: row.receivedChunks as number,
    status: (row.status as UploadSessionStatus) ?? 'active',
    previousStatus: (row.previousStatus as string | null) ?? null,
    expiresAt: row.expiresAt as string,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

export function getUploadSession(uploadId: string): UploadSession | null {
  const row = db
    .prepare('SELECT * FROM mediaUploadSessions WHERE id = ?')
    .get(uploadId) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : null;
}

export function getActiveSessionForMedia(mediaId: string): UploadSession | null {
  const row = db
    .prepare(`SELECT * FROM mediaUploadSessions WHERE mediaId = ? AND status = 'active' ORDER BY createdAt DESC LIMIT 1`)
    .get(mediaId) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : null;
}

export function getCompletedSessionForMedia(mediaId: string): UploadSession | null {
  const row = db
    .prepare(`SELECT * FROM mediaUploadSessions WHERE mediaId = ? AND status = 'completed' ORDER BY createdAt DESC LIMIT 1`)
    .get(mediaId) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : null;
}

export interface StartSessionInput {
  totalBytes: number;
  chunkSize?: number;
}

export type StartSessionResult =
  | { ok: true; session: UploadSessionDetail; created: boolean }
  | { ok: false; error: string; code: 'NOT_FOUND' | 'VALIDATION_ERROR' | 'MEDIA_TOO_LARGE' | 'MEDIA_BUSY' };

/** Begin (or resume) the chunked upload for a media item. */
export async function startUploadSession(mediaId: string, input: StartSessionInput): Promise<StartSessionResult> {
  const media = getAdminMedia(mediaId);
  if (!media) return { ok: false, error: 'Media not found.', code: 'NOT_FOUND' };

  const totalBytes = Math.floor(input.totalBytes);
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
    return { ok: false, error: 'totalBytes must be a positive integer.', code: 'VALIDATION_ERROR' };
  }
  if (totalBytes > MAX_ADMIN_MEDIA_BYTES) {
    return {
      ok: false,
      error: `Files larger than ${MAX_ADMIN_MEDIA_BYTES} bytes are not allowed.`,
      code: 'MEDIA_TOO_LARGE',
    };
  }

  const requestedChunkSize = input.chunkSize === undefined ? MEDIA_UPLOAD_CHUNK_BYTES : Math.floor(input.chunkSize);
  if (!Number.isFinite(requestedChunkSize) || requestedChunkSize <= 0) {
    return { ok: false, error: 'chunkSize must be a positive integer.', code: 'VALIDATION_ERROR' };
  }
  const chunkSize = Math.min(MEDIA_CHUNK_MAX_BYTES, Math.max(MEDIA_CHUNK_MIN_BYTES, requestedChunkSize));
  const chunkCount = Math.ceil(totalBytes / chunkSize);

  // Resume: an existing active session for the same item is returned as-is
  // (the client learns its progress and missing chunks from it).
  const active = getActiveSessionForMedia(mediaId);
  if (active) {
    const missing = await missingChunks(active);
    return { ok: true, session: { ...active, missingChunks: missing }, created: false };
  }

  // A conversion may be pending or running off this item's chunks ('uploaded'
  // is the window between complete and the pipeline's first status write).
  // Never destroy those chunks — refuse the new upload instead.
  const completed = getCompletedSessionForMedia(mediaId);
  if (completed && (media.status === 'processing' || media.status === 'uploaded')) {
    return { ok: false, error: 'This media is currently being processed.', code: 'MEDIA_BUSY' };
  }

  // Clean any stale completed sessions (conversion ended: ready or failed)
  // whose chunks survived a conversion failure or an interrupted finalize.
  if (completed) {
    await removeChunksForUpload(completed.id);
    db.prepare('DELETE FROM mediaUploadSessions WHERE id = ?').run(completed.id);
  }

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + MEDIA_SESSION_TTL_MS).toISOString();
  const session: UploadSession = {
    id: generateId(),
    mediaId,
    totalBytes,
    chunkSize,
    chunkCount,
    receivedBytes: 0,
    receivedChunks: 0,
    status: 'active',
    previousStatus: media.status,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(
    `INSERT INTO mediaUploadSessions (id, mediaId, totalBytes, chunkSize, chunkCount, receivedBytes, receivedChunks, status, previousStatus, expiresAt, createdAt, updatedAt)
     VALUES (@id, @mediaId, @totalBytes, @chunkSize, @chunkCount, @receivedBytes, @receivedChunks, @status, @previousStatus, @expiresAt, @createdAt, @updatedAt)`
  ).run(session as unknown as Record<string, unknown>);

  // The media moves to 'uploading' while bytes flow.
  transitionMediaStatus(mediaId, 'uploading');

  // A fresh session has EVERY chunk missing. Report the full index list —
  // an empty missingChunks array must always mean "nothing is missing",
  // never "nothing was uploaded yet", or clients would skip the whole loop.
  const allMissing: number[] = [];
  for (let i = 0; i < chunkCount; i++) allMissing.push(i);

  return { ok: true, session: { ...session, missingChunks: allMissing }, created: true };
}

/** Missing chunk indexes, resolved against what actually exists in storage. */
export async function missingChunks(session: UploadSession): Promise<number[]> {
  const storage = getMediaStorage();
  const keys = await storage.listKeys(chunkPrefix(session.id));
  const present = new Set<number>();
  for (const key of keys) {
    const idx = Number.parseInt(key.slice(chunkPrefix(session.id).length), 10);
    if (Number.isInteger(idx)) present.add(idx);
  }
  const missing: number[] = [];
  for (let i = 0; i < session.chunkCount; i++) {
    if (!present.has(i)) missing.push(i);
  }
  return missing;
}

export interface StoreChunkInput {
  uploadId: string;
  mediaId: string;
  index: number;
  stream: Readable;
  /** Optional Content-Length declared by the request. When present it is used
   *  as an up-front guard AND the measured byte count must match it exactly.
   *  The authoritative count always comes from actually streaming the body. */
  byteCount?: number;
}

export type StoreChunkResult =
  | { ok: true; session: UploadSession }
  | { ok: false; error: string; code: 'NOT_FOUND' | 'VALIDATION_ERROR' | 'MEDIA_CONFLICT' | 'MEDIA_TOO_LARGE' | 'UPLOAD_FAILED' };

/**
 * Persist one chunk (raw request body streamed through — never buffered in
 * full). Idempotent: re-sending the same index replaces the previous bytes.
 */
export async function storeChunk(input: StoreChunkInput): Promise<StoreChunkResult> {
  const session = getUploadSession(input.uploadId);
  if (!session || session.mediaId !== input.mediaId) {
    return { ok: false, error: 'Upload session not found.', code: 'NOT_FOUND' };
  }
  if (session.status !== 'active') {
    return { ok: false, error: 'This upload session is not active.', code: 'MEDIA_CONFLICT' };
  }
  if (session.expiresAt < new Date().toISOString()) {
    return { ok: false, error: 'This upload session has expired.', code: 'MEDIA_CONFLICT' };
  }

  const index = Math.floor(input.index);
  if (!Number.isInteger(index) || index < 0 || index >= session.chunkCount) {
    return { ok: false, error: 'Chunk index is out of range.', code: 'VALIDATION_ERROR' };
  }

  // The final chunk may be short; every other chunk must be exactly chunkSize.
  const isLast = index === session.chunkCount - 1;
  const expectedBytes = isLast
    ? session.totalBytes - (session.chunkCount - 1) * session.chunkSize
    : session.chunkSize;
  if (expectedBytes <= 0 || expectedBytes > session.chunkSize) {
    return { ok: false, error: 'Chunk byte count does not match the session.', code: 'VALIDATION_ERROR' };
  }

  // Up-front guard against a declared size that violates the session contract
  // (reject before any body byte is streamed).
  if (input.byteCount !== undefined && input.byteCount !== expectedBytes) {
    return { ok: false, error: 'Chunk byte count does not match the session.', code: 'VALIDATION_ERROR' };
  }

  const storage = getMediaStorage();
  const key = chunkKey(session.id, index);
  const existingSize = (await storage.stat(key))?.size ?? 0;

  // Measure the ACTUAL streamed byte count while writing. The Content-Length
  // header is never trusted on its own — a browser fetch sets it correctly,
  // but a direct client may not, so the stream itself is the truth.
  let measured = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      measured += chunk.length;
      if (measured > expectedBytes) {
        cb(new Error('CHUNK_SIZE_MISMATCH'));
        return;
      }
      cb(null, chunk);
    },
  });

  try {
    await storage.write(key, input.stream.pipe(counter));
  } catch {
    await storage.delete(key).catch(() => {});
    return { ok: false, error: 'The chunk could not be stored.', code: 'UPLOAD_FAILED' };
  }

  if (measured !== expectedBytes) {
    await storage.delete(key).catch(() => {});
    return { ok: false, error: 'Chunk byte count does not match the session.', code: 'VALIDATION_ERROR' };
  }

  const storedSize = (await storage.stat(key))?.size ?? 0;
  if (storedSize !== measured) {
    await storage.delete(key).catch(() => {});
    return { ok: false, error: 'Stored chunk size does not match the request.', code: 'UPLOAD_FAILED' };
  }

  if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
    console.log(
      '[MEDIA UPLOAD SERVER] chunk received',
      JSON.stringify({ uploadId: session.id, index, bytes: measured })
    );
  }

  // The DB counters track progress only — the chunk objects are the truth.
  const delta = storedSize - existingSize;
  const receivedChunks = existingSize > 0 ? session.receivedChunks : session.receivedChunks + 1;
  const receivedBytes = Math.min(session.totalBytes, session.receivedBytes + delta);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + MEDIA_SESSION_TTL_MS).toISOString();
  db.prepare(
    `UPDATE mediaUploadSessions SET receivedBytes = ?, receivedChunks = ?, expiresAt = ?, updatedAt = ? WHERE id = ?`
  ).run(receivedBytes, receivedChunks, expiresAt, now, session.id);

  const updated = getUploadSession(session.id);
  return { ok: true, session: updated! };
}

export type CompleteSessionResult =
  | { ok: true; session: UploadSession; mediaId: string }
  | { ok: false; error: string; code: 'NOT_FOUND' | 'MEDIA_CONFLICT' | 'UPLOAD_FAILED' };

/**
 * Verify every chunk exists and mark the session completed (chunks stay in
 * storage so a failed conversion can be retried by calling complete again).
 * The media moves to 'uploaded' — the FFmpeg pipeline (pipeline.ts) is
 * launched by the caller.
 */
export async function completeUploadSession(uploadId: string, mediaId: string): Promise<CompleteSessionResult> {
  const session = getUploadSession(uploadId);
  if (!session || session.mediaId !== mediaId) {
    return { ok: false, error: 'Upload session not found.', code: 'NOT_FOUND' };
  }
  if (session.status !== 'active') {
    // Completed sessions can retry the conversion; other states are rejected.
    if (session.status === 'completed') {
      // Retry path: a conversion that failed left the media 'failed' and the
      // chunks retained. Move the media back to 'uploaded' so the pipeline
      // can assemble the source again and rerun.
      const media = getAdminMedia(mediaId);
      if (media && media.status === 'failed') {
        transitionMediaStatus(mediaId, 'uploaded');
      }
      return { ok: true, session, mediaId };
    }
    return { ok: false, error: 'This upload session is not active.', code: 'MEDIA_CONFLICT' };
  }

  const missing = await missingChunks(session);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing chunk(s): ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ' …' : ''}.`,
      code: 'MEDIA_CONFLICT',
    };
  }

  // Every index exists — now verify the stored bytes add up to the session
  // total. Chunk sizes were validated when stored, but a corrupted object or
  // a legacy session must never reach the converter.
  const storage = getMediaStorage();
  let storedTotal = 0;
  for (let i = 0; i < session.chunkCount; i++) {
    const size = (await storage.stat(chunkKey(session.id, i)))?.size ?? 0;
    if (size <= 0) {
      return { ok: false, error: `Missing chunk(s): ${i}.`, code: 'MEDIA_CONFLICT' };
    }
    storedTotal += size;
  }
  if (storedTotal !== session.totalBytes) {
    return {
      ok: false,
      error: 'The uploaded bytes do not match the session total.',
      code: 'MEDIA_CONFLICT',
    };
  }

  if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
    console.log(
      '[MEDIA UPLOAD SERVER] complete',
      JSON.stringify({
        uploadId: session.id,
        receivedChunks: session.chunkCount,
        expectedChunks: session.chunkCount,
        missingChunks: 0,
      })
    );
  }

  const now = new Date().toISOString();
  db.prepare(`UPDATE mediaUploadSessions SET status = 'completed', updatedAt = ? WHERE id = ?`).run(now, session.id);
  transitionMediaStatus(mediaId, 'uploaded');
  return { ok: true, session: { ...session, status: 'completed', updatedAt: now }, mediaId };
}

/** Abort an upload: delete every chunk plus the session row, restore the
 *  media to its previous status (draft/ready/failed). */
export async function cancelUploadSession(uploadId: string, mediaId: string): Promise<boolean> {
  const session = getUploadSession(uploadId);
  if (!session || session.mediaId !== mediaId) return false;
  const previous = session.previousStatus;
  await removeChunksForUpload(session.id);
  db.prepare('DELETE FROM mediaUploadSessions WHERE id = ?').run(session.id);
  // Cancelling an in-flight upload owns the lifecycle — restore the status the
  // item had before the session started, even though the guarded transition
  // table does not include those edges (e.g. uploading → draft).
  if (previous && previous !== 'uploading' && previous !== 'uploaded' && previous !== 'processing') {
    const allowed = MEDIA_TRANSITIONS['uploading'] as readonly string[];
    if (allowed.includes(previous)) {
      transitionMediaStatus(mediaId, previous as MediaStatus);
    } else {
      db.prepare('UPDATE media SET status = ?, updatedAt = ? WHERE id = ?').run(previous, new Date().toISOString(), mediaId);
    }
  } else if (mediaStillUploading(mediaId)) {
    transitionMediaStatus(mediaId, 'failed');
  }
  return true;
}

function mediaStillUploading(mediaId: string): boolean {
  const row = db.prepare('SELECT status FROM media WHERE id = ?').get(mediaId) as { status: string } | undefined;
  return row?.status === 'uploading';
}

/** Delete the chunk objects for one upload (the session row is kept). */
export async function removeChunksForUpload(uploadId: string): Promise<void> {
  const storage = getMediaStorage();
  for (const key of await storage.listKeys(chunkPrefix(uploadId))) {
    await storage.delete(key).catch(() => {});
  }
}

/** Delete chunk objects for every session row of a media item. */
export async function removeChunksForMedia(mediaId: string): Promise<void> {
  const rows = db
    .prepare('SELECT id FROM mediaUploadSessions WHERE mediaId = ?')
    .all(mediaId) as { id: string }[];
  for (const row of rows) {
    await removeChunksForUpload(row.id);
  }
}

/** Sweep sessions past their expiry: delete their chunks and rows, and mark
 *  the media item failed (it has no playable output). Active uploads are
 *  never touched — only rows past expiresAt. */
export async function expireUploadSessions(now: Date = new Date()): Promise<number> {
  const rows = db
    .prepare(`SELECT * FROM mediaUploadSessions WHERE expiresAt < ?`)
    .all(now.toISOString()) as Record<string, unknown>[];
  let removed = 0;
  for (const row of rows) {
    const session = rowToSession(row);
    await removeChunksForUpload(session.id);
    db.prepare('DELETE FROM mediaUploadSessions WHERE id = ?').run(session.id);
    const media = getAdminMedia(session.mediaId);
    // An 'uploading' or 'uploaded' item lost its chunks with the session —
    // it can never become playable, so mark it failed.
    if (media && (media.status === 'uploading' || media.status === 'uploaded')) {
      transitionMediaStatus(session.mediaId, 'failed');
    }
    removed++;
  }
  return removed;
}