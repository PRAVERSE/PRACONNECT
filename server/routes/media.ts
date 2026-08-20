// server/routes/media.ts
// Phase C: Media Library — normal-user routes.
//
//   GET  /api/media               → published + ready items (search + pagination)
//   GET  /api/media/:id           → single published + ready item
//   GET  /api/media/:id/download  → authorized byte serving (Range: 200/206/416)
//   HEAD /api/media/:id/download  → headers only (Content-Length, Accept-Ranges)
//
// Visibility rule: normal users only ever see status='ready' AND published=1.
// Admins manage the library through /api/admin/media (server/routes/adminMedia.ts).
// Every route requires an authenticated session; download additionally enforces
// downloadAllowed. The served bytes are ALWAYS the playable MP4 (playableKey)
// produced by the FFmpeg pipeline — a retained original (storageKey) is never
// streamed to users. Admin sessions may download any item per admin policy.
// The response sanitizer never leaks storageKey/playableKey/posterKey to users.

import { Hono } from 'hono';
import type { Context } from 'hono';
import { Readable } from 'node:stream';
import { requireAuth } from '../middleware/auth';
import { apiError } from '../auth/auth';
import { getMediaStorage } from '../storage/mediaStorage';
import {
  listPublishedMedia,
  getPublishedMedia,
  getAdminMedia,
  toPublicMedia,
  parseRange,
} from '../media/service';

export const media = new Hono();

media.use('*', requireAuth);

// ─── GET /api/media — published library with search + pagination ────────────

media.get('/', (c) => {
  const q = c.req.query('q');
  const page = c.req.query('page');
  const pageSize = c.req.query('pageSize');

  const result = listPublishedMedia({ q, page, pageSize });
  if (!result) {
    return c.json(apiError('VALIDATION_ERROR', 'page must be ≥ 1 and pageSize must be between 1 and 100.'), 400);
  }

  return c.json({
    items: result.items.map(toPublicMedia),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    hasMore: result.hasMore,
  });
});

// ─── GET /api/media/:id — single published + ready item ─────────────────────

media.get('/:id', (c) => {
  const item = getPublishedMedia(c.req.param('id'));
  if (!item) {
    return c.json(apiError('NOT_FOUND', 'Media not found.'), 404);
  }
  return c.json({ item: toPublicMedia(item) });
});

// ─── Authorization shared by GET and HEAD download ──────────────────────────
// Returns the item + storage key + size, or a Hono Response on rejection.

async function resolveDownload(c: Context): Promise<
  | { item: ReturnType<typeof getAdminMedia> & { serveKey: string }; size: number }
  | { response: Response }
> {
  const id = c.req.param('id') ?? '';
  const user = c.get('user');
  const isAdmin = user.role === 'admin';

  // Authorization: admins may fetch any item that has stored bytes; normal
  // users require published + ready + downloadAllowed.
  const item = isAdmin ? getAdminMedia(id) : getPublishedMedia(id);
  if (!item) {
    return { response: c.json(apiError('NOT_FOUND', 'Media not found.'), 404) };
  }
  const serveKey = item.playableKey ?? (isAdmin ? item.storageKey : null);
  if (!serveKey) {
    return { response: c.json(apiError('NOT_FOUND', 'Media not found.'), 404) };
  }
  if (!isAdmin && !item.downloadAllowed) {
    return { response: c.json(apiError('FORBIDDEN', 'Downloading this media is not allowed.'), 403) };
  }

  const storage = getMediaStorage();
  const stat = await storage.stat(serveKey);
  if (!stat) {
    return { response: c.json(apiError('NOT_FOUND', 'Media file is missing.'), 404) };
  }
  return { item: { ...item, serveKey }, size: stat.size };
}

function downloadHeaders(
  item: { mimeType: string | null; originalFilename: string | null; title: string; serveKey: string },
  size: number,
  range: { start: number; end: number } | null,
  download: boolean
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': item.mimeType ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=86400',
  };
  if (range) {
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
    headers['Content-Length'] = String(range.end - range.start + 1);
  } else {
    headers['Content-Length'] = String(size);
  }
  if (download) {
    const filename = item.originalFilename ?? `${item.title}.${item.mimeType?.split('/')[1] ?? 'mp4'}`;
    headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
  }
  return headers;
}

// ─── GET /api/media/:id/download — authorized byte serving ──────────────────

media.get('/:id/download', async (c) => {
  const resolved = await resolveDownload(c);
  if ('response' in resolved) return resolved.response;

  const { item, size } = resolved;
  const storage = getMediaStorage();

  const range = parseRange(c.req.header('range'), size);
  if (range && 'error' in range) {
    return c.newResponse(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}` },
    });
  }

  const read = range
    ? await storage.read(item.serveKey, { start: range.start, end: range.end })
    : await storage.read(item.serveKey);
  if (!read) {
    return c.json(apiError('NOT_FOUND', 'Media file is missing.'), 404);
  }

  const headers = downloadHeaders(item, size, range, c.req.query('download') === '1');
  const status = range ? (206 as 200 | 206) : 200;
  return c.body(Readable.toWeb(read.stream) as unknown as ReadableStream, status, headers);
});

// ─── HEAD /api/media/:id/download — headers only ────────────────────────────
// Browsers issue HEAD before playback/seek; the answer must match GET so the
// media element can size its buffer. 206/416 are honored for Range probes.

media.on('HEAD', '/:id/download', async (c) => {
  const resolved = await resolveDownload(c);
  if ('response' in resolved) return resolved.response;

  const { item, size } = resolved;
  const range = parseRange(c.req.header('range'), size);
  if (range && 'error' in range) {
    return c.newResponse(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}` },
    });
  }
  const headers = downloadHeaders(item, size, range, c.req.query('download') === '1');
  return c.newResponse(null, { status: range ? 206 : 200, headers });
});