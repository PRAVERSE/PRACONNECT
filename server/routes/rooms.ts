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
  cleanupEmptyRooms,
  RoomErrors,
} from '../rooms/service';
import type { MediaInput, RoomPayload, RoomError } from '../rooms/service';
import { emit, emitEphemeral, openEventStream, replayEvents } from '../rooms/realtime';

const uploadsDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
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
  return c.json({ room: payload }, 201);
});

// ─── POST /api/rooms/:id/join ────────────────────────────────────────────────

rooms.post('/:id/join', (c) => {
  const roomId = c.req.param('id');
  const userId = c.get('userId');
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

rooms.post('/:id/media', async (c) => {
  const roomId = c.req.param('id');
  const userId = c.get('userId');
  const guard = activeMemberGuard(c, roomId, userId);
  if (guard) return guard;

  const body = await readJson(c);
  let media: MediaInput | null = null;
  if (body && typeof body.url === 'string' && body.url.trim() !== '') {
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

    media = {
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Untitled stream',
      url,
      poster: typeof body.poster === 'string' ? body.poster : undefined,
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
  const reqContentLength = c.req.header('content-length');
  console.log('[Diagnostics] [Server Upload Route Content-Length header]:', reqContentLength);

  const roomId = c.req.param('id');
  const userId = c.get('userId');
  const guard = activeMemberGuard(c, roomId, userId);
  if (guard) return guard;

  const room = getRoomOrNull(roomId);
  if (!room) return c.json(apiError('ROOM_NOT_FOUND', 'Room not found.'), 404);
  if (room.hostUserId !== userId) {
    return c.json(apiError('NOT_HOST', 'Only the room host can upload media.'), 403);
  }

  try {
    const formData = await c.req.parseBody();
    const rawFile = formData['file'];

    if (!rawFile || typeof rawFile === 'string' || typeof (rawFile as any).arrayBuffer !== 'function') {
      return c.json(apiError('VALIDATION_ERROR', 'Please provide a valid video file in the file field.'), 400);
    }

    const file = rawFile as File | Blob;
    const originalName = typeof (file as any).name === 'string' ? (file as any).name : 'movie.mp4';
    const ext = path.extname(originalName).toLowerCase() || '.mp4';
    const allowedExts = ['.mp4', '.webm', '.mov'];

    console.log('[Diagnostics] [Server Upload Parsed File]:', {
      name: originalName,
      fileSizeProperty: file.size,
      ext,
    });

    if (file.size === 0) {
      return c.json(
        apiError('EMPTY_FILE', 'The uploaded file is empty (0 bytes). Please upload a valid video file.'),
        400
      );
    }

    // Size limit: 1.5GB
    const MAX_SIZE = 1.5 * 1024 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return c.json(apiError('FILE_TOO_LARGE', 'Uploaded movie exceeds maximum allowed size of 1.5GB.'), 400);
    }

    // Read ArrayBuffer ONCE into Buffer and reuse for inspection & writing
    const buffer = Buffer.from(await file.arrayBuffer());
    console.log('[Diagnostics] [Server Buffer Read Size]:', buffer.length, 'bytes');

    if (buffer.length === 0) {
      return c.json(
        apiError('EMPTY_FILE', 'The uploaded file content is 0 bytes on disk. Please re-select the file.'),
        400
      );
    }

    const detectedContainer = inspectVideoContainer(buffer);
    console.log('[Diagnostics] [Server Detected Container]:', detectedContainer);

    // Reject formats outside allowed containers/extensions
    const isDisallowedContainer = ['mkv', 'avi', 'wmv', 'ogv'].includes(detectedContainer);
    if (!allowedExts.includes(ext) || isDisallowedContainer) {
      const displayExt =
        ext === '.mkv' || detectedContainer === 'mkv'
          ? '.mkv'
          : ext === '.avi' || detectedContainer === 'avi'
          ? '.avi'
          : ext === '.wmv' || detectedContainer === 'wmv'
          ? '.wmv'
          : ext;
      return c.json(
        apiError(
          'INVALID_MEDIA_TYPE',
          `This file format (${displayExt}) isn't supported for playback. Please upload MP4 or WebM.`
        ),
        400
      );
    }

    const safeId = crypto.randomUUID().slice(0, 12);
    const safeFilename = `media-${Date.now()}-${safeId}${ext}`;
    const destination = path.join(uploadsDir, safeFilename);

    fs.writeFileSync(destination, buffer);

    const media: MediaInput = {
      title: originalName.replace(/\.[^/.]+$/, ''),
      url: `/api/uploads/${safeFilename}`,
      poster: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800&q=80',
      type: 'video',
    };

    const result = setRoomMedia(roomId, userId, media);
    if (!result.ok) return sendResult(c, result);

    emit(result.payload.id, 'room:update', { room: result.payload });
    return c.json({ ok: true, room: result.payload, media });
  } catch (err: any) {
    console.error('[rooms] Media upload error:', err);
    return c.json(apiError('UPLOAD_FAILED', `Failed to upload media file: ${err.message || 'Server error'}`), 500);
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
    reaction: typeof body.reaction === 'string' ? body.reaction : undefined,
  };

  emit(room.id, 'chat:message', message);
  return c.json({ message }, 201);
});

// ─── WebRTC Signaling ───────────────────────────────────────────────────────

rooms.post('/:id/signal', async (c) => {
  const roomId = c.req.param('id');
  const userId = c.get('userId');
  const guard = activeMemberGuard(c, roomId, userId);
  if (guard) return guard;

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
  const replay = replayEvents(roomId, afterId);
  const encoder = new TextEncoder();
  let cleanupHub: (() => void) | null = null;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // Replay missed events BEFORE any live frames, so ordering holds.
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

export { rooms };