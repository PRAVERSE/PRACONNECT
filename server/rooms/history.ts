// server/rooms/history.ts
// Phase 6.11: persistent room history / user statistics.
//
// Active room state (rooms, roomMembers, roomEvents, uploads) is deleted by
// the 5-minute empty-room cleanup. These functions maintain the durable
// roomHistory / roomHistoryMembers records that survive that deletion, so
// profile/dashboard statistics ("hosted rooms", "watched rooms", watch time)
// never depend on an active room row being alive.
//
// Semantics:
// - One roomHistory row per room session (room ids are random and never
//   reused; a UNIQUE index on roomId keeps backfill/migration idempotent).
// - One roomHistoryMembers row per (history, user). Reconnects, refreshes and
//   re-joins update that same row — they never duplicate a participation.
//   durationSeconds accumulates across join/leave intervals, so a user present
//   10:00 → 10:45 records 2700s even if they briefly disconnected and rejoined.
// - endedAt = when the room permanently ended (last member left), NOT the
//   timestamp of the 5-minute cleanup, so the empty-room grace period never
//   inflates durations.

import { db } from '../db/index';
import { generateId } from '../auth/auth';

// ─── Row shapes ──────────────────────────────────────────────────────────────

export interface HistoryRoomInput {
  id: string;
  name: string;
  code: string;
  hostUserId: string;
  category: string;
  maxParticipants: number;
  currentMediaJson: string | null;
  createdAt: string;
  emptySince: string | null;
}

interface HistoryMemberRow {
  id: string;
  historyId: string;
  roomId: string;
  userId: string;
  role: string;
  joinedAt: string;
  leftAt: string | null;
  durationSeconds: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function floorSeconds(startIso: string | null, endIso: string | null): number {
  if (!startIso || !endIso) return 0;
  const diff = Date.parse(endIso) - Date.parse(startIso);
  return diff > 0 ? Math.floor(diff / 1000) : 0;
}

function parseMediaTitle(json: string | null): { title: string | null; mediaType: string | null } {
  if (!json) return { title: null, mediaType: null };
  try {
    const m = JSON.parse(json);
    return {
      title: typeof m?.title === 'string' && m.title.trim() ? m.title : null,
      mediaType: typeof m?.mediaType === 'string' ? m.mediaType : null,
    };
  } catch {
    return { title: null, mediaType: null };
  }
}

function getHistoryIdForRoom(roomId: string): string | null {
  const row = db.prepare('SELECT id FROM roomHistory WHERE roomId = ?').get(roomId) as
    | { id: string }
    | undefined;
  return row?.id ?? null;
}

function getHistoryMember(historyId: string, userId: string): HistoryMemberRow | null {
  return (
    (db
      .prepare('SELECT * FROM roomHistoryMembers WHERE historyId = ? AND userId = ?')
      .get(historyId, userId) as HistoryMemberRow | undefined) ?? null
  );
}

// ─── Room session record ─────────────────────────────────────────────────────

/**
 * Create the durable room/session record at room creation time. Idempotent per
 * roomId: if the row already exists (e.g. backfill or a restarted request) the
 * insert is a no-op and only the host's participation row is topped up.
 * The host's own participation is recorded as role 'host'.
 */
export function createRoomHistory(room: HistoryRoomInput): void {
  const media = parseMediaTitle(room.currentMediaJson);
  db.prepare(
    `INSERT OR IGNORE INTO roomHistory
       (id, roomId, roomCode, roomName, hostUserId, category, createdAt, participantCount, maxParticipants, createdMediaTitle, createdMediaType)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
  ).run(
    room.id,
    room.id,
    room.code,
    room.name,
    room.hostUserId,
    room.category,
    room.createdAt,
    room.maxParticipants,
    media.title,
    media.mediaType
  );
  recordHistoryJoin(room.id, room.hostUserId, 'host', room.createdAt);
}

/**
 * Record (or refresh) a user's historical participation in a room session.
 * - First join: inserts a row with the given role.
 * - Re-join after leaving: reopens the SAME row (leftAt -> NULL, new joinedAt,
 *   role updated) — no duplicate participation record, durations accumulate.
 * - Already active (SSE reconnect, duplicate join): no-op — nothing is
 *   double-counted.
 */
export function recordHistoryJoin(roomId: string, userId: string, role: string, joinedAt: string): void {
  const historyId = getHistoryIdForRoom(roomId);
  if (!historyId) return;
  const existing = getHistoryMember(historyId, userId);
  if (!existing) {
    db.prepare(
      `INSERT INTO roomHistoryMembers (id, historyId, roomId, userId, role, joinedAt, leftAt, durationSeconds)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 0)`
    ).run(generateId(), historyId, roomId, userId, role, joinedAt);
    return;
  }
  if (existing.leftAt === null) return; // already active — reconnect, not a new session
  db.prepare(
    'UPDATE roomHistoryMembers SET leftAt = NULL, joinedAt = ?, role = ? WHERE id = ?'
  ).run(joinedAt, role, existing.id);
}

/**
 * Finalize a user's historical participation (leave / host leave / removal):
 * closes the open interval and accumulates its duration. Never inflates with
 * the empty-room TTL or with time after the user actually left.
 */
export function recordHistoryLeave(roomId: string, userId: string, leftAt: string): void {
  const historyId = getHistoryIdForRoom(roomId);
  if (!historyId) return;
  const member = getHistoryMember(historyId, userId);
  if (!member || member.leftAt !== null) return;
  const added = floorSeconds(member.joinedAt, leftAt);
  db.prepare(
    'UPDATE roomHistoryMembers SET leftAt = ?, durationSeconds = durationSeconds + ? WHERE id = ?'
  ).run(leftAt, added, member.id);
}

/**
 * Mark the room session as ended (last member left). endedAt is the moment the
 * room became permanently empty — NOT the later 5-minute cleanup. Idempotent:
 * once ended, a second call does not move the timestamp or double-count.
 * participantCount is snapshotted from the durable participation rows.
 */
export function markRoomHistoryEnded(roomId: string, endedAt: string): void {
  const historyId = getHistoryIdForRoom(roomId);
  if (!historyId) return;
  const row = db
    .prepare('SELECT createdAt FROM roomHistory WHERE id = ?')
    .get(historyId) as { createdAt: string } | undefined;
  if (!row) return;
  const durationSeconds = floorSeconds(row.createdAt, endedAt);
  const participants = (
    db.prepare('SELECT COUNT(*) AS n FROM roomHistoryMembers WHERE historyId = ?').get(historyId) as { n: number }
  ).n;
  db.prepare(
    `UPDATE roomHistory
     SET endedAt = COALESCE(endedAt, ?), emptySince = COALESCE(emptySince, ?),
         durationSeconds = CASE WHEN endedAt IS NULL THEN ? ELSE durationSeconds END,
         participantCount = ?
     WHERE id = ?`
  ).run(endedAt, endedAt, durationSeconds, participants, historyId);
}

/**
 * A room that was empty is revived before cleanup: clear the "ended" markers
 * so the session is not falsely recorded as permanently ended, and its final
 * endedAt / duration reflect the true lifecycle.
 */
export function resumeRoomHistory(roomId: string): void {
  const historyId = getHistoryIdForRoom(roomId);
  if (!historyId) return;
  db.prepare('UPDATE roomHistory SET endedAt = NULL, emptySince = NULL WHERE id = ?').run(historyId);
}

/**
 * Safety net called by the cleanup worker just before an expired room row is
 * deleted: guarantees the history row is marked ended and any participant rows
 * that never got a leave (server restart mid-session, crashed disconnect) are
 * closed at the moment the room became empty. Historical rows themselves are
 * NEVER deleted.
 */
export function finalizeRoomHistory(roomId: string, emptySince: string): void {
  const historyId = getHistoryIdForRoom(roomId);
  if (!historyId) return;
  markRoomHistoryEnded(roomId, emptySince);
  db.prepare(
    `UPDATE roomHistoryMembers
     SET leftAt = ?,
         durationSeconds = durationSeconds + CAST((julianday(?) - julianday(joinedAt)) * 86400 AS INTEGER)
     WHERE historyId = ? AND leftAt IS NULL`
  ).run(emptySince, emptySince, historyId);
}

/** Record the first media published in the room on the history row (title only). */
export function updateRoomHistoryMedia(roomId: string, mediaJson: string | null): void {
  const historyId = getHistoryIdForRoom(roomId);
  if (!historyId) return;
  const media = parseMediaTitle(mediaJson);
  if (!media.title) return;
  db.prepare(
    'UPDATE roomHistory SET createdMediaTitle = COALESCE(createdMediaTitle, ?), createdMediaType = COALESCE(createdMediaType, ?) WHERE id = ?'
  ).run(media.title, media.mediaType, historyId);
}

// ─── Statistics (server-authoritative) ───────────────────────────────────────

export interface RoomHistoryEntry {
  id: string;
  roomId: string;
  roomCode: string;
  roomName: string;
  role: 'host' | 'member';
  hostUserId: string;
  hostName: string;
  category: string;
  createdAt: string;
  emptySince: string | null;
  endedAt: string | null;
  durationSeconds: number;
  participantCount: number;
  maxParticipants: number;
  createdMediaTitle: string | null;
  createdMediaType: string | null;
}

export interface UserRoomStats {
  hostedRooms: number;
  joinedRooms: number;
  totalWatchSeconds: number;
  recentRooms: RoomHistoryEntry[];
}

/**
 * Aggregate the authenticated user's statistics from durable history only.
 * - hostedRooms: rooms the user created (roomHistory.hostUserId).
 * - joinedRooms: rooms the user participated in (roomHistoryMembers), which
 *   includes rooms they hosted — a host is a participant of their own room.
 * - totalWatchSeconds: accumulated participation duration; excludes the
 *   empty-room grace period and any time after the user left.
 * - recentRooms: the user's recent sessions, newest first.
 */
export function getUserRoomStats(userId: string): UserRoomStats {
  const hosted = db
    .prepare('SELECT COUNT(*) AS n FROM roomHistory WHERE hostUserId = ?')
    .get(userId) as { n: number };
  const joined = db
    .prepare('SELECT COUNT(*) AS n FROM roomHistoryMembers WHERE userId = ?')
    .get(userId) as { n: number };
  const watch = db
    .prepare('SELECT COALESCE(SUM(durationSeconds), 0) AS s FROM roomHistoryMembers WHERE userId = ?')
    .get(userId) as { s: number };

  const rows = db
    .prepare(
      `SELECT h.id, h.roomId, h.roomCode, h.roomName, h.hostUserId, h.category,
              h.createdAt, h.emptySince, h.endedAt, h.participantCount, h.maxParticipants,
              h.createdMediaTitle, h.createdMediaType,
              m.role, m.durationSeconds AS durationSeconds
       FROM roomHistoryMembers m
       JOIN roomHistory h ON h.id = m.historyId
       WHERE m.userId = ?
       ORDER BY h.createdAt DESC
       LIMIT 20`
    )
    .all(userId) as {
    id: string;
    roomId: string;
    roomCode: string;
    roomName: string;
    hostUserId: string;
    category: string;
    createdAt: string;
    emptySince: string | null;
    endedAt: string | null;
    participantCount: number;
    maxParticipants: number;
    createdMediaTitle: string | null;
    createdMediaType: string | null;
    role: string;
    durationSeconds: number;
  }[];

  const recentRooms: RoomHistoryEntry[] = rows.map((r) => ({
    id: r.id,
    roomId: r.roomId,
    roomCode: r.roomCode,
    roomName: r.roomName,
    role: r.role === 'host' ? 'host' : 'member',
    hostUserId: r.hostUserId,
    hostName: 'Unknown',
    category: r.category,
    createdAt: r.createdAt,
    emptySince: r.emptySince,
    endedAt: r.endedAt,
    durationSeconds: r.durationSeconds,
    participantCount: r.participantCount,
    maxParticipants: r.maxParticipants,
    createdMediaTitle: r.createdMediaTitle,
    createdMediaType: r.createdMediaType,
  }));

  return {
    hostedRooms: hosted.n,
    joinedRooms: joined.n,
    totalWatchSeconds: watch.s,
    recentRooms,
  };
}