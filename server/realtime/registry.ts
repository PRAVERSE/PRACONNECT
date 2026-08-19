// server/realtime/registry.ts
// Realtime connection registry tracking active WebSocket connections per user.
// Manages presence transitions (0 -> 1 online, 1 -> 0 offline with lastSeenAt update).

import type { WebSocket } from 'ws';
import { db } from '../db/index';
import { nowIso } from '../rooms/time';
import { emitUserEvent } from '../social/realtime';

// userId -> Set of active WebSocket connections
const userSockets = new Map<string, Set<WebSocket>>();

/** Socket metadata mapping */
interface SocketInfo {
  userId: string;
  connectedAt: string;
}
const socketMeta = new WeakMap<WebSocket, SocketInfo>();

/** Get all accepted friends' userIds for presence notifications. */
function getAcceptedFriendIds(userId: string): string[] {
  try {
    const rows = db
      .prepare(
        `SELECT CASE WHEN requesterId = ? THEN recipientId ELSE requesterId END AS friendId
         FROM friendships
         WHERE status = 'accepted' AND (requesterId = ? OR recipientId = ?)`
      )
      .all(userId, userId, userId) as { friendId: string }[];
    return rows.map((r) => r.friendId);
  } catch {
    return [];
  }
}

/** Broadcast presence change to accepted friends. */
function notifyPresenceChange(userId: string, status: 'online' | 'offline', lastSeenAt?: string | null): void {
  const friendIds = getAcceptedFriendIds(userId);
  const payload = {
    userId,
    status,
    lastSeenAt: lastSeenAt ?? null,
  };
  for (const friendId of friendIds) {
    emitUserEvent(friendId, 'presence', payload);
  }
}

/** Register an active, authenticated WebSocket connection for a user. */
export function registerConnection(userId: string, socket: WebSocket): void {
  const existing = userSockets.get(userId) ?? new Set<WebSocket>();
  const wasOffline = existing.size === 0;

  existing.add(socket);
  userSockets.set(userId, existing);
  socketMeta.set(socket, { userId, connectedAt: nowIso() });

  if (wasOffline) {
    // 0 -> 1 connection: user becomes online
    notifyPresenceChange(userId, 'online', null);
  }
}

/** Unregister a WebSocket connection. Returns true if user became fully offline. */
export function unregisterConnection(userId: string, socket: WebSocket): boolean {
  const set = userSockets.get(userId);
  if (!set) return false;

  set.delete(socket);
  const isNowOffline = set.size === 0;

  if (isNowOffline) {
    userSockets.delete(userId);
    const now = nowIso();
    try {
      db.prepare('UPDATE users SET lastSeenAt = ? WHERE id = ?').run(now, userId);
    } catch {
      // Ignore DB errors during shutdown
    }
    notifyPresenceChange(userId, 'offline', now);
    return true;
  }

  return false;
}

/** Get all active WebSockets for a specific user. */
export function getUserConnections(userId: string): Set<WebSocket> {
  return userSockets.get(userId) ?? new Set<WebSocket>();
}

/** Get all userIds currently online. */
export function getOnlineUserIds(): string[] {
  return Array.from(userSockets.keys()).filter((id) => (userSockets.get(id)?.size ?? 0) > 0);
}

/** Check if a user has at least one active realtime connection. */
export function isUserOnlineNow(userId: string): boolean {
  const set = userSockets.get(userId);
  return Boolean(set && set.size > 0);
}

/** Get the lastSeenAt ISO string for a user from the DB. */
export function getUserLastSeenAt(userId: string): string | null {
  try {
    const row = db.prepare('SELECT lastSeenAt FROM users WHERE id = ?').get(userId) as { lastSeenAt: string | null } | undefined;
    return row?.lastSeenAt ?? null;
  } catch {
    return null;
  }
}

/** Metadata inspection helper. */
export function getSocketUserId(socket: WebSocket): string | undefined {
  return socketMeta.get(socket)?.userId;
}

/** Total connection count across all users (test helper). */
export function getTotalConnectionCount(): number {
  let count = 0;
  for (const set of userSockets.values()) {
    count += set.size;
  }
  return count;
}

/** Clear all registered sockets (test helper). */
export function clearRegistry(): void {
  userSockets.clear();
}
