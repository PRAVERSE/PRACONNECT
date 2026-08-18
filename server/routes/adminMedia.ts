// server/routes/adminMedia.ts
// Phase C: Media Library — admin routes. Every route requires an authenticated
// admin session (requireAdmin) — a role supplied by the client is never
// accepted. Normal users always receive 403 ADMIN_REQUIRED.
//
//   GET    /api/admin/media                    → all items (search + pagination)
//   POST   /api/admin/media                    → create metadata (status: draft)
//   GET    /api/admin/media/:id                → any item
//   PATCH  /api/admin/media/:id                → edit metadata
//   DELETE /api/admin/media/:id                → delete row + stored files
//   POST   /api/admin/media/:id/publish        → published = 1
//   POST   /api/admin/media/:id/unpublish      → published = 0
//   POST   /api/admin/media/:id/poster         → replace the poster image
//   POST   /api/admin/media/:id/upload/start   → begin (or resume) a chunked upload
//   GET    /api/admin/media/:id/upload/:uploadId        → session + missing chunks
//   PUT    /api/admin/media/:id/upload/:uploadId/chunks/:index → one chunk
//   POST   /api/admin/media/:id/upload/:uploadId/complete → finalize + convert
//   DELETE /api/admin/media/:id/upload/:uploadId       → cancel the upload
//
// Upload flow (Phase C, resumable): the admin starts a session, then streams
// chunk-sized slices of the raw file body — each PUT carries exactly one
// chunk, never the whole file. The server verifies indexes/byte counts, the
// hard cap (MAX_ADMIN_MEDIA_BYTES) and stores bytes through MediaStorage.
// Missing chunks are answered on resume. On complete, the FFmpeg pipeline
// (server/media/pipeline.ts) validates the container, probes codecs, produces
// a playable MP4 (H.264/AAC/faststart), generates a poster, and marks the
// item ready. Chunks are kept until conversion succeeds so a failed
// conversion can be retried by calling complete again.
//
// NOTE: a media item is only visible to normal users when status='ready' AND
// published=1; publishing a draft/uploading item is harmless.

import { Hono } from 'hono';
import type { Context } from 'hono';
import { Transform, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { requireAdmin } from '../middleware/auth';
import { apiError } from '../auth/auth';
import { db } from '../db/index';
import { getMediaStorage } from '../storage/mediaStorage';
import {
  MediaCreateInput,
  MediaUpdateInput,
  validateMediaMetadata,
  validateVideoMimeType,
  sanitizeOriginalFilename,
  mimeFromExtension,
  getAdminMedia,
  listAdminMedia,
  createMediaRecord,
  updateMediaRecord,
  deleteMediaRecord,
  setMediaPublished,
  toAdminMedia,
} from '../media/service';
import {
  startUploadSession,
  storeChunk,
  completeUploadSession,
  cancelUploadSession,
  getUploadSession,
  missingChunks,
} from '../media/uploads';
import { convertLibraryMedia } from '../media/pipeline';
import { MEDIA_CHUNK_MAX_BYTES } from '../media/config';

export const adminMedia = new Hono();

adminMedia.use('*', requireAdmin);

function validationResponse(c: Context, errors: string[]): Response {
  return c.json(apiError('VALIDATION_ERROR', errors.join(' ')), 400);
}

function decodeURIComponentSafely(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

// ─── GET /api/admin/media — full library (search + pagination) ──────────────

adminMedia.get('/', (c) => {
  const q = c.req.query('q');
  const page = c.req.query('page');
  const pageSize = c.req.query('pageSize');

  const result = listAdminMedia({ q, page, pageSize });
  if (!result) {
    return c.json(apiError('VALIDATION_ERROR', 'page must be ≥ 1 and pageSize must be between 1 and 100.'), 400);
  }

  return c.json({
    items: result.items.map(toAdminMedia),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    hasMore: result.hasMore,
  });
});

// ─── POST /api/admin/media — create metadata (status: draft) ────────────────

adminMedia.post('/', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json(apiError('VALIDATION_ERROR', 'Request body must be valid JSON.'), 400);

  const input: MediaCreateInput = {
    title: typeof body.title === 'string' ? body.title : '',
    description: typeof body.description === 'string' ? body.description : undefined,
    originalFilename: body.originalFilename as string | null | undefined,
    mimeType: body.mimeType as string | null | undefined,
    sizeBytes: body.sizeBytes as number | null | undefined,
    downloadAllowed: body.downloadAllowed as boolean | undefined,
    published: body.published as boolean | undefined,
  };

  const errors = validateMediaMetadata(input, { partial: false });
  if (errors.length > 0) return validationResponse(c, errors);

  const row = createMediaRecord(c.get('userId'), input);
  return c.json({ item: toAdminMedia(row) }, 201);
});

// ─── GET /api/admin/media/:id ───────────────────────────────────────────────

adminMedia.get('/:id', (c) => {
  const row = getAdminMedia(c.req.param('id'));
  if (!row) return c.json(apiError('NOT_FOUND', 'Media not found.'), 404);
  return c.json({ item: toAdminMedia(row) });
});

// ─── PATCH /api/admin/media/:id — edit metadata ─────────────────────────────

adminMedia.patch('/:id', async (c) => {
  const id = c.req.param('id');
  if (!getAdminMedia(id)) return c.json(apiError('NOT_FOUND', 'Media not found.'), 404);

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json(apiError('VALIDATION_ERROR', 'Request body must be valid JSON.'), 400);

  const patch: MediaUpdateInput = {};
  if (body.title !== undefined) patch.title = typeof body.title === 'string' ? body.title : '';
  if (body.description !== undefined) patch.description = typeof body.description === 'string' ? body.description : '';
  if (body.originalFilename !== undefined) patch.originalFilename = body.originalFilename as string | null;
  if (body.mimeType !== undefined) patch.mimeType = body.mimeType as string | null;
  if (body.sizeBytes !== undefined) patch.sizeBytes = body.sizeBytes as number | null;
  if (body.downloadAllowed !== undefined) patch.downloadAllowed = body.downloadAllowed as boolean;
  if (body.published !== undefined) patch.published = body.published as boolean;

  const errors = validateMediaMetadata(patch, { partial: true });
  if (errors.length > 0) return validationResponse(c, errors);

  const row = updateMediaRecord(id, patch);
  if (!row) return c.json(apiError('NOT_FOUND', 'Media not found.'), 404);
  return c.json({ item: toAdminMedia(row) });
});

// ─── DELETE /api/admin/media/:id — row + stored files ───────────────────────

adminMedia.delete('/:id', async (c) => {
  const id = c.req.param('id');
  // Remove any in-flight session chunks BEFORE the row (CASCADE would drop
  // the session rows, orphaning their chunk objects).
  const { removeChunksForMedia } = await import('../media/uploads');
  await removeChunksForMedia(id);

  const deleted = deleteMediaRecord(id);
  if (!deleted) return c.json(apiError('NOT_FOUND', 'Media not found.'), 404);

  const storage = getMediaStorage();
  const keys = [deleted.storageKey, deleted.playableKey, deleted.posterKey].filter((k): k is string => Boolean(k));
  for (const key of keys) {
    await storage.delete(key).catch(() => {});
  }
  return c.json({ ok: true, deletedId: id });
});

// ─── Publish / unpublish ─────────────────────────────────────────────────────

adminMedia.post('/:id/publish', (c) => {
  const row = setMediaPublished(c.req.param('id'), true);
  if (!row) return c.json(apiError('NOT_FOUND', 'Media not found.'), 404);
  return c.json({ item: toAdminMedia(row) });
});

adminMedia.post('/:id/unpublish', (c) => {
  const row = setMediaPublished(c.req.param('id'), false);
  if (!row) return c.json(apiError('NOT_FOUND', 'Media not found.'), 404);
  return c.json({ item: toAdminMedia(row) });
});

// ─── POST /:id/poster — replace the generated poster ────────────────────────
// The raw image bytes are streamed into MediaStorage; the client sends the
// image as the body with an x-mime-type of image/jpeg or image/png.

adminMedia.post('/:id/poster', async (c) => {
  const id = c.req.param('id');
  const existing = getAdminMedia(id);
  if (!existing) return c.json(apiError('NOT_FOUND', 'Media not found.'), 404);

  const rawBody = c.req.raw.body;
  if (!rawBody) return c.json(apiError('VALIDATION_ERROR', 'Poster body is empty.'), 400);

  const mime = (c.req.header('x-mime-type') ?? '').trim().toLowerCase();
  if (mime !== 'image/jpeg' && mime !== 'image/png') {
    return c.json(apiError('VALIDATION_ERROR', 'Poster must be a JPEG or PNG image.'), 400);
  }
  const declaredLength = Number(c.req.header('content-length'));
  if (!Number.isFinite(declaredLength) || declaredLength <= 0 || declaredLength > 5 * 1024 * 1024) {
    return c.json(apiError('VALIDATION_ERROR', 'Poster must be a non-empty image up to 5 MB.'), 400);
  }

  const ext = mime === 'image/png' ? 'png' : 'jpg';
  const key = `poster-${id}.${ext}`;
  const storage = getMediaStorage();

  try {
    const source = Readable.fromWeb(rawBody as unknown as import('node:stream/web').ReadableStream);
    let bytes = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        bytes += chunk.length;
        if (bytes > declaredLength) {
          cb(new Error('POSTER_SIZE_MISMATCH'));
          return;
        }
        cb(null, chunk);
      },
    });
    await pipeline(source, limiter, await storage.openWriteStream(key));
    if (bytes !== declaredLength) throw new Error('POSTER_SIZE_MISMATCH');
  } catch {
    await storage.delete(key).catch(() => {});
    return c.json(apiError('UPLOAD_FAILED', 'The poster image could not be stored.'), 500);
  }

  // Replace the generated poster reference (old key is cleaned up).
  if (existing.posterKey && existing.posterKey !== key) {
    await storage.delete(existing.posterKey).catch(() => {});
  }
  db.prepare('UPDATE media SET posterKey = ?, updatedAt = ? WHERE id = ?').run(key, new Date().toISOString(), id);
  const updated = getAdminMedia(id);
  return c.json({ item: toAdminMedia(updated!) });
});

// ─── POST /:id/upload/start — begin (or resume) a chunked upload ────────────
// Body: { totalBytes, chunkSize? }. The filename travels in the x-filename
// header; MIME is resolved from the header and/or the file extension — the
// request is rejected up front when the file is not a video.

adminMedia.post('/:id/upload/start', async (c) => {
  const id = c.req.param('id');
  const existing = getAdminMedia(id);
  if (!existing) return c.json(apiError('NOT_FOUND', 'Media not found.'), 404);

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json(apiError('VALIDATION_ERROR', 'Request body must be valid JSON.'), 400);

  const filename = sanitizeOriginalFilename(decodeURIComponentSafely(c.req.header('x-filename')));
  const clientMime = validateVideoMimeType(c.req.header('x-mime-type'));
  const mime = clientMime ?? mimeFromExtension(filename);
  if (!mime) {
    return c.json(
      apiError('VALIDATION_ERROR', 'The file type is not supported. Provide a video file.'),
      400
    );
  }
  if (filename) {
    updateMediaRecord(id, { originalFilename: filename });
  }

  const result = await startUploadSession(id, {
    totalBytes: typeof body.totalBytes === 'number' ? body.totalBytes : NaN,
    chunkSize: typeof body.chunkSize === 'number' ? body.chunkSize : undefined,
  });
  if (!result.ok) {
    const status = result.code === 'MEDIA_TOO_LARGE' ? 413 : result.code === 'NOT_FOUND' ? 404 : result.code === 'MEDIA_BUSY' ? 409 : 400;
    return c.json(apiError(result.code, result.error), status);
  }
  return c.json({ session: result.session, created: result.created });
});

// ─── GET /:id/upload/:uploadId — session state (resume support) ─────────────

adminMedia.get('/:id/upload/:uploadId', async (c) => {
  const id = c.req.param('id');
  const session = getUploadSession(c.req.param('uploadId'));
  if (!session || session.mediaId !== id) {
    return c.json(apiError('NOT_FOUND', 'Upload session not found.'), 404);
  }
  const missing = await missingChunks(session);
  return c.json({ session: { ...session, missingChunks: missing } });
});

// ─── PUT /:id/upload/:uploadId/chunks/:index — one chunk ────────────────────
// The raw chunk body is streamed straight into MediaStorage — the full file
// is never buffered in memory or on disk as a single request. The declared
// Content-Length is used as an up-front guard when present, but the
// authoritative byte count is measured while streaming (a browser fetch
// always sets Content-Length for a Blob body; a direct client may not).

adminMedia.put('/:id/upload/:uploadId/chunks/:index', async (c) => {
  const id = c.req.param('id');
  const uploadId = c.req.param('uploadId');
  const indexRaw = c.req.param('index');

  const rawBody = c.req.raw.body;
  if (!rawBody) return c.json(apiError('VALIDATION_ERROR', 'Chunk body is empty.'), 400);

  // Content-Length (when present) must be sane and within the hard chunk cap.
  let declaredBytes: number | undefined;
  const declaredRaw = c.req.header('content-length');
  if (declaredRaw !== undefined && declaredRaw !== '') {
    declaredBytes = Number(declaredRaw);
    if (!Number.isFinite(declaredBytes) || declaredBytes <= 0 || declaredBytes > MEDIA_CHUNK_MAX_BYTES) {
      return c.json(
        apiError('VALIDATION_ERROR', 'A chunk must declare a Content-Length between 1 and the chunk cap.'),
        400
      );
    }
  }

  // Streaming limiter: reject a body that outgrows the declared length or the
  // hard chunk cap BEFORE the bytes reach storage.
  let streamed = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      streamed += chunk.length;
      if (streamed > MEDIA_CHUNK_MAX_BYTES || (declaredBytes !== undefined && streamed > declaredBytes)) {
        cb(new Error('CHUNK_SIZE_MISMATCH'));
        return;
      }
      cb(null, chunk);
    },
  });

  const result = await storeChunk({
    uploadId,
    mediaId: id,
    index: Number(indexRaw),
    stream: Readable.fromWeb(rawBody as unknown as import('node:stream/web').ReadableStream).pipe(limiter),
    byteCount: declaredBytes,
  });
  if (!result.ok) {
    const status = result.code === 'MEDIA_TOO_LARGE' ? 413 : result.code === 'MEDIA_CONFLICT' ? 409 : result.code === 'NOT_FOUND' ? 404 : 400;
    return c.json(apiError(result.code, result.error), status);
  }
  return c.json({ session: result.session });
});

// ─── POST /:id/upload/:uploadId/complete — finalize + convert ───────────────
// Verifies every chunk, marks the session completed, and launches the FFmpeg
// pipeline in the background. The admin polls GET /api/admin/media/:id to
// watch status → ready. A completed session whose conversion previously
// failed can be finalized again to retry (chunks are retained).

adminMedia.post('/:id/upload/:uploadId/complete', async (c) => {
  const id = c.req.param('id');
  const uploadId = c.req.param('uploadId');

  const result = await completeUploadSession(uploadId, id);
  if (!result.ok) {
    const status = result.code === 'MEDIA_CONFLICT' ? 409 : 404;
    return c.json(apiError(result.code, result.error), status);
  }

  // Fire-and-forget: conversion runs in the background; the item's status
  // drives the client UI (processing → ready | failed).
  void convertLibraryMedia(id, uploadId).catch(() => {});

  const row = getAdminMedia(id);
  return c.json({ item: toAdminMedia(row!), converting: true });
});

// ─── DELETE /:id/upload/:uploadId — cancel the upload ───────────────────────

adminMedia.delete('/:id/upload/:uploadId', async (c) => {
  const id = c.req.param('id');
  const uploadId = c.req.param('uploadId');
  const cancelled = await cancelUploadSession(uploadId, id);
  if (!cancelled) return c.json(apiError('NOT_FOUND', 'Upload session not found.'), 404);
  const row = getAdminMedia(id);
  return c.json({ ok: true, item: toAdminMedia(row!) });
});