// server/rooms/service.ts
// Phase 3: authoritative room state. All room mutations happen here.
// Every privileged mutation is guarded by explicit checks (membership, host).

import { db } from '../db/index';
import { generateId } from '../auth/auth';

// Empty-room timeout: 5 minutes by default, overridable via ROOM_EMPTY_TTL_MS
export const ROOM_EMPTY_TTL_MS = Math.max(
  1000,
  parseInt(process.env.ROOM_EMPTY_TTL_MS ?? '300000', 10) || 300000
);

// ─── Row shapes ──────────────────────────────────────────────────────────────

interface RoomRow {
  id: string;
  name: string;
  code: string;
  hostUserId: string;
  category: string;
  privacy: string;
  maxParticipants: number;
  status: string;
  currentMediaJson: string | null;
  playbackStateJson: string | null;
  screenShareActive: number;
  description: string | null;
  createdAt: string;
  lastActivityAt: string;
  emptySince: string | null;
}

interface MemberRow {
  id: string;
  roomId: string;
  userId: string;
  role: string;
  micOn: number;
  cameraOn: number;
  screenShareOn: number;
  joinedAt: string;
  leftAt: string | null;
  removedAt: string | null;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export interface RoomError {
  code: string;
  message: string;
}

export const RoomErrors = {
  notFound: (): RoomError => ({ code: 'ROOM_NOT_FOUND', message: 'Room not found.' }),
  gone: (): RoomError => ({ code: 'ROOM_GONE', message: 'This room has expired or was deleted.' }),
  full: (): RoomError => ({ code: 'ROOM_FULL', message: 'This room is at full capacity.' }),
  notMember: (): RoomError => ({ code: 'ROOM_MEMBERSHIP_REQUIRED', message: 'You are not a member of this room.' }),
  notHost: (): RoomError => ({ code: 'NOT_HOST', message: 'Only the host can perform this action.' }),
  invalidTarget: (): RoomError => ({ code: 'INVALID_TARGET', message: 'Target user is not a member of this room.' }),
  removed: (): RoomError => ({ code: 'REMOVED_FROM_ROOM', message: 'You were removed from this room by the host.' }),
  validation: (message: string): RoomError => ({ code: 'VALIDATION_ERROR', message }),
};

// ─── Internal helpers ────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function getRoom(roomIdOrCode: string): RoomRow | null {
  return (
    (db
      .prepare('SELECT * FROM rooms WHERE id = ? OR code = ? COLLATE NOCASE')
      .get(roomIdOrCode, roomIdOrCode) as RoomRow | undefined) ?? null
  );
}

function getMember(roomId: string, userId: string): MemberRow | null {
  return (
    db
      .prepare('SELECT * FROM roomMembers WHERE roomId = ? AND userId = ?')
      .get(roomId, userId) as MemberRow | undefined
  ) ?? null;
}

function activeMemberCount(roomId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM roomMembers WHERE roomId = ? AND leftAt IS NULL')
    .get(roomId) as { n: number };
  return row.n;
}

function touchActivity(roomId: string): void {
  db.prepare('UPDATE rooms SET lastActivityAt = ? WHERE id = ?').run(nowIso(), roomId);
}

// ─── Public payload shapes (sanitized) ───────────────────────────────────────

export interface RoomMemberPayload {
  id: string;
  userId: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  role: 'host' | 'member';
  micOn: boolean;
  cameraOn: boolean;
  screenShareOn: boolean;
  joinedAt: string;
}

export interface RoomPayload {
  id: string;
  name: string;
  code: string;
  hostUserId: string;
  host: { id: string; name: string; username: string; avatarUrl: string | null };
  category: string;
  privacy: string;
  maxParticipants: number;
  memberCount: number;
  status: string;
  currentMedia: { title: string; url: string; poster?: string; duration?: number; type?: string } | null;
  playback: { isPlaying: boolean; position: number; updatedAt: string };
  screenShareActive: boolean;
  description: string | null;
  createdAt: string;
  lastActivityAt: string;
  emptySince: string | null;
  members: RoomMemberPayload[];
  isHost: boolean;
}

function memberPayload(m: MemberRow): RoomMemberPayload {
  const user = db
    .prepare('SELECT id, name, username, avatarUrl FROM users WHERE id = ?')
    .get(m.userId) as { id: string; name: string; username: string; avatarUrl: string | null } | undefined;
  return {
    id: m.id,
    userId: m.userId,
    name: user?.name ?? 'Unknown',
    username: user?.username ?? 'user',
    avatarUrl: user?.avatarUrl ?? null,
    role: m.role === 'host' ? 'host' : 'member',
    micOn: m.micOn === 1,
    cameraOn: m.cameraOn === 1,
    screenShareOn: m.screenShareOn === 1,
    joinedAt: m.joinedAt,
  };
}

function parseMedia(json: string | null): RoomPayload['currentMedia'] {
  if (!json) return null;
  try {
    const m = JSON.parse(json);
    if (!m || typeof m.url !== 'string') return null;
    return {
      title: typeof m.title === 'string' ? m.title : 'Untitled',
      url: m.url,
      poster: typeof m.poster === 'string' ? m.poster : undefined,
      duration: typeof m.duration === 'number' ? m.duration : undefined,
      type: typeof m.type === 'string' ? m.type : undefined,
    };
  } catch {
    return null;
  }
}

export function roomPayload(roomId: string, viewerUserId: string | null): RoomPayload | null {
  const room = getRoom(roomId);
  if (!room) return null;
  const host = db
    .prepare('SELECT id, name, username, avatarUrl FROM users WHERE id = ?')
    .get(room.hostUserId) as { id: string; name: string; username: string; avatarUrl: string | null } | undefined;

  const members = (db
    .prepare('SELECT * FROM roomMembers WHERE roomId = ? AND leftAt IS NULL ORDER BY joinedAt ASC')
    .all(roomId) as MemberRow[]).map(memberPayload);

  const playback = (() => {
    try {
      const p = room.playbackStateJson ? JSON.parse(room.playbackStateJson) : null;
      return {
        isPlaying: Boolean(p?.isPlaying),
        position: typeof p?.position === 'number' ? p.position : 0,
        updatedAt: typeof p?.updatedAt === 'string' ? p.updatedAt : room.lastActivityAt,
      };
    } catch {
      return { isPlaying: false, position: 0, updatedAt: room.lastActivityAt };
    }
  })();

  return {
    id: room.id,
    name: room.name,
    code: room.code,
    hostUserId: room.hostUserId,
    host: host
      ? { id: host.id, name: host.name, username: host.username, avatarUrl: host.avatarUrl }
      : { id: room.hostUserId, name: 'Unknown', username: 'user', avatarUrl: null },
    category: room.category,
    privacy: room.privacy,
    maxParticipants: room.maxParticipants,
    memberCount: members.length,
    status: room.status,
    currentMedia: parseMedia(room.currentMediaJson),
    playback,
    screenShareActive: room.screenShareActive === 1,
    description: room.description,
    createdAt: room.createdAt,
    lastActivityAt: room.lastActivityAt,
    emptySince: room.emptySince,
    members,
    isHost: viewerUserId !== null && viewerUserId === room.hostUserId,
  };
}

export function listRoomPayloads(viewerUserId: string | null): RoomPayload[] {
  const rows = db
    .prepare(
      `SELECT r.* FROM rooms r
       WHERE r.emptySince IS NULL
         AND (r.privacy = 'public'
              OR EXISTS (SELECT 1 FROM roomMembers m WHERE m.roomId = r.id AND m.userId = ? AND m.leftAt IS NULL))
       ORDER BY r.lastActivityAt DESC`
    )
    .all(viewerUserId ?? '') as RoomRow[];
  return rows
    .map((r) => roomPayload(r.id, viewerUserId))
    .filter((p): p is RoomPayload => p !== null);
}

// ─── Code generation ─────────────────────────────────────────────────────────

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode(): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    const exists = db.prepare('SELECT id FROM rooms WHERE code = ?').get(code);
    if (!exists) return code;
  }
  throw new Error('Unable to generate a unique room code.');
}

// ─── Create / join / leave ───────────────────────────────────────────────────

export interface CreateRoomInput {
  name: string;
  category: string;
  privacy: string;
  maxParticipants: number;
  description?: string;
}

export function createRoom(hostUserId: string, input: CreateRoomInput): RoomPayload {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 100) throw RoomErrors.validation('Room name must be 1-100 characters.');
  const max = Math.max(2, Math.min(50, Number(input.maxParticipants) || 8));
  const privacy = input.privacy === 'private' ? 'private' : 'public';
  const category = ['Movie', 'Gaming', 'Study', 'Music', 'Other'].includes(input.category)
    ? input.category
    : 'Other';

  const now = nowIso();
  const roomId = generateId();
  const code = generateRoomCode();

  db.prepare(
    `INSERT INTO rooms (id, name, code, hostUserId, category, privacy, maxParticipants, status, description, createdAt, lastActivityAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'LIVE', ?, ?, ?)`
  ).run(roomId, name, code, hostUserId, category, privacy, max, input.description?.trim() || null, now, now);

  db.prepare(
    `INSERT INTO roomMembers (id, roomId, userId, role, micOn, cameraOn, screenShareOn, joinedAt)
     VALUES (?, ?, ?, 'host', 0, 0, 0, ?)`
  ).run(generateId(), roomId, hostUserId, now);

  touchActivity(roomId);
  return roomPayload(roomId, hostUserId)!;
}

export function joinRoom(roomIdOrCode: string, userId: string): { ok: true; payload: RoomPayload } | { ok: false; error: RoomError } {
  const room = getRoom(roomIdOrCode);
  if (!room) return { ok: false, error: RoomErrors.notFound() };

  const existing = getMember(room.id, userId);
  if (existing && !existing.leftAt) {
    // Already a member — refresh activity and return current state.
    touchActivity(room.id);
    return { ok: true, payload: roomPayload(room.id, userId)! };
  }

  // A host-removed member cannot re-enter by reconnecting. Only an ordinary
  // leave (leftAt set, removedAt NULL) may be reversed by a fresh join.
  if (existing?.removedAt) {
    return { ok: false, error: RoomErrors.removed() };
  }

  const currentActives = activeMemberCount(room.id);
  if (currentActives >= room.maxParticipants) {
    return { ok: false, error: RoomErrors.full() };
  }

  const now = nowIso();
  const shouldBeHost = currentActives === 0;

  if (existing && existing.leftAt) {
    db.prepare(
      `UPDATE roomMembers SET leftAt = NULL, joinedAt = ?, role = ?, micOn = 0, cameraOn = 0, screenShareOn = 0 WHERE id = ?`
    ).run(now, shouldBeHost ? 'host' : 'member', existing.id);
  } else {
    db.prepare(
      `INSERT INTO roomMembers (id, roomId, userId, role, micOn, cameraOn, screenShareOn, joinedAt)
       VALUES (?, ?, ?, ?, 0, 0, 0, ?)`
    ).run(generateId(), room.id, userId, shouldBeHost ? 'host' : 'member', now);
  }

  // Cancels empty-room cleanup.
  if (shouldBeHost) {
    db.prepare('UPDATE rooms SET hostUserId = ?, emptySince = NULL, lastActivityAt = ? WHERE id = ?').run(userId, now, room.id);
  } else {
    db.prepare('UPDATE rooms SET emptySince = NULL, lastActivityAt = ? WHERE id = ?').run(now, room.id);
  }

  return { ok: true, payload: roomPayload(room.id, userId)! };
}

export function leaveRoom(roomId: string, userId: string): { ok: true; payload: RoomPayload } | { ok: false; error: RoomError } {
  const room = getRoom(roomId);
  if (!room) return { ok: false, error: RoomErrors.notFound() };

  const member = getMember(roomId, userId);
  if (!member || member.leftAt) return { ok: false, error: RoomErrors.notMember() };

  const now = nowIso();
  db.prepare('UPDATE roomMembers SET leftAt = ?, micOn = 0, cameraOn = 0, screenShareOn = 0 WHERE id = ?').run(
    now,
    member.id
  );

  const remaining = activeMemberCount(roomId);

  if (room.hostUserId === userId) {
    // Host left. Deterministic server-side transfer: earliest-joined active member.
    const nextHost = (db
      .prepare('SELECT * FROM roomMembers WHERE roomId = ? AND leftAt IS NULL ORDER BY joinedAt ASC, id ASC LIMIT 1')
      .get(roomId) as MemberRow | undefined) ?? null;

    // The host's screen share dies with the host's session: reset the flag so
    // guests do not stay stuck on the screen-share stage / placeholder.
    if (room.screenShareActive === 1) {
      db.prepare('UPDATE rooms SET screenShareActive = 0 WHERE id = ?').run(roomId);
    }

    if (nextHost) {
      db.prepare('UPDATE rooms SET hostUserId = ?, lastActivityAt = ? WHERE id = ?').run(nextHost.userId, now, roomId);
      db.prepare('UPDATE roomMembers SET role = ? WHERE id = ?').run('host', nextHost.id);
    }
  }

  if (remaining === 0) {
    db.prepare('UPDATE rooms SET emptySince = ?, lastActivityAt = ? WHERE id = ?').run(now, now, roomId);
  } else {
    touchActivity(roomId);
  }

  return { ok: true, payload: roomPayload(roomId, null)! };
}

// ─── Moderation (host only) ──────────────────────────────────────────────────

export function removeMember(
  roomId: string,
  hostUserId: string,
  targetUserId: string
): { ok: true; payload: RoomPayload } | { ok: false; error: RoomError } {
  const room = getRoom(roomId);
  if (!room) return { ok: false, error: RoomErrors.notFound() };
  if (room.hostUserId !== hostUserId) return { ok: false, error: RoomErrors.notHost() };
  if (targetUserId === hostUserId) return { ok: false, error: RoomErrors.invalidTarget() };

  const target = getMember(roomId, targetUserId);
  if (!target || target.leftAt) return { ok: false, error: RoomErrors.invalidTarget() };

  const now = nowIso();
  db.prepare(
    'UPDATE roomMembers SET leftAt = ?, removedAt = ?, micOn = 0, cameraOn = 0, screenShareOn = 0 WHERE id = ?'
  ).run(now, now, target.id);
  touchActivity(roomId);
  return { ok: true, payload: roomPayload(roomId, hostUserId)! };
}

function setMemberDeviceState(
  roomId: string,
  actorUserId: string,
  targetUserId: string,
  patch: { micOn?: boolean; cameraOn?: boolean }
): { ok: true; payload: RoomPayload } | { ok: false; error: RoomError } {
  const room = getRoom(roomId);
  if (!room) return { ok: false, error: RoomErrors.notFound() };
  if (room.hostUserId !== actorUserId) return { ok: false, error: RoomErrors.notHost() };

  const target = getMember(roomId, targetUserId);
  if (!target || target.leftAt) return { ok: false, error: RoomErrors.invalidTarget() };

  const micOn = patch.micOn !== undefined ? (patch.micOn ? 1 : 0) : target.micOn;
  const cameraOn = patch.cameraOn !== undefined ? (patch.cameraOn ? 1 : 0) : target.cameraOn;
  db.prepare('UPDATE roomMembers SET micOn = ?, cameraOn = ? WHERE id = ?').run(micOn, cameraOn, target.id);
  touchActivity(roomId);
  return { ok: true, payload: roomPayload(roomId, actorUserId)! };
}

export function muteMember(
  roomId: string,
  hostUserId: string,
  targetUserId: string,
  muted: boolean
): { ok: true; payload: RoomPayload } | { ok: false; error: RoomError } {
  return setMemberDeviceState(roomId, hostUserId, targetUserId, { micOn: !muted });
}

export function setMemberCamera(
  roomId: string,
  hostUserId: string,
  targetUserId: string,
  enabled: boolean
): { ok: true; payload: RoomPayload } | { ok: false; error: RoomError } {
  return setMemberDeviceState(roomId, hostUserId, targetUserId, { cameraOn: enabled });
}

/** Participant updates their own device state. */
export function setSelfState(
  roomId: string,
  userId: string,
  patch: { micOn?: boolean; cameraOn?: boolean }
): { ok: true; payload: RoomPayload } | { ok: false; error: RoomError } {
  const room = getRoom(roomId);
  if (!room) return { ok: false, error: RoomErrors.notFound() };
  const member = getMember(roomId, userId);
  if (!member || member.leftAt) return { ok: false, error: RoomErrors.removed() };

  const micOn = patch.micOn !== undefined ? (patch.micOn ? 1 : 0) : member.micOn;
  const cameraOn = patch.cameraOn !== undefined ? (patch.cameraOn ? 1 : 0) : member.cameraOn;
  db.prepare('UPDATE roomMembers SET micOn = ?, cameraOn = ? WHERE id = ?').run(micOn, cameraOn, member.id);
  touchActivity(roomId);
  return { ok: true, payload: roomPayload(roomId, userId)! };
}

// ─── Host media controls ─────────────────────────────────────────────────────

export interface MediaInput {
  title: string;
  url: string;
  poster?: string;
  duration?: number;
  type?: string;
}

export function setRoomMedia(
  roomId: string,
  hostUserId: string,
  media: MediaInput | null
): { ok: true; payload: RoomPayload } | { ok: false; error: RoomError } {
  const room = getRoom(roomId);
  if (!room) return { ok: false, error: RoomErrors.notFound() };
  if (room.hostUserId !== hostUserId) return { ok: false, error: RoomErrors.notHost() };

  const json = media
    ? JSON.stringify({ title: media.title, url: media.url, poster: media.poster, duration: media.duration, type: media.type })
    : null;
  db.prepare('UPDATE rooms SET currentMediaJson = ?, lastActivityAt = ? WHERE id = ?').run(json, nowIso(), roomId);
  return { ok: true, payload: roomPayload(roomId, hostUserId)! };
}

export interface PlaybackInput {
  isPlaying: boolean;
  position?: number;
}

export function setPlayback(
  roomId: string,
  hostUserId: string,
  input: PlaybackInput
): { ok: true; payload: RoomPayload } | { ok: false; error: RoomError } {
  const room = getRoom(roomId);
  if (!room) return { ok: false, error: RoomErrors.notFound() };
  if (room.hostUserId !== hostUserId) return { ok: false, error: RoomErrors.notHost() };

  const current = (() => {
    try {
      return room.playbackStateJson ? JSON.parse(room.playbackStateJson) : { isPlaying: false, position: 0 };
    } catch {
      return { isPlaying: false, position: 0 };
    }
  })();
  const position = typeof input.position === 'number' && input.position >= 0 ? input.position : current.position ?? 0;
  const state = { isPlaying: Boolean(input.isPlaying), position, updatedAt: nowIso() };
  db.prepare('UPDATE rooms SET playbackStateJson = ?, lastActivityAt = ? WHERE id = ?').run(
    JSON.stringify(state),
    state.updatedAt,
    roomId
  );
  return { ok: true, payload: roomPayload(roomId, hostUserId)! };
}

export function setScreenShare(
  roomId: string,
  hostUserId: string,
  active: boolean
): { ok: true; payload: RoomPayload } | { ok: false; error: RoomError } {
  const room = getRoom(roomId);
  if (!room) return { ok: false, error: RoomErrors.notFound() };
  if (room.hostUserId !== hostUserId) return { ok: false, error: RoomErrors.notHost() };

  db.prepare('UPDATE rooms SET screenShareActive = ?, lastActivityAt = ? WHERE id = ?').run(
    active ? 1 : 0,
    nowIso(),
    roomId
  );
  // Keep the host member's per-user flag in sync so participant objects
  // broadcast to guests carry screenShareOn = true while sharing.
  db.prepare('UPDATE roomMembers SET screenShareOn = ? WHERE roomId = ? AND userId = ?').run(
    active ? 1 : 0,
    roomId,
    hostUserId
  );
  return { ok: true, payload: roomPayload(roomId, hostUserId)! };
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

/** Deletes rooms that have been empty longer than the TTL. Returns deleted room ids. */
export function cleanupEmptyRooms(now = Date.now()): string[] {
  const cutoff = new Date(now - ROOM_EMPTY_TTL_MS).toISOString();
  const rows = db
    .prepare('SELECT id FROM rooms WHERE emptySince IS NOT NULL AND emptySince < ?')
    .all(cutoff) as { id: string }[];

  const deleteRoom = db.prepare('DELETE FROM rooms WHERE id = ?');
  const deleteEvents = db.prepare('DELETE FROM roomEvents WHERE roomId = ?');
  const deleteMembers = db.prepare('DELETE FROM roomMembers WHERE roomId = ?');
  const deleted: string[] = [];

  for (const row of rows) {
    deleteMembers.run(row.id);
    deleteEvents.run(row.id);
    deleteRoom.run(row.id);
    deleted.push(row.id);
  }
  return deleted;
}

// ─── Membership verification for route guards ────────────────────────────────

export function isRoomMember(roomIdOrCode: string, userId: string): boolean {
  const room = getRoom(roomIdOrCode);
  if (!room) return false;
  const member = getMember(room.id, userId);
  return Boolean(member && !member.leftAt);
}

/** 'active' = currently in the room, 'removed' = was in it but left/was removed, 'none' = never a member. */
export function memberStatus(roomIdOrCode: string, userId: string): 'active' | 'removed' | 'none' {
  const room = getRoom(roomIdOrCode);
  if (!room) return 'none';
  const member = getMember(room.id, userId);
  if (!member) return 'none';
  return member.leftAt ? 'removed' : 'active';
}

export function getRoomOrNull(roomIdOrCode: string): RoomRow | null {
  return getRoom(roomIdOrCode);
}