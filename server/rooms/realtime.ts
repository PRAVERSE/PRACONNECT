// server/rooms/realtime.ts
// Phase 3: Server-Sent Events hub. Room state changes are persisted as
// roomEvents rows, then broadcast to every connected client of that room.
// Ephemeral events (such as WebRTC signals) are routed directly to peers without DB persistence.
// Disconnect detection gracefully removes stale participants when browsers close.

import { db } from '../db/index';
import { nowIso } from './time';
import { leaveRoom, roomPayload, getRoomOrNull } from './service';

export interface RoomEvent {
  id: number;
  type: string;
  payload: unknown;
}

/** Minimal sink abstraction over a ReadableStreamDefaultController. */
export interface StreamSink {
  enqueue(chunk: Uint8Array): void;
  close(): void;
}

// roomId -> Set of all sinks in the room
const clients = new Map<string, Set<StreamSink>>();

// roomId -> userId -> Set of sinks for that user
const roomUserSinks = new Map<string, Map<string, Set<StreamSink>>>();

// Buffered ephemeral signals for users whose SSE stream has not registered yet.
// Without this, a peer signaling immediately after another user joins would be
// silently dropped (the broadcast fallback only reaches the sender, which
// ignores its own signals). Key: `${roomId}:${userId}`.
const pendingEphemeral = new Map<string, { frame: Uint8Array; expiresAt: number }[]>();

const EPHEMERAL_BUFFER_TTL_MS = 30_000;
const EPHEMERAL_BUFFER_MAX_PER_USER = 200;

// Disconnect grace: how long a member stays in the room after their last SSE
// stream closes. Overridable via DISCONNECT_GRACE_MS (tests use small values).
export const DISCONNECT_GRACE_MS = Math.max(
  50,
  parseInt(process.env.DISCONNECT_GRACE_MS ?? '20000', 10) || 20000
);

/** Maximum persisted events replayed per reconnect. */
export const REPLAY_WINDOW = 500;

// Disconnect grace timers: "roomId:userId" -> Timeout
const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

function encodeEvent(ev: RoomEvent): Uint8Array {
  const text = `id: ${ev.id}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev.payload)}\n\n`;
  return new TextEncoder().encode(text);
}

/** Persist an event and broadcast it to all connected clients of the room. */
export function emit(roomId: string, type: string, payload: unknown): number {
  const now = nowIso();
  const info = db
    .prepare('INSERT INTO roomEvents (roomId, type, actorUserId, payloadJson, createdAt) VALUES (?, ?, ?, ?, ?)')
    .run(
      roomId,
      type,
      typeof payload === 'object' && payload !== null && 'actorUserId' in payload
        ? String((payload as { actorUserId?: unknown }).actorUserId ?? null)
        : null,
      JSON.stringify(payload),
      now
    );
  const id = Number(info.lastInsertRowid);

  const event: RoomEvent = { id, type, payload };
  const set = clients.get(roomId);
  if (set) {
    const frame = encodeEvent(event);
    for (const sink of Array.from(set)) {
      try {
        sink.enqueue(frame);
      } catch {
        // Broken connection — stream cancel() will deregister it
      }
    }
  }
  return id;
}

/** Broadcast an ephemeral event (like WebRTC signals) directly to active room clients without DB persistence. */
export function emitEphemeral(roomId: string, type: string, payload: unknown, targetUserId?: string): void {
  const text = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  const frame = new TextEncoder().encode(text);

  if (targetUserId) {
    const userMap = roomUserSinks.get(roomId);
    const targetSinks = userMap?.get(targetUserId);
    if (targetSinks && targetSinks.size > 0) {
      for (const sink of Array.from(targetSinks)) {
        try {
          sink.enqueue(frame);
        } catch {}
      }
      return;
    }

    // Target not connected yet (e.g. peer signals the moment the other user
    // joins, before their SSE stream registers). Buffer so the signal is
    // delivered once the stream opens — otherwise it is lost forever.
    const key = `${roomId}:${targetUserId}`;
    const now = Date.now();
    const queue = pendingEphemeral.get(key) ?? [];
    const fresh = queue.filter((f) => f.expiresAt > now);
    if (fresh.length < EPHEMERAL_BUFFER_MAX_PER_USER) {
      fresh.push({ frame, expiresAt: now + EPHEMERAL_BUFFER_TTL_MS });
    }
    pendingEphemeral.set(key, fresh);
    return;
  }

  // Broadcast to all clients in room
  const set = clients.get(roomId);
  if (set) {
    for (const sink of Array.from(set)) {
      try {
        sink.enqueue(frame);
      } catch {}
    }
  }
}

/** Flush any buffered ephemeral signals for a user's freshly opened SSE stream. */
function flushPendingEphemeral(roomId: string, userId: string, sink: StreamSink): void {
  const key = `${roomId}:${userId}`;
  const queue = pendingEphemeral.get(key);
  if (!queue || queue.length === 0) return;
  pendingEphemeral.delete(key);

  const now = Date.now();
  for (const item of queue) {
    if (item.expiresAt <= now) continue;
    try {
      sink.enqueue(item.frame);
    } catch {
      break;
    }
  }
}

/**
 * Events persisted after the given event id, oldest first, plus whether the
 * 500-event replay window was truncated (the client missed too many events to
 * reconstruct state from replay alone and should resync authoritative state).
 */
export function replayEventsWithMeta(roomId: string, afterId: number): {
  events: RoomEvent[];
  truncated: boolean;
} {
  const rows = db
    .prepare(
      `SELECT id, type, payloadJson FROM roomEvents
       WHERE roomId = ? AND id > ? ORDER BY id ASC LIMIT ${REPLAY_WINDOW + 1}`
    )
    .all(roomId, afterId) as { id: number; type: string; payloadJson: string }[];
  const truncated = rows.length > REPLAY_WINDOW;
  return {
    events: rows.slice(0, REPLAY_WINDOW).map((r) => ({ id: r.id, type: r.type, payload: JSON.parse(r.payloadJson) })),
    truncated,
  };
}

/** Events persisted after the given event id, oldest first. */
export function replayEvents(roomId: string, afterId: number): RoomEvent[] {
  return replayEventsWithMeta(roomId, afterId).events;
}

/** Last persisted event id for a room (0 if none). */
export function lastEventId(roomId: string): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(id), 0) AS maxId FROM roomEvents WHERE roomId = ?')
    .get(roomId) as { maxId: number };
  return row.maxId;
}

/**
 * Register a sink for a room's live event stream.
 * Automatically tracks user presence and handles disconnects.
 */
export function openEventStream(
  roomId: string,
  userId: string,
  signal: AbortSignal,
  sink: StreamSink,
  onClose?: () => void
): () => void {
  let streamClosed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  // Cancel any pending disconnect timer for this user
  const timerKey = `${roomId}:${userId}`;
  const existingTimer = disconnectTimers.get(timerKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
    disconnectTimers.delete(timerKey);
  }

  // Register in room set
  const set = clients.get(roomId) ?? new Set();
  set.add(sink);
  clients.set(roomId, set);

  // Register in user-specific map
  let userMap = roomUserSinks.get(roomId);
  if (!userMap) {
    userMap = new Map();
    roomUserSinks.set(roomId, userMap);
  }
  const userSinkSet = userMap.get(userId) ?? new Set();
  userSinkSet.add(sink);
  userMap.set(userId, userSinkSet);

  // Deliver any signals that arrived before this stream registered
  flushPendingEphemeral(roomId, userId, sink);

  const cleanup = () => {
    if (streamClosed) return;
    streamClosed = true;
    if (heartbeat) clearInterval(heartbeat);

    // Remove from room set
    const current = clients.get(roomId);
    if (current) {
      current.delete(sink);
      if (current.size === 0) clients.delete(roomId);
    }

    // Remove from user-specific map
    const uMap = roomUserSinks.get(roomId);
    if (uMap) {
      const uSinks = uMap.get(userId);
      if (uSinks) {
        uSinks.delete(sink);
        if (uSinks.size === 0) {
          uMap.delete(userId);

          // No more SSE streams for this user: any buffered signals are stale
          pendingEphemeral.delete(`${roomId}:${userId}`);

          // User has no more active SSE streams in this room.
          // Start a grace period before marking member as left in the DB.
          const timer = setTimeout(() => {
            disconnectTimers.delete(timerKey);
            try {
              if (!db.open) return;
              const room = getRoomOrNull(roomId);
              if (room && !room.emptySince) {
                const wasHost = room.hostUserId === userId;
                const res = leaveRoom(roomId, userId);
                if (res.ok) {
                  const payload = roomPayload(roomId, null);
                  if (payload && wasHost && payload.hostUserId !== userId) {
                    emit(roomId, 'host:changed', { roomId, hostUserId: payload.hostUserId, host: payload.host });
                  }
                  emit(roomId, 'member:leave', { roomId, userId });
                  if (payload && payload.emptySince) {
                    emit(roomId, 'room:update', { room: payload });
                  }
                }
              }
            } catch (err) {
              // Ignore errors if test closed database
            }
          }, DISCONNECT_GRACE_MS);

          timer.unref?.();
          disconnectTimers.set(timerKey, timer);
        }
      }
      if (uMap.size === 0) roomUserSinks.delete(roomId);
    }

    try {
      sink.close();
    } catch {
      // already closed
    }
    onClose?.();
  };

  // Heartbeat every 25s to keep connections alive
  heartbeat = setInterval(() => {
    try {
      sink.enqueue(new TextEncoder().encode(`: ping\n\n`));
    } catch {
      cleanup();
    }
  }, 25000);

  signal.addEventListener('abort', cleanup, { once: true });
  return cleanup;
}

export function connectedClientCount(roomId: string): number {
  return clients.get(roomId)?.size ?? 0;
}

// ─── Room event retention (Phase 6.8) ─────────────────────────────────────────
// Chat messages and room state changes are persisted as roomEvents rows and
// broadcast over SSE; without a retention policy an abusive room could grow
// that table without bound. Cleanup is age-based with a per-room safety cap,
// and never removes events still needed by the active replay window.

/** Maximum persisted events kept per room (safety cap; always >= replay window + 1). */
export const ROOM_EVENTS_MAX_PER_ROOM = Math.max(
  REPLAY_WINDOW + 1,
  parseInt(process.env.ROOM_EVENTS_MAX_PER_ROOM ?? '2000', 10) || 2000
);

/** Events older than this are eligible for age-based deletion (default: 24h). */
export const ROOM_EVENTS_RETENTION_MS = Math.max(
  0,
  parseInt(process.env.ROOM_EVENTS_RETENTION_MS ?? '86400000', 10) || 86400000
);

/** Always keep this many newest events per room so the replay window survives. */
const ROOM_EVENTS_KEEP_NEWEST = REPLAY_WINDOW + 100;

export interface RoomEventCleanupResult {
  roomsProcessed: number;
  deleted: number;
}

/**
 * Trim old roomEvents per room. Options override the environment defaults and
 * are injectable for deterministic tests. Bounded by `maxRooms` per sweep.
 */
export function cleanupRoomEvents(
  now = Date.now(),
  options: { maxPerRoom?: number; retentionMs?: number; maxRooms?: number } = {}
): RoomEventCleanupResult {
  const maxPerRoom = Math.max(REPLAY_WINDOW + 1, options.maxPerRoom ?? ROOM_EVENTS_MAX_PER_ROOM);
  const retentionMs = options.retentionMs ?? ROOM_EVENTS_RETENTION_MS;
  const maxRooms = options.maxRooms ?? 1000;
  const cutoff = new Date(now - retentionMs).toISOString();

  const roomRows = db.prepare('SELECT DISTINCT roomId FROM roomEvents').all() as { roomId: string }[];
  let deleted = 0;
  let roomsProcessed = 0;

  for (const { roomId } of roomRows) {
    if (roomsProcessed >= maxRooms) break;
    roomsProcessed += 1;
    const countRow = db.prepare('SELECT COUNT(*) AS n FROM roomEvents WHERE roomId = ?').get(roomId) as { n: number };
    if (countRow.n === 0) continue;

    // Safety cap: keep only the newest maxPerRoom events for this room.
    const excess = countRow.n - maxPerRoom;
    if (excess > 0) {
      const capInfo = db
        .prepare(
          `DELETE FROM roomEvents WHERE roomId = ? AND id IN (
             SELECT id FROM roomEvents WHERE roomId = ? ORDER BY id ASC LIMIT ?
           )`
        )
        .run(roomId, roomId, excess);
      deleted += capInfo.changes;
    }

    // Age-based retention: drop events older than the cutoff unless they are
    // within the active replay window (the newest REPLAY_WINDOW + 100 events
    // always survive, so Last-Event-ID replay is never broken).
    const ageInfo = db
      .prepare(
        `DELETE FROM roomEvents WHERE roomId = ? AND createdAt < ? AND id NOT IN (
           SELECT id FROM roomEvents WHERE roomId = ? ORDER BY id DESC LIMIT ?
         )`
      )
      .run(roomId, cutoff, roomId, ROOM_EVENTS_KEEP_NEWEST);
    deleted += ageInfo.changes;
  }

  return { roomsProcessed, deleted };
}