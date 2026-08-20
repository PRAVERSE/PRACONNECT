// server/routes/rooms.ts
// Phase 3: real-time watch rooms.
// Every privileged operation re-validates the session, the room, membership,
// and host status server-side. Never trusts client-provided identity.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { requireAuth } from '../middleware/auth';
import { apiError } from '../auth/auth';
import { db } from '../db/index';
import { uploadsDir } from '../uploads/config';
import {
  convertToPlayable,
  isFfmpegAvailable,
  isFfprobeAvailable,
  probeBrowserCompatibility,
} from '../uploads/transcode';
import {
  createRoom,
  joinRoom,
  leaveRoom,
  removeMember,
  muteMember,
  setMemberCamera,
  setSelfState,
  setRoomMedia,
  setPlayback,
  setScreenShare,
  roomPayload,
  listRoomPayloads,
  isRoomMember,
  memberStatus,
  getRoomOrNull,
} from '../rooms/service';
import type { MediaInput, RoomPayload, RoomError } from '../rooms/service';
import { emit, emitEphemeral, openEventStream, replayEventsWithMeta } from '../rooms/realtime';
import { getClientIp, rateLimit } from '../rate-limit';
import { sendWatchInvite, isAcceptedFriendship } from '../social/service';
import { emitUserEvent } from '../social/realtime';

// Upload limits. The per-file byte counter is authoritative; Content-Length
// and the total-body counter are coarse early gates (see upload route below).
const DEFAULT_MAX_UPLOAD_BYTES = 1.5 * 1024 * 1024 * 1024; // 1.5 GB
const BODY_OVERHEAD_ALLOWANCE = 1024 * 1024; // multipart framing slack
const MAX_PART_HEADER_BYTES = 64 * 1024; // cap on the first part's headers
const MAX_VALIDATION_PREFIX_BYTES = 4096; // container sniff window
const PART_HEADER_END = Buffer.from('\r\n\r\n', 'ascii');

function maxUploadBytes(): number {
  const raw = process.env.MAX_UPLOAD_BYTES;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return DEFAULT_MAX_UPLOAD_BYTES;
}

/**
 * Validate a host-provided poster URL server-side (Phase 6.8). Only http(s)
 * and the app's own /api/uploads/ media URLs are allowed; javascript:, data:,
 * blob:, file:, ftp:, and protocol-relative URLs are rejected.
 */
function validatePosterUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/api/uploads/')) return trimmed;
  return null;
}

export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.mp4': return 'video/mp4';
    case '.webm': return 'video/webm';
    case '.ogv':
    case '.ogg': return 'video/ogg';
    case '.mov': return 'video/quicktime';
    case '.mkv': return 'video/x-matroska';
    case '.avi': return 'video/x-msvideo';
    case '.mp3': return 'audio/mpeg';
    case '.wav': return 'audio/wav';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.png': return 'image/png';
    default: return 'application/octet-stream';
  }
}

export function handleMediaServing(c: Context) {
  const rawFilename = c.req.param('filename') || '';
  const filename = path.basename(rawFilename);
  if (!filename || filename === '.' || filename === '..') {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Media file not found.' } }, 404);
  }

  // Phase 6.2: media is served only to active members of the owning room.
  // Filename obscurity is not authorization — every request is checked.
  const upload = db.prepare('SELECT roomId FROM uploads WHERE filename = ?').get(filename) as
    | { roomId: string }
    | undefined;
  if (!upload) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Media file not found.' } }, 404);
  }
  const room = getRoomOrNull(upload.roomId);
  if (!room || room.emptySince) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Media file not found.' } }, 404);
  }
  let userId: string;
  try {
    userId = c.get('userId');
  } catch {
    return c.json(apiError('UNAUTHENTICATED', 'Authentication required.'), 401);
  }
  if (memberStatus(room.id, userId) !== 'active') {
    return c.json(apiError('ROOM_MEMBERSHIP_REQUIRED', 'You are not a member of this room.'), 403);
  }

  const filePath = path.join(uploadsDir, filename);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Media file not found.' } }, 404);
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const mimeType = getMimeType(filePath);
  const range = c.req.header('range');
  const isHead = c.req.method === 'HEAD';

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (isNaN(start) || start >= fileSize || end >= fileSize || start > end) {
      return new Response(null, {
        status: 416,
        headers: {
          'Content-Range': `bytes */${fileSize}`,
          'Accept-Ranges': 'bytes',
        },
      });
    }

    const chunksize = end - start + 1;
    const stream = isHead ? null : fs.createReadStream(filePath, { start, end });

    return new Response(stream as any, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunksize),
        'Content-Type': mimeType,
      },
    });
  } else {
    const stream = isHead ? null : fs.createReadStream(filePath);
    return new Response(stream as any, {
      status: 200,
      headers: {
        'Content-Length': String(fileSize),
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
      },
    });
  }
}

const rooms = new Hono();
rooms.use('*', requireAuth);

// ─── Helpers ─────────────────────────────────────────────────────────────────

type ServiceResult =
  | { ok: true; payload: RoomPayload }
  | { ok: false; error: RoomError };

function serviceErrorStatus(err: RoomError): 400 | 403 | 404 | 409 {
  switch (err.code) {
    case 'ROOM_NOT_FOUND':
    case 'ROOM_GONE':
      return 404;
    case 'ROOM_FULL':
      return 409;
    case 'NOT_HOST':
    case 'ROOM_MEMBERSHIP_REQUIRED':
    case 'REMOVED_FROM_ROOM':
    case 'INVALID_TARGET':
      return 403;
    default:
      return 400;
  }
}

function sendResult(c: Context, result: ServiceResult) {
  if (!result.ok) {
    const err = result.error;
    return c.json({ error: { code: err.code, message: err.message } }, serviceErrorStatus(err));
  }
  return c.json({ room: result.payload });
}

/** Returns an error response for rooms that are gone or the user isn't in. */
function activeMemberGuard(c: Context, roomId: string, userId: string): Response | null {
  const room = getRoomOrNull(roomId);
  if (!room || room.emptySince) {
    return c.json(apiError('ROOM_GONE', 'This room has expired or was deleted.'), 404);
  }
  const status = memberStatus(roomId, userId);
  if (status === 'removed') {
    return c.json(apiError('REMOVED_FROM_ROOM', 'You were removed from this room by the host.'), 403);
  }
  if (status !== 'active') {
    return c.json(apiError('ROOM_MEMBERSHIP_REQUIRED', 'You are not a member of this room.'), 403);
  }
  return null;
}

async function readJson(c: Context): Promise<Record<string, unknown> | null> {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return null;
  return body as Record<string, unknown>;
}

// ─── GET /api/rooms — active room discovery ──────────────────────────────────

rooms.get('/', (c) => {
  const userId = c.get('userId');
  return c.json({ rooms: listRoomPayloads(userId) });
});

// ─── GET /api/rooms/:id — detail (public rooms or members only) ─────────────

rooms.get('/:id', (c) => {
  const roomId = c.req.param('id');
  const userId = c.get('userId');
  const room = getRoomOrNull(roomId);
  if (!room) return c.json(apiError('ROOM_NOT_FOUND', 'Room not found.'), 404);

  if (room.privacy === 'private' && !isRoomMember(roomId, userId)) {
    return c.json(apiError('ROOM_MEMBERSHIP_REQUIRED', 'This is a private room.'), 403);
  }
  const payload = roomPayload(roomId, userId);
  if (!payload) return c.json(apiError('ROOM_NOT_FOUND', 'Room not found.'), 404);
  return c.json({ room: payload });
});

// ─── POST /api/rooms — create (creator becomes host) ────────────────────────

rooms.post('/', async (c) => {
  const userId = c.get('userId');
  const createLimit = rateLimit(c, `roomCreate:user:${userId}`, 'roomCreate');
  if (createLimit) return createLimit;

  const body = await readJson(c);
  if (!body) return c.json(apiError('BAD_REQUEST', 'Invalid JSON body.'), 400);

  let payload: RoomPayload;
  try {
    payload = createRoom(userId, {
      name: typeof body.name === 'string' ? body.name : '',
      category: typeof body.category === 'string' ? body.category : 'Other',
      privacy: typeof body.privacy === 'string' ? body.privacy : 'public',
      maxParticipants: typeof body.maxParticipants === 'number' ? body.maxParticipants : 8,
      description: typeof body.description === 'string' ? body.description : undefined,
    });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e && e.code && e.message) {
      return c.json({ error: { code: e.code, message: e.message } }, 400);
    }
    throw err;
  }

  emit(payload.id, 'room:update', { room: payload });

  if (Array.isArray(body.inviteFriendIds) && body.inviteFriendIds.length > 0) {
    for (const friendId of body.inviteFriendIds) {
      if (typeof friendId === 'string' && friendId !== userId && isAcceptedFriendship(userId, friendId)) {
        const invRes = sendWatchInvite(userId, friendId, payload.id);
        if (invRes.ok && invRes.invite) {
          emitUserEvent(friendId, 'watch:invite', { invite: invRes.invite });
        }
      }
    }
  }

  return c.json({ room: payload }, 201);
});

// ─── POST /api/rooms/:id/join ────────────────────────────────────────────────

rooms.post('/:id/join', (c) => {
  const roomId = c.req.param('id');
  const userId = c.get('userId');

  const ipLimit = rateLimit(c, `join:ip:${getClientIp(c)}`, 'join');
  if (ipLimit) return ipLimit;
  const userLimit = rateLimit(c, `join:user:${userId}`, 'joinUser');
  if (userLimit) return userLimit;

  const result = joinRoom(roomId, userId);
  if (!result.ok) return sendResult(c, result);

  emit(result.payload.id, 'member:join', {
    roomId,
    member: result.payload.members.find((m) => m.userId === userId) ?? null,
  });
  return c.json({ room: result.payload });
});

// ─── POST /api/rooms/:id/leave ───────────────────────────────────────────────

rooms.post('/:id/leave', (c) => {
  const roomId = c.req.param('id');
  const userId = c.get('userId');
  const room = getRoomOrNull(roomId);
  if (!room) return c.json(apiError('ROOM_NOT_FOUND', 'Room not found.'), 404);

  const wasHost = room.hostUserId === userId;
  const result = leaveRoom(roomId, userId);
  if (!result.ok) return sendResult(c, result);

  const payload = roomPayload(roomId, null);
  if (payload && wasHost && payload.hostUserId !== userId) {
    emit(roomId, 'host:changed', { roomId, hostUserId: payload.hostUserId, host: payload.host });
  }
  emit(roomId, 'member:leave', { roomId, userId });
  if (payload && (wasHost || payload.emptySince)) {
    emit(roomId, 'room:update', { room: payload });
  }
  return c.json({ ok: true, room: payload });
});

// ─── Host media / playback / screen share ────────────────────────────────────

// Phase C: select a published Media Library item for the room. Only the host
// may change room media; the media reference (mediaId + metadata) is stored in
// room state — never a filesystem path. Every participant streams the playable
// MP4 from the library through their own authenticated session, so video never
// travels over WebRTC.
rooms.post('/:id/media/library', async (c) => {
  const roomId = c.req.param('id');
  const userId = c.get('userId');
  const guard = activeMemberGuard(c, roomId, userId);
  if (guard) return guard;

  const body = await readJson(c);
  const mediaId = body && typeof body.mediaId === 'string' ? body.mediaId.trim() : '';
  if (!mediaId) {
    return c.json(apiError('VALIDATION_ERROR', 'mediaId is required.'), 400);
  }

  const { getAdminMedia } = await import('../media/service');
  const item = getAdminMedia(mediaId);
  if (!item) {
    return c.json(apiError('MEDIA_NOT_FOUND', 'That media is not available in the library.'), 404);
  }
  if (item.status !== 'ready') {
    return c.json(apiError('MEDIA_NOT_READY', 'That media is not ready for playback.'), 404);
  }
  if (!item.published) {
    return c.json(apiError('MEDIA_UNAVAILABLE', 'That media is not published.'), 404);
  }
  if (!item.playableKey) {
    return c.json(apiError('MEDIA_UNAVAILABLE', 'Playable media is missing.'), 404);
  }

  const { getMediaStorage } = await import('../storage/mediaStorage');
  const storage = getMediaStorage();
  const stat = await storage.stat(item.playableKey);
  if (!stat) {
    return c.json(apiError('MEDIA_UNAVAILABLE', 'Playable media file is missing from storage.'), 404);
  }

  const media: MediaInput = {
    title: item.title,
    mediaType: 'library',
    mediaId: item.id,
    duration: item.durationSeconds ?? undefined,
    mimeType: item.mimeType ?? undefined,
  };

  const result = setRoomMedia(roomId, userId, media);
  if (!result.ok) return sendResult(c, result);
  emit(result.payload.id, 'room:update', { room: result.payload });
  return c.json({ room: result.payload });
});

rooms.post('/:id/media', async (c) => {
  const roomId = c.req.param('id');
  const userId = c.get('userId');
  const guard = activeMemberGuard(c, roomId, userId);
  if (guard) return guard;

  const body = await readJson(c);
  let media: MediaInput | null = null;

  if (body && (body.mediaType === 'library' || (body.mediaId && typeof body.mediaId === 'string'))) {
    const mediaId = typeof body.mediaId === 'string' ? body.mediaId.trim() : '';
    if (!mediaId) {
      return c.json(apiError('VALIDATION_ERROR', 'mediaId is required.'), 400);
    }
    const { getAdminMedia } = await import('../media/service');
    const item = getAdminMedia(mediaId);
    if (!item) {
      return c.json(apiError('MEDIA_NOT_FOUND', 'That media is not available in the library.'), 404);
    }
    if (item.status !== 'ready') {
      return c.json(apiError('MEDIA_NOT_READY', 'That media is not ready for playback.'), 404);
    }
    if (!item.published) {
      return c.json(apiError('MEDIA_UNAVAILABLE', 'That media is not published.'), 404);
    }
    if (!item.playableKey) {
      return c.json(apiError('MEDIA_UNAVAILABLE', 'Playable media is missing.'), 404);
    }
    const { getMediaStorage } = await import('../storage/mediaStorage');
    const storage = getMediaStorage();
    const stat = await storage.stat(item.playableKey);
    if (!stat) {
      return c.json(apiError('MEDIA_UNAVAILABLE', 'Playable media file is missing from storage.'), 404);
    }
    media = {
      title: item.title,
      mediaType: 'library',
      mediaId: item.id,
      duration: item.durationSeconds ?? undefined,
      mimeType: item.mimeType ?? undefined,
    };
  } else if (body && body.mediaType === 'local-movie') {
    if (typeof body.url === 'string' && body.url.trim() !== '') {
      return c.json(
        apiError(
          'VALIDATION_ERROR',
          'Local movie media is shared peer-to-peer — URLs (including blob: URLs) are never stored in room state.'
        ),
        400
      );
    }
    media = {
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Local movie',
      mediaType: 'local-movie',
      sourceUserId: typeof body.sourceUserId === 'string' ? body.sourceUserId : undefined,
      mimeType: typeof body.mimeType === 'string' && body.mimeType.trim() ? body.mimeType.trim() : undefined,
      duration: typeof body.duration === 'number' && body.duration >= 0 ? body.duration : undefined,
    };
  } else if (body && typeof body.url === 'string' && body.url.trim() !== '') {
    const url = body.url.trim();

    if (url.startsWith('blob:')) {
      return c.json(
        apiError(
          'VALIDATION_ERROR',
          'Blob URLs cannot be shared across browsers. Please upload the movie directly or provide an http(s) URL.'
        ),
        400
      );
    }

    if (!/^https?:\/\//i.test(url) && !url.startsWith('/api/uploads/')) {
      return c.json(apiError('VALIDATION_ERROR', 'Media URL must be an http(s) or /api/uploads/ URL.'), 400);
    }

    let poster: string | undefined;
    if (typeof body.poster === 'string' && body.poster.trim() !== '') {
      const validPoster = validatePosterUrl(body.poster);
      if (!validPoster) {
        return c.json(apiError('VALIDATION_ERROR', 'Poster URL must be an http(s) or /api/uploads/ URL.'), 400);
      }
      poster = validPoster;
    }

    media = {
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Untitled stream',
      url,
      poster,
      duration: typeof body.duration === 'number' ? body.duration : undefined,
      type: body.type === 'stream' ? 'stream' : 'video',
    };
  }

  const result = setRoomMedia(roomId, userId, media);
  if (!result.ok) return sendResult(c, result);
  emit(result.payload.id, 'room:update', { room: result.payload });
  return c.json({ room: result.payload });
});

/**
 * Inspect video container format from binary buffer headers.
 * Protects against client-spoofed MIME types and unsupported formats.
 */
export function inspectVideoContainer(buffer: Buffer): 'mp4' | 'webm' | 'mov' | 'mkv' | 'avi' | 'wmv' | 'ogv' | 'unknown' {
  if (buffer.length < 12) return 'unknown';

  // 1. EBML header: 0x1A 0x45 0xDF 0xA3 (MKV or WebM)
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    const searchLimit = Math.min(buffer.length, 4096);
    const headerStr = buffer.subarray(0, searchLimit).toString('latin1');
    if (headerStr.includes('webm')) {
      return 'webm';
    }
    return 'mkv'; // Matroska (.mkv)
  }

  // 2. AVI: starts with 'RIFF' and has 'AVI ' at offset 8
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'AVI '
  ) {
    return 'avi';
  }

  // 3. WMV / ASF: GUID 30 26 B2 75 8E 66 CF 11 A6 D9 00 AA 00 62 CE 6C
  if (
    buffer[0] === 0x30 && buffer[1] === 0x26 && buffer[2] === 0xb2 && buffer[3] === 0x75 &&
    buffer[4] === 0x8e && buffer[5] === 0x66 && buffer[6] === 0xcf && buffer[7] === 0x11
  ) {
    return 'wmv';
  }

  // 4. Ogg: 'OggS'
  if (buffer.subarray(0, 4).toString('ascii') === 'OggS') {
    return 'ogv';
  }

  // 5. MP4 / MOV (ISOBMFF): ftyp at offset 4
  const boxType = buffer.subarray(4, 8).toString('ascii');
  if (boxType === 'ftyp') {
    const majorBrand = buffer.subarray(8, 12).toString('ascii').trim().toLowerCase();
    if (majorBrand === 'qt') {
      return 'mov';
    }
    return 'mp4';
  }

  if (boxType === 'moov' || boxType === 'mdat') {
    return 'mp4';
  }

  return 'unknown';
}

rooms.post('/:id/media/upload', async (c) => {
  const roomId = c.req.param('id');
  const userId = c.get('userId');
  const uploadLimit = rateLimit(c, `mediaUpload:user:${userId}`, 'mediaUpload');
  if (uploadLimit) return uploadLimit;

  const guard = activeMemberGuard(c, roomId, userId);
  if (guard) return guard;

  const room = getRoomOrNull(roomId);
  if (!room) return c.json(apiError('ROOM_NOT_FOUND', 'Room not found.'), 404);
  if (room.hostUserId !== userId) {
    return c.json(apiError('NOT_HOST', 'Only the room host can upload media.'), 403);
  }

  // ─── Boundary + limits ────────────────────────────────────────────────────
  const contentType = c.req.header('content-type') ?? '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const boundary = boundaryMatch ? boundaryMatch[1] || boundaryMatch[2] : null;
  if (!boundary || boundary.length > 70 || /[\r\n]/.test(boundary)) {
    return c.json(apiError('VALIDATION_ERROR', 'Invalid multipart/form-data body (missing or malformed boundary).'), 400);
  }
  const delim = Buffer.from(`\r\n--${boundary}`, 'ascii');
  const keep = delim.length + 4;

  const maxBytes = maxUploadBytes();
  const bodyLimit = maxBytes + BODY_OVERHEAD_ALLOWANCE;

  // Coarse pre-check only — the per-file byte counter below is authoritative.
  const contentLength = Number(c.req.header('content-length') ?? '');
  if (Number.isFinite(contentLength) && contentLength > bodyLimit) {
    return c.json(apiError('FILE_TOO_LARGE', 'Uploaded movie exceeds maximum allowed size of 1.5GB.'), 400);
  }

  const body = c.req.raw.body;
  if (!body) {
    return c.json(apiError('VALIDATION_ERROR', 'Please provide a valid video file in the file field.'), 400);
  }
  const reader = body.getReader();
  const abortSignal = c.req.raw.signal;

  let partPath = '';
  let sink: fs.WriteStream | null = null;
  let sinkError: Error | null = null;
  let finalized = false;

  async function cleanupPartial(): Promise<void> {
    if (sink && !sink.destroyed) {
      await new Promise<void>((resolve) => {
        sink!.once('close', () => resolve());
        sink!.once('error', () => resolve());
        sink!.destroy();
      });
    }
    if (partPath) {
      try {
        fs.rmSync(partPath, { force: true });
      } catch {
        // already gone
      }
    }
  }

  const onAbort = () => {
    if (!finalized) {
      reader.cancel().catch(() => {});
      cleanupPartial().catch(() => {});
    }
  };
  abortSignal.addEventListener('abort', onAbort);

  // Upload error statuses are literals so c.json can type them strictly.
  async function fail(status: 400 | 413, code: string, message: string): Promise<Response> {
    await cleanupPartial();
    return c.json(apiError(code, message), status);
  }

  try {
    // ─── Read the first part headers (bounded window) ───────────────────────
    let headerBuf = Buffer.alloc(0);
    let headerEnd = -1;
    let bodyBytes = 0;
    while (headerBuf.length <= MAX_PART_HEADER_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.length === 0) continue;
      bodyBytes += value.length;
      if (bodyBytes > bodyLimit) {
        return fail(413, 'PAYLOAD_TOO_LARGE', 'Upload body exceeds the allowed size.');
      }
      headerBuf = headerBuf.length === 0 ? Buffer.from(value) : Buffer.concat([headerBuf, value]);
      headerEnd = headerBuf.indexOf(PART_HEADER_END);
      if (headerEnd !== -1) break;
    }

    const firstLine = Buffer.from(`--${boundary}\r\n`, 'ascii');
    if (headerEnd === -1 || !headerBuf.subarray(0, firstLine.length).equals(firstLine)) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid multipart/form-data body.');
    }

    const partHeaders = headerBuf.subarray(firstLine.length, headerEnd).toString('latin1');
    const dispositionLine = partHeaders.split('\r\n').find((line) => /^content-disposition\s*:/i.test(line));
    const nameMatch = dispositionLine?.match(/;\s*name="([^"]*)"/i);
    if (!dispositionLine || !nameMatch || nameMatch[1] !== 'file') {
      return fail(400, 'VALIDATION_ERROR', 'Please provide a valid video file in the file field.');
    }

    const filenameMatch = dispositionLine.match(/;\s*filename="([^"]*)"/i);
    const originalName = filenameMatch ? filenameMatch[1] : 'movie.mp4';
    const ext = path.extname(originalName).toLowerCase() || '.mp4';
    const allowedExts = ['.mp4', '.webm', '.mov', '.mkv'];
    if (!allowedExts.includes(ext)) {
      return fail(
        400,
        'INVALID_MEDIA_TYPE',
        `This file format (${ext}) isn't supported for playback. Please upload MP4, WebM, MOV, or MKV.`
      );
    }

    const safeId = crypto.randomUUID().slice(0, 12);
    const finalName = `media-${Date.now()}-${safeId}${ext}`;
    const destination = path.join(uploadsDir, finalName);
    let pending = headerBuf.subarray(headerEnd + 4);
    let fileBytes = 0;
    let prefixBytes = 0;
    const prefixChunks: Buffer[] = [];

    function capturePrefix(chunk: Buffer): void {
      if (prefixBytes >= MAX_VALIDATION_PREFIX_BYTES) return;
      const take = chunk.subarray(0, MAX_VALIDATION_PREFIX_BYTES - prefixBytes);
      prefixChunks.push(take);
      prefixBytes += take.length;
    }

    function writeChunk(chunk: Buffer): Promise<void> {
      return new Promise((resolve, reject) => {
        if (!sink) {
          partPath = path.join(uploadsDir, `${finalName}.part`);
          sink = fs.createWriteStream(partPath, { flags: 'wx' });
          sink.on('error', (err) => {
            sinkError = err;
          });
        }
        let settled = false;
        const onError = (err: Error) => {
          if (!settled) {
            settled = true;
            sinkError = err;
            reject(err);
          }
        };
        const onDrain = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        sink.once('error', onError);
        sink.once('drain', onDrain);
        try {
          if (sink.write(chunk)) {
            if (!settled) {
              settled = true;
              resolve();
            }
          }
        } catch (err) {
          if (!settled) {
            settled = true;
            sinkError = err as Error;
            reject(err as Error);
          }
        }
      });
    }

    // ─── Stream the file part to disk, byte by byte, never buffering it ─────
    while (true) {
      const idx = pending.indexOf(delim);
      if (idx !== -1) {
        const tailStart = idx + delim.length;
        const tailLen = pending.length - tailStart;
        if (tailLen < 2) {
          // Delimiter straddles the read boundary — pull more before deciding.
          const { done, value } = await reader.read();
          if (done) {
            return fail(400, 'UPLOAD_FAILED', 'Failed to upload media file: the upload stream ended prematurely.');
          }
          if (value.length === 0) continue;
          bodyBytes += value.length;
          if (bodyBytes > bodyLimit) {
            return fail(413, 'PAYLOAD_TOO_LARGE', 'Upload body exceeds the allowed size.');
          }
          pending = Buffer.concat([pending, value]);
          continue;
        }
        const b1 = pending[tailStart];
        const b2 = pending[tailStart + 1];
        if ((b1 === 0x2d && b2 === 0x2d) || (b1 === 0x0d && b2 === 0x0a)) {
          // Real end of the part (`--` closing or `\r\n` next-part separator).
          const content = pending.subarray(0, idx);
          if (content.length > 0) {
            capturePrefix(content);
            await writeChunk(content);
            if (sinkError) throw sinkError;
            fileBytes += content.length;
            if (fileBytes > maxBytes) {
              return fail(400, 'FILE_TOO_LARGE', 'Uploaded movie exceeds maximum allowed size of 1.5GB.');
            }
          }
          break;
        }
        // False positive — the bytes coincidentally matched; keep scanning.
        pending = pending.subarray(idx + 1);
        continue;
      }

      if (pending.length > keep) {
        const toFlush = pending.length - keep;
        capturePrefix(pending.subarray(0, toFlush));
        await writeChunk(pending.subarray(0, toFlush));
        if (sinkError) throw sinkError;
        fileBytes += toFlush;
        if (fileBytes > maxBytes) {
          return fail(400, 'FILE_TOO_LARGE', 'Uploaded movie exceeds maximum allowed size of 1.5GB.');
        }
        pending = pending.subarray(toFlush);
        continue;
      }

      const { done, value } = await reader.read();
      if (done) {
        return fail(400, 'UPLOAD_FAILED', 'Failed to upload media file: the upload stream ended prematurely.');
      }
      if (value.length === 0) continue;
      bodyBytes += value.length;
      if (bodyBytes > bodyLimit) {
        return fail(413, 'PAYLOAD_TOO_LARGE', 'Upload body exceeds the allowed size.');
      }
      pending = Buffer.concat([pending, value]);
    }

    // ─── Validate & finalize ────────────────────────────────────────────────
    if (fileBytes === 0) {
      return fail(
        400,
        'EMPTY_FILE',
        'The uploaded file is empty (0 bytes). Please upload a valid video file.'
      );
    }

    const detectedContainer = inspectVideoContainer(Buffer.concat(prefixChunks));
    if (['avi', 'wmv', 'ogv'].includes(detectedContainer)) {
      const displayExt =
        ext === '.mkv' || detectedContainer === 'mkv'
          ? '.mkv'
          : ext === '.avi' || detectedContainer === 'avi'
          ? '.avi'
          : ext === '.wmv' || detectedContainer === 'wmv'
          ? '.wmv'
          : ext;
      return fail(
        400,
        'INVALID_MEDIA_TYPE',
        `This file format (${displayExt}) isn't supported for playback. Please upload MP4, WebM, MOV, or MKV.`
      );
    }

    // A .mkv filename is never trusted on its own — the content must actually
    // be a Matroska/EBML container before we store anything.
    const isMkv = detectedContainer === 'mkv';
    if (ext === '.mkv' && !isMkv) {
      return fail(
        400,
        'INVALID_MEDIA_TYPE',
        "This file isn't a valid MKV (Matroska) container. Please upload a valid MKV, MP4, WebM, or MOV movie."
      );
    }

    // Browsers cannot reliably play Matroska directly, and a room must never
    // reference an unplayable movie. Without FFmpeg on the server there is no
    // safe way to make an MKV watchable, so reject it clearly up front (the
    // content signature was already verified above — this is not an
    // extension-only check).
    if (isMkv && !isFfmpegAvailable()) {
      return fail(
        400,
        'CONVERSION_UNAVAILABLE',
        "MKV movies need conversion before they can stream in browsers, but this server doesn't have FFmpeg installed. Please upload MP4, WebM, or MOV instead."
      );
    }

    if (sink) {
      await new Promise<void>((resolve, reject) => {
        sink!.once('error', (err) => reject(err));
        sink!.once('close', () => resolve());
        sink!.end();
      });
      if (sinkError) throw sinkError;
      try {
        fs.renameSync(partPath, destination);
      } catch (err) {
        await cleanupPartial();
        throw err;
      }

      // Persist ownership metadata atomically with finalization. If the
      // record cannot be written, remove the file so no orphan exists.
      // MKV sources start as 'processing' (they require conversion); other
      // containers are 'ready' (the stored file itself is browser-playable).
      try {
        db.prepare(
          `INSERT INTO uploads (filename, roomId, userId, size, mimeType, createdAt, conversionStatus)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(finalName, roomId, userId, fileBytes, getMimeType(destination), new Date().toISOString(), isMkv ? 'processing' : 'ready');
      } catch (err) {
        try {
          fs.rmSync(destination, { force: true });
        } catch {
          // already gone
        }
        throw err;
      }
    }

    finalized = true;

    const title = originalName.replace(/\.[^/.]+$/, '');
    const posterUrl = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800&q=80';

    function publishConverted(media: { title: string; url: string; poster?: string; type: string }): void {
      const publishResult = setRoomMedia(roomId, userId, media);
      if (!publishResult.ok) return;
      emit(publishResult.payload.id, 'room:update', { room: publishResult.payload });
      emit(roomId, 'media:conversion', { status: 'ready', roomId });
    }

    function startConversion(): void {
      emit(roomId, 'media:conversion', { status: 'processing', title, roomId });
      void convertToPlayable({
        sourceName: finalName,
        roomId,
        userId,
        title,
        poster: posterUrl,
        onReady: publishConverted,
        onFailed: () => {
          emit(roomId, 'media:conversion', { status: 'failed', title, roomId });
        },
      });
    }

    if (isMkv) {
      // Matroska is never handed to <video> directly. Store the verified
      // source, convert on the server, and broadcast the playable MP4 only
      // when conversion completes. Until then the room has no playable media.
      startConversion();
      return c.json({
        ok: true,
        room: roomPayload(roomId, userId),
        conversion: { status: 'processing', title, sourceFilename: finalName },
      });
    }

    // MP4 / MOV may still carry browser-incompatible codecs. When FFprobe is
    // available, decide by actual media compatibility rather than extension;
    // when it is not (or the probe cannot tell), fall back to the existing
    // direct-play behavior.
    if ((detectedContainer === 'mp4' || detectedContainer === 'mov') && isFfprobeAvailable()) {
      const compat = await probeBrowserCompatibility(finalName);
      if (compat === 'convert') {
        startConversion();
        return c.json({
          ok: true,
          room: roomPayload(roomId, userId),
          conversion: { status: 'processing', title, sourceFilename: finalName },
        });
      }
    }

    const media: MediaInput = {
      title,
      url: `/api/uploads/${finalName}`,
      poster: posterUrl,
      type: 'video',
    };

    const result = setRoomMedia(roomId, userId, media);
    if (!result.ok) return sendResult(c, result);

    emit(result.payload.id, 'room:update', { room: result.payload });
    return c.json({ ok: true, room: result.payload, media });
  } catch (err: any) {
    await cleanupPartial();
    console.error('[rooms] Media upload error:', err);
    return c.json(apiError('UPLOAD_FAILED', `Failed to upload media file: ${err.message || 'Server error'}`), 500);
  } finally {
    finalized = true;
    abortSignal.removeEventListener('abort', onAbort);
    reader.cancel().catch(() => {});
  }
});

rooms.post('/:id/playback', async (c) => {
  const roomId = c.req.param('id');
  const userId = c.get('userId');
  const guard = activeMemberGuard(c, roomId, userId);
  if (guard) return guard;

  const body = await readJson(c);
  if (!body || typeof body.isPlaying !== 'boolean') {
    return c.json(apiError('VALIDATION_ERROR', 'isPlaying (boolean) is required.'), 400);
  }

  const result = setPlayback(roomId, userId, {
    isPlaying: body.isPlaying,
    position: typeof body.position === 'number' ? body.position : undefined,
  });
  if (!result.ok) return sendResult(c, result);
  emit(result.payload.id, 'room:update', { room: result.payload });
  return c.json({ room: result.payload });
});

rooms.post('/:id/screen-share', async (c) => {
  const roomId = c.req.param('id');
  const userId = c.get('userId');
  const guard = activeMemberGuard(c, roomId, userId);
  if (guard) return guard;

  const body = await readJson(c);
  if (!body || typeof body.active !== 'boolean') {
    return c.json(apiError('VALIDATION_ERROR', 'active (boolean) is required.'), 400);
  }

  const result = setScreenShare(roomId, userId, body.active);
  if (!result.ok) return sendResult(c, result);
  emit(result.payload.id, 'room:update', { room: result.payload });
  // Broadcast the host's per-user screen-share flag so participant objects
  // on every client update immediately (room:update members already carry
  // screenShareOn after the service fix, this covers merged state paths too).
  const member = result.payload.members.find((m) => m.userId === userId);
  if (member) {
    emit(result.payload.id, 'member:state', {
      roomId,
      userId,
      micOn: member.micOn,
      cameraOn: member.cameraOn,
      screenShareOn: member.screenShareOn,
    });
  }
  return c.json({ room: result.payload });
});

// ─── Self device state (own mic/camera) ──────────────────────────────────────

rooms.post('/:id/self', async (c) => {
  const roomId = c.req.param('id');
  const userId = c.get('userId');
  const guard = activeMemberGuard(c, roomId, userId);
  if (guard) return guard;

  const body = await readJson(c);
  if (!body) return c.json(apiError('BAD_REQUEST', 'Invalid JSON body.'), 400);

  const result = setSelfState(roomId, userId, {
    micOn: typeof body.micOn === 'boolean' ? body.micOn : undefined,
    cameraOn: typeof body.cameraOn === 'boolean' ? body.cameraOn : undefined,
  });
  if (!result.ok) return sendResult(c, result);
  const member = result.payload.members.find((m) => m.userId === userId);
  if (member) {
    emit(result.payload.id, 'member:state', {
      roomId,
      userId,
      micOn: member.micOn,
      cameraOn: member.cameraOn,
      screenShareOn: member.screenShareOn,
    });
  }
  return c.json({ room: result.payload });
});

// ─── Room Chat ──────────────────────────────────────────────────────────────

rooms.post('/:id/chat', async (c) => {
  const roomId = c.req.param('id');
  const userId = c.get('userId');
  const guard = activeMemberGuard(c, roomId, userId);
  if (guard) return guard;

  const chatLimit = rateLimit(c, `chat:${userId}:${roomId}`, 'chat');
  if (chatLimit) return chatLimit;

  const body = await readJson(c);
  if (!body || typeof body.text !== 'string' || !body.text.trim()) {
    return c.json(apiError('VALIDATION_ERROR', 'Text is required.'), 400);
  }

  const room = getRoomOrNull(roomId);
  if (!room) return c.json(apiError('ROOM_NOT_FOUND', 'Room not found.'), 404);

  const sender = (db.prepare('SELECT id, name, username, avatarUrl FROM users WHERE id = ?').get(userId) as {
    id: string;
    name: string;
    username: string;
    avatarUrl: string | null;
  } | undefined) ?? { id: userId, name: 'User', username: 'user', avatarUrl: null };

  const message = {
    id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    roomId: room.id,
    senderId: userId,
    senderName: sender.name,
    senderAvatar: sender.avatarUrl || sender.name.charAt(0).toUpperCase() || 'U',
    text: body.text.trim(),
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };

  emit(room.id, 'chat:message', message);
  return c.json({ message }, 201);
});

// ─── Room Reactions ───────────────────────────────────────────────────────────
// Reactions are TRANSIENT by design: they are broadcast to live room members
// over the ephemeral SSE channel but never persisted to roomEvents, so they
// never enter chat history and are never replayed after a reconnect/reload.

rooms.post('/:id/reaction', async (c) => {
  const roomId = c.req.param('id');
  const userId = c.get('userId');
  const guard = activeMemberGuard(c, roomId, userId);
  if (guard) return guard;

  const reactionLimit = rateLimit(c, `reaction:${userId}:${roomId}`, 'reaction');
  if (reactionLimit) return reactionLimit;

  const body = await readJson(c);
  const emoji = typeof body?.emoji === 'string' ? body.emoji.trim() : '';
  if (!emoji || emoji.length > 16) {
    return c.json(apiError('VALIDATION_ERROR', 'A valid emoji is required.'), 400);
  }

  const room = getRoomOrNull(roomId);
  if (!room) return c.json(apiError('ROOM_NOT_FOUND', 'Room not found.'), 404);

  const sender = (db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as
    | { name: string }
    | undefined) ?? { name: 'User' };

  emitEphemeral(room.id, 'reaction', {
    fromUserId: userId,
    senderName: sender.name,
    emoji,
  });
  return c.json({ ok: true }, 200);
});

// ─── WebRTC Signaling ───────────────────────────────────────────────────────

rooms.post('/:id/signal', async (c) => {
  const roomId = c.req.param('id');
  const userId = c.get('userId');
  const guard = activeMemberGuard(c, roomId, userId);
  if (guard) return guard;

  const signalLimit = rateLimit(c, `signal:${userId}:${roomId}`, 'signal');
  if (signalLimit) return signalLimit;

  const body = await readJson(c);
  if (!body || typeof body.signal !== 'object' || body.signal === null) {
    return c.json(apiError('VALIDATION_ERROR', 'Signal object is required.'), 400);
  }

  const targetUserId = typeof body.targetUserId === 'string' ? body.targetUserId : undefined;

  emitEphemeral(
    roomId,
    'signal',
    {
      fromUserId: userId,
      targetUserId,
      signal: body.signal,
    },
    targetUserId
  );

  return c.json({ ok: true });
});

// ─── Host moderation ─────────────────────────────────────────────────────────

rooms.post('/:id/members/:userId/remove', (c) => {
  const roomId = c.req.param('id');
  const actorUserId = c.get('userId');
  const targetUserId = c.req.param('userId');

  const result = removeMember(roomId, actorUserId, targetUserId);
  if (!result.ok) return sendResult(c, result);

  emit(roomId, 'member:removed', { roomId, userId: targetUserId, byHostId: actorUserId });
  emit(roomId, 'member:leave', { roomId, userId: targetUserId });
  emit(roomId, 'room:update', { room: result.payload });
  return c.json({ room: result.payload });
});

rooms.post('/:id/members/:userId/mute', async (c) => {
  const roomId = c.req.param('id');
  const actorUserId = c.get('userId');
  const targetUserId = c.req.param('userId');
  const body = await readJson(c);
  if (!body || typeof body.muted !== 'boolean') {
    return c.json(apiError('VALIDATION_ERROR', 'muted (boolean) is required.'), 400);
  }

  const result = muteMember(roomId, actorUserId, targetUserId, body.muted);
  if (!result.ok) return sendResult(c, result);
  const member = result.payload.members.find((m) => m.userId === targetUserId);
  if (member) {
    emit(roomId, 'member:state', {
      roomId,
      userId: targetUserId,
      micOn: member.micOn,
      cameraOn: member.cameraOn,
      screenShareOn: member.screenShareOn,
      moderatedBy: actorUserId,
    });
  }
  return c.json({ room: result.payload });
});

rooms.post('/:id/members/:userId/camera', async (c) => {
  const roomId = c.req.param('id');
  const actorUserId = c.get('userId');
  const targetUserId = c.req.param('userId');
  const body = await readJson(c);
  if (!body || typeof body.enabled !== 'boolean') {
    return c.json(apiError('VALIDATION_ERROR', 'enabled (boolean) is required.'), 400);
  }

  const result = setMemberCamera(roomId, actorUserId, targetUserId, body.enabled);
  if (!result.ok) return sendResult(c, result);
  const member = result.payload.members.find((m) => m.userId === targetUserId);
  if (member) {
    emit(roomId, 'member:state', {
      roomId,
      userId: targetUserId,
      micOn: member.micOn,
      cameraOn: member.cameraOn,
      screenShareOn: member.screenShareOn,
      moderatedBy: actorUserId,
    });
  }
  return c.json({ room: result.payload });
});

// ─── GET /api/rooms/:id/events — SSE stream ─────────────────────────────────

rooms.get('/:id/events', (c) => {
  const roomId = c.req.param('id');
  const userId = c.get('userId');

  const room = getRoomOrNull(roomId);
  if (!room || room.emptySince) {
    return c.json(apiError('ROOM_GONE', 'This room has expired or was deleted.'), 404);
  }
  if (room.privacy === 'private' && !isRoomMember(roomId, userId)) {
    return c.json(apiError('ROOM_MEMBERSHIP_REQUIRED', 'This is a private room.'), 403);
  }

  const afterId = Number(c.req.header('last-event-id') ?? '0') || 0;
  const { events: replay, truncated } = replayEventsWithMeta(roomId, afterId);
  const encoder = new TextEncoder();
  let cleanupHub: (() => void) | null = null;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // Register the live sink BEFORE enqueueing replay so no live events are
      // missed; the client deduplicates by persisted event id.
      cleanupHub = openEventStream(
        roomId,
        userId,
        c.req.raw.signal,
        {
          enqueue: (chunk) => controller.enqueue(chunk),
          close: () => controller.close(),
        },
        () => {
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      );

      // The client's cursor fell outside the replay window: replay alone cannot
      // reconstruct room state. Emit an explicit resync marker (non-persisted)
      // before the replay frames so the client refetches authoritative state.
      if (truncated && afterId > 0) {
        controller.enqueue(
          encoder.encode(`event: room:resync\ndata: {"reason":"replay-window-truncated"}\n\n`)
        );
      }
      for (const ev of replay) {
        controller.enqueue(
          encoder.encode(`id: ${ev.id}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev.payload)}\n\n`)
        );
      }
    },
    cancel() {
      cleanupHub?.();
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

export { rooms, uploadsDir };