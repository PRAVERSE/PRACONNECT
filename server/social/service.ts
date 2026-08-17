// server/social/service.ts
// Authoritative database logic for the social features: user discovery,
// friendships, direct messages, and watch invitations.
//
// Model invariants:
//   - ONE canonical friendships row per pair (A->B and B->A can never both
//     exist as pending/accepted; enforced by an expression-based unique index).
//   - A friendship is mutual: status='accepted' means both directions.
//   - DMs and watch invites require an accepted friendship.
//   - A watch invite NEVER creates a friendship and NEVER joins anyone to a
//     room automatically — accepting only returns the room to join.
//   - Watch invites are ephemeral (10-minute expiry); the room's own 5-minute
//     empty-room TTL always wins.

import { db } from '../db/index';
import { generateId } from '../auth/auth';
import { nowIso } from '../rooms/time';
import { getRoomOrNull, isRoomMember, isRoomExpired } from '../rooms/service';

export interface SocialError {
  code: string;
  message: string;
}

const Errors = {
  notFound: (): SocialError => ({ code: 'USER_NOT_FOUND', message: 'User not found.' }),
  self: (): SocialError => ({ code: 'CANNOT_FRIEND_SELF', message: 'You cannot send a friend request to yourself.' }),
  alreadyFriends: (): SocialError => ({ code: 'ALREADY_FRIENDS', message: 'You are already friends with this user.' }),
  alreadySent: (): SocialError => ({ code: 'REQUEST_ALREADY_SENT', message: 'You already sent a friend request to this user.' }),
  requestNotFound: (): SocialError => ({ code: 'REQUEST_NOT_FOUND', message: 'Friend request not found.' }),
  notFriends: (): SocialError => ({ code: 'FRIENDSHIP_REQUIRED', message: 'You must be friends to do that.' }),
  inviteNotFound: (): SocialError => ({ code: 'INVITE_NOT_FOUND', message: 'Watch invitation not found.' }),
  inviteExpired: (): SocialError => ({ code: 'INVITE_EXPIRED', message: 'This invitation has expired.' }),
  roomNotFound: (): SocialError => ({ code: 'ROOM_NOT_FOUND', message: 'Room not found.' }),
  roomGone: (): SocialError => ({ code: 'ROOM_GONE', message: 'This watch room has ended.' }),
  roomMembership: (): SocialError => ({ code: 'ROOM_MEMBERSHIP_REQUIRED', message: 'You must be in the room to invite others to it.' }),
  validation: (message: string): SocialError => ({ code: 'VALIDATION_ERROR', message }),
};

// ─── Public user shape (never emails, hashes, or internal columns) ──────────

export interface PublicUser {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
}

export function publicUser(row: { id: string; name: string; username: string; avatarUrl: string | null }): PublicUser {
  return { id: row.id, name: row.name, username: row.username, avatarUrl: row.avatarUrl };
}

// ─── Row shapes ──────────────────────────────────────────────────────────────

interface UserRow {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
}

interface FriendshipRow {
  id: string;
  requesterId: string;
  recipientId: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
  updatedAt: string;
  acceptedAt: string | null;
}

interface DirectMessageRow {
  id: string;
  senderId: string;
  recipientId: string;
  text: string;
  createdAt: string;
}

interface WatchInviteRow {
  id: string;
  senderUserId: string;
  recipientUserId: string;
  roomId: string;
  roomCode: string;
  roomName: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  createdAt: string;
  expiresAt: string;
  respondedAt: string | null;
}

/** Canonical pair ordering: the smaller id always comes first. */
function pair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

// ─── User discovery ──────────────────────────────────────────────────────────

export interface UserSearchResult {
  users: PublicUser[];
  total: number;
  nextOffset: number;
}

/**
 * Case-insensitive directory search across name + username. The current user
 * is always excluded. Pagination via LIMIT/OFFSET (route default 20, max 50).
 * A query starting with '@' restricts the match to usernames.
 */
export function searchUsers(
  currentUserId: string,
  query: string,
  limit = 20,
  offset = 0
): UserSearchResult {
  const q = query.trim();
  const clampedLimit = Math.min(Math.max(1, Math.floor(limit)), 50);
  const clampedOffset = Math.max(0, Math.floor(offset));

  const like = `%${q.toLowerCase()}%`;
  let where: string;
  let params: unknown[];
  if (q.startsWith('@')) {
    where = 'WHERE id != ? AND lower(username) LIKE ?';
    params = [currentUserId, `%${q.slice(1).toLowerCase()}%`];
  } else if (q === '') {
    where = 'WHERE id != ?';
    params = [currentUserId];
  } else {
    where = 'WHERE id != ? AND (lower(name) LIKE ? OR lower(username) LIKE ?)';
    params = [currentUserId, like, like];
  }

  const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM users ${where}`).get(...params) as { n: number };
  const rows = db
    .prepare(
      `SELECT id, name, username, avatarUrl FROM users ${where}
       ORDER BY lower(username) ASC LIMIT ? OFFSET ?`
    )
    .all(...params, clampedLimit, clampedOffset) as UserRow[];

  return {
    users: rows.map(publicUser),
    total: totalRow.n,
    nextOffset: clampedOffset + rows.length,
  };
}

// ─── Friendships ─────────────────────────────────────────────────────────────

export function getUserById(userId: string): UserRow | null {
  const row = db.prepare('SELECT id, name, username, avatarUrl FROM users WHERE id = ?').get(userId) as
    | UserRow
    | undefined;
  return row ?? null;
}

/** The canonical friendship row for a pair, if any. */
export function getFriendshipRow(meId: string, otherId: string): FriendshipRow | null {
  const [a, b] = pair(meId, otherId);
  const row = db
    .prepare(
      `SELECT * FROM friendships
       WHERE (requesterId = ? AND recipientId = ?) OR (requesterId = ? AND recipientId = ?)
       LIMIT 1`
    )
    .get(a, b, b, a) as FriendshipRow | undefined;
  return row ?? null;
}

export interface FriendRequestResult {
  ok: boolean;
  request?: {
    id: string;
    requester: PublicUser;
    recipient: PublicUser;
    status: 'pending' | 'accepted';
    createdAt: string;
  };
  error?: SocialError;
}

/**
 * Send (or re-send, idempotently) a friend request. Collisions converge: if
 * the other user already sent us a request, no second row is created — the
 * response carries their existing request so the client can offer "Accept".
 */
export function sendFriendRequest(senderId: string, recipientId: string): FriendRequestResult {
  if (senderId === recipientId) return { ok: false, error: Errors.self() };
  const recipient = getUserById(recipientId);
  if (!recipient) return { ok: false, error: Errors.notFound() };

  const existing = getFriendshipRow(senderId, recipientId);
  if (existing && existing.status === 'accepted') {
    return { ok: false, error: Errors.alreadyFriends() };
  }
  if (existing && existing.status === 'pending') {
    const requester =
      existing.requesterId === senderId ? publicUser(getUserById(senderId)!) : publicUser(getUserById(existing.requesterId)!);
    const recip =
      existing.recipientId === senderId ? publicUser(getUserById(existing.recipientId)!) : recipient;
    return {
      ok: true,
      request: {
        id: existing.id,
        requester,
        recipient: recip,
        status: 'pending',
        createdAt: existing.createdAt,
      },
    };
  }

  const now = nowIso();
  const id = generateId();
  db.prepare(
    'INSERT INTO friendships (id, requesterId, recipientId, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, senderId, recipientId, 'pending', now, now);

  return {
    ok: true,
    request: {
      id,
      requester: publicUser(getUserById(senderId)!),
      recipient,
      status: 'pending',
      createdAt: now,
    },
  };
}

export interface FriendshipActionResult {
  ok: boolean;
  friendship?: FriendshipRow;
  otherUser?: PublicUser;
  error?: SocialError;
}

/** Accept a pending request addressed to the acting user. */
export function acceptFriendRequest(userId: string, requestId: string): FriendshipActionResult {
  const row = db.prepare('SELECT * FROM friendships WHERE id = ?').get(requestId) as FriendshipRow | undefined;
  if (!row || row.recipientId !== userId || row.status !== 'pending') {
    return { ok: false, error: Errors.requestNotFound() };
  }

  const now = nowIso();
  db.prepare(
    "UPDATE friendships SET status = 'accepted', acceptedAt = ?, updatedAt = ? WHERE id = ?"
  ).run(now, now, requestId);

  const updated = db.prepare('SELECT * FROM friendships WHERE id = ?').get(requestId) as FriendshipRow;
  const other = getUserById(row.requesterId);
  return {
    ok: true,
    friendship: updated,
    otherUser: other ? publicUser(other) : undefined,
  };
}

/** Reject a pending request addressed to the acting user. */
export function rejectFriendRequest(userId: string, requestId: string): { ok: boolean; error?: SocialError } {
  const row = db.prepare('SELECT * FROM friendships WHERE id = ?').get(requestId) as FriendshipRow | undefined;
  if (!row || row.recipientId !== userId || row.status !== 'pending') {
    return { ok: false, error: Errors.requestNotFound() };
  }

  db.prepare("UPDATE friendships SET status = 'rejected', updatedAt = ? WHERE id = ?").run(
    nowIso(),
    requestId
  );
  return { ok: true };
}

export interface FriendListItem {
  id: string;
  name: string;
  username: string;
  avatar: string;
  online: boolean;
  currentRoomCode: string | null;
  currentRoomName: string | null;
}

/** Accepted friends with live presence (active room membership). */
export function listFriends(userId: string): FriendListItem[] {
  const rows = db
    .prepare(
      `SELECT f.*, u.id AS uid, u.name, u.username, u.avatarUrl
       FROM friendships f
       JOIN users u ON (f.requesterId = u.id AND f.requesterId != ?) OR (f.recipientId = u.id AND f.recipientId != ?)
       WHERE f.status = 'accepted' AND (f.requesterId = ? OR f.recipientId = ?)`
    )
    .all(userId, userId, userId, userId) as (FriendshipRow & UserRow)[];

  return rows.map((row) => {
    const otherId = row.requesterId === userId ? row.recipientId : row.requesterId;
    const presence = db
      .prepare(
        `SELECT r.code, r.name FROM roomMembers m
         JOIN rooms r ON r.id = m.roomId
         WHERE m.userId = ? AND m.leftAt IS NULL AND r.emptySince IS NULL
         LIMIT 1`
      )
      .get(otherId) as { code: string; name: string } | undefined;
    return {
      id: otherId,
      name: row.name,
      username: row.username,
      avatar: row.avatarUrl ?? row.name.charAt(0).toUpperCase(),
      online: Boolean(presence),
      currentRoomCode: presence?.code ?? null,
      currentRoomName: presence?.name ?? null,
    };
  });
}

export interface FriendRequestListItem {
  id: string;
  direction: 'incoming' | 'outgoing';
  user: PublicUser;
  createdAt: string;
}

/** One friendships row joined with the OTHER user's public profile. The
 *  friendship id (used to accept/reject) and the user id are kept separate. */
interface FriendRequestJoinedRow {
  friendshipId: string;
  requesterId: string;
  recipientId: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
  updatedAt: string;
  acceptedAt: string | null;
  id: string; // joined user id
  name: string;
  username: string;
  avatarUrl: string | null;
}

export function listFriendRequests(userId: string): {
  incoming: FriendRequestListItem[];
  outgoing: FriendRequestListItem[];
} {
  const rows = db
    .prepare(
      `SELECT f.id AS friendshipId, f.requesterId, f.recipientId, f.status, f.createdAt, f.updatedAt, f.acceptedAt,
              u.id, u.name, u.username, u.avatarUrl
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requesterId = ? THEN f.recipientId ELSE f.requesterId END
       WHERE f.status = 'pending' AND (f.requesterId = ? OR f.recipientId = ?)`
    )
    .all(userId, userId, userId) as FriendRequestJoinedRow[];

  const incoming: FriendRequestListItem[] = [];
  const outgoing: FriendRequestListItem[] = [];
  for (const row of rows) {
    const item: FriendRequestListItem = {
      id: row.friendshipId,
      direction: row.requesterId === userId ? 'outgoing' : 'incoming',
      user: publicUser(row),
      createdAt: row.createdAt,
    };
    if (item.direction === 'incoming') incoming.push(item);
    else outgoing.push(item);
  }
  return { incoming, outgoing };
}

// ─── Direct messages ─────────────────────────────────────────────────────────

export interface DirectMessage {
  id: string;
  senderId: string;
  text: string;
  createdAt: string;
}

export interface ConversationSummary {
  friendId: string;
  name: string;
  username: string;
  avatar: string;
  online: boolean;
  lastMessage: { text: string; senderId: string; createdAt: string } | null;
}

/** Accepted-friends-only conversation list. Historical messages from a
 *  relationship that is no longer accepted are never surfaced here — a
 *  stranger (or a user with a pending/rejected friendship) must not be able to
 *  infer a conversation existed. Sending is separately enforced in
 *  sendDirectMessage / listDirectMessages. */
export function listConversations(userId: string): ConversationSummary[] {
  const peerRows = db
    .prepare(
      `SELECT DISTINCT CASE WHEN senderId = ? THEN recipientId ELSE senderId END AS peerId
       FROM directMessages WHERE senderId = ? OR recipientId = ?`
    )
    .all(userId, userId, userId) as { peerId: string }[];

  const summaries: ConversationSummary[] = [];
  for (const { peerId } of peerRows) {
    if (!isAcceptedFriendship(userId, peerId)) continue;
    const peer = getUserById(peerId);
    if (!peer) continue;
    const last = db
      .prepare(
        `SELECT text, senderId, createdAt FROM directMessages
         WHERE (senderId = ? AND recipientId = ?) OR (senderId = ? AND recipientId = ?)
         ORDER BY createdAt DESC LIMIT 1`
      )
      .get(userId, peerId, peerId, userId) as Pick<DirectMessageRow, 'text' | 'senderId' | 'createdAt'> | undefined;
    const presence = db
      .prepare(
        `SELECT 1 FROM roomMembers m JOIN rooms r ON r.id = m.roomId
         WHERE m.userId = ? AND m.leftAt IS NULL AND r.emptySince IS NULL LIMIT 1`
      )
      .get(peerId);
    summaries.push({
      friendId: peerId,
      name: peer.name,
      username: peer.username,
      avatar: peer.avatarUrl ?? peer.name.charAt(0).toUpperCase(),
      online: Boolean(presence),
      lastMessage: last ? { text: last.text, senderId: last.senderId, createdAt: last.createdAt } : null,
    });
  }

  summaries.sort((a, b) => {
    const ta = a.lastMessage?.createdAt ?? '';
    const tb = b.lastMessage?.createdAt ?? '';
    return tb.localeCompare(ta);
  });
  return summaries;
}

export function isAcceptedFriendship(meId: string, otherId: string): boolean {
  const row = getFriendshipRow(meId, otherId);
  return Boolean(row && row.status === 'accepted');
}

/** Latest `limit` messages of a conversation, chronological (oldest first). */
export function listDirectMessages(
  userId: string,
  friendId: string,
  limit = 50
): { ok: boolean; messages?: DirectMessage[]; error?: SocialError } {
  if (!isAcceptedFriendship(userId, friendId)) {
    return { ok: false, error: Errors.notFriends() };
  }
  const clamped = Math.min(Math.max(1, Math.floor(limit)), 200);
  const rows = db
    .prepare(
      `SELECT * FROM (
         SELECT id, senderId, recipientId, text, createdAt FROM directMessages
         WHERE (senderId = ? AND recipientId = ?) OR (senderId = ? AND recipientId = ?)
         ORDER BY createdAt DESC LIMIT ?
       ) ORDER BY createdAt ASC`
    )
    .all(userId, friendId, friendId, userId, clamped) as DirectMessageRow[];

  return {
    ok: true,
    messages: rows.map((r) => ({ id: r.id, senderId: r.senderId, text: r.text, createdAt: r.createdAt })),
  };
}

export interface SendDirectMessageResult {
  ok: boolean;
  message?: DirectMessage;
  error?: SocialError;
}

export function sendDirectMessage(userId: string, friendId: string, text: string): SendDirectMessageResult {
  if (!isAcceptedFriendship(userId, friendId)) {
    return { ok: false, error: Errors.notFriends() };
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, error: Errors.validation('Message cannot be empty.') };
  if (trimmed.length > 2000) return { ok: false, error: Errors.validation('Message is too long (max 2000 characters).') };

  const now = nowIso();
  const id = generateId();
  db.prepare(
    'INSERT INTO directMessages (id, senderId, recipientId, text, createdAt) VALUES (?, ?, ?, ?, ?)'
  ).run(id, userId, friendId, trimmed, now);

  return { ok: true, message: { id, senderId: userId, text: trimmed, createdAt: now } };
}

// ─── Watch invitations ───────────────────────────────────────────────────────

export const WATCH_INVITE_TTL_MS = 10 * 60 * 1000;

export interface WatchInviteItem {
  id: string;
  direction: 'incoming' | 'outgoing';
  sender: PublicUser;
  recipient: PublicUser;
  roomId: string;
  roomCode: string;
  roomName: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  createdAt: string;
  expiresAt: string;
  roomAlive: boolean;
}

function mapInviteRow(row: WatchInviteRow): WatchInviteItem {
  const sender = getUserById(row.senderUserId);
  const recipient = getUserById(row.recipientUserId);
  const room = getRoomOrNull(row.roomId);
  const roomAlive = Boolean(room && !isRoomExpired(room));
  return {
    id: row.id,
    direction: 'incoming' as const,
    sender: publicUser(sender ?? { id: row.senderUserId, name: 'Unknown', username: 'unknown', avatarUrl: null }),
    recipient: publicUser(recipient ?? { id: row.recipientUserId, name: 'Unknown', username: 'unknown', avatarUrl: null }),
    roomId: row.roomId,
    roomCode: row.roomCode,
    roomName: row.roomName,
    status: row.status,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    roomAlive,
  };
}

export interface SendWatchInviteResult {
  ok: boolean;
  invite?: WatchInviteItem;
  error?: SocialError;
}

/** Invite a friend to the room the sender is currently in. */
export function sendWatchInvite(senderId: string, recipientId: string, roomId: string): SendWatchInviteResult {
  if (!isAcceptedFriendship(senderId, recipientId)) {
    return { ok: false, error: Errors.notFriends() };
  }
  const room = getRoomOrNull(roomId);
  if (!room) return { ok: false, error: Errors.roomNotFound() };
  if (isRoomExpired(room)) return { ok: false, error: Errors.roomGone() };
  if (!isRoomMember(room.id, senderId)) return { ok: false, error: Errors.roomMembership() };

  // Idempotent: a pending invite to the same room/recipient is reused.
  const existing = db
    .prepare(
      `SELECT * FROM watchInvites
       WHERE senderUserId = ? AND recipientUserId = ? AND roomId = ? AND status = 'pending'
       LIMIT 1`
    )
    .get(senderId, recipientId, room.id) as WatchInviteRow | undefined;
  if (existing) {
    return { ok: true, invite: mapInviteRow(existing) };
  }

  const now = nowIso();
  const expiresAt = new Date(Date.now() + WATCH_INVITE_TTL_MS).toISOString();
  const id = generateId();
  db.prepare(
    `INSERT INTO watchInvites
       (id, senderUserId, recipientUserId, roomId, roomCode, roomName, status, createdAt, expiresAt)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).run(id, senderId, recipientId, room.id, room.code, room.name, now, expiresAt);

  const row = db.prepare('SELECT * FROM watchInvites WHERE id = ?').get(id) as WatchInviteRow;
  return { ok: true, invite: mapInviteRow(row) };
}

/** Pending invites involving the user (incoming + outgoing), oldest first. */
export function listWatchInvites(userId: string): WatchInviteItem[] {
  // Lazy expiry: any pending invite past its deadline becomes 'expired' now.
  db.prepare(
    "UPDATE watchInvites SET status = 'expired', respondedAt = ? WHERE status = 'pending' AND expiresAt < ?"
  ).run(nowIso(), nowIso());

  const rows = db
    .prepare(
      `SELECT * FROM watchInvites
       WHERE (senderUserId = ? OR recipientUserId = ?) AND status = 'pending'
       ORDER BY createdAt ASC`
    )
    .all(userId, userId) as WatchInviteRow[];

  return rows.map((row) => ({
    ...mapInviteRow(row),
    direction: row.recipientUserId === userId ? ('incoming' as const) : ('outgoing' as const),
  }));
}

export interface RespondWatchInviteResult {
  ok: boolean;
  invite?: WatchInviteItem;
  roomCode?: string;
  error?: SocialError;
}

/**
 * Accept or decline a pending invite addressed to the acting user. Accepting
 * re-validates the room (the 5-minute empty-room TTL always wins over the
 * invite) and returns the room code for the client's normal join flow.
 */
export function respondWatchInvite(
  userId: string,
  inviteId: string,
  action: 'accepted' | 'declined'
): RespondWatchInviteResult {
  const row = db.prepare('SELECT * FROM watchInvites WHERE id = ?').get(inviteId) as WatchInviteRow | undefined;
  if (!row || row.recipientUserId !== userId) return { ok: false, error: Errors.inviteNotFound() };
  if (row.status !== 'pending') return { ok: false, error: Errors.inviteNotFound() };

  const now = nowIso();
  if (Date.parse(row.expiresAt) <= Date.now()) {
    db.prepare("UPDATE watchInvites SET status = 'expired', respondedAt = ? WHERE id = ?").run(now, inviteId);
    return { ok: false, error: Errors.inviteExpired() };
  }

  if (action === 'declined') {
    db.prepare("UPDATE watchInvites SET status = 'declined', respondedAt = ? WHERE id = ?").run(now, inviteId);
    const updated = db.prepare('SELECT * FROM watchInvites WHERE id = ?').get(inviteId) as WatchInviteRow;
    return { ok: true, invite: mapInviteRow(updated) };
  }

  const room = getRoomOrNull(row.roomId);
  if (!room || isRoomExpired(room)) {
    db.prepare("UPDATE watchInvites SET status = 'expired', respondedAt = ? WHERE id = ?").run(now, inviteId);
    return { ok: false, error: Errors.roomGone() };
  }

  db.prepare("UPDATE watchInvites SET status = 'accepted', respondedAt = ? WHERE id = ?").run(now, inviteId);
  const updated = db.prepare('SELECT * FROM watchInvites WHERE id = ?').get(inviteId) as WatchInviteRow;
  return { ok: true, invite: mapInviteRow(updated), roomCode: row.roomCode };
}

// ─── Maintenance ──────────────────────────────────────────────────────────────

export interface SocialCleanupResult {
  expiredInvites: number;
  purgedRejected: number;
}

/** Expire stale watch invites and purge long-rejected friendships. */
export function cleanupSocialData(now = Date.now()): SocialCleanupResult {
  const nowIsoStr = new Date(now).toISOString();

  const inviteRes = db
    .prepare("UPDATE watchInvites SET status = 'expired', respondedAt = ? WHERE status = 'pending' AND expiresAt < ?")
    .run(nowIsoStr, nowIsoStr);

  const rejectedCutoff = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const purgeRes = db
    .prepare("DELETE FROM friendships WHERE status = 'rejected' AND updatedAt < ?")
    .run(rejectedCutoff);

  return { expiredInvites: inviteRes.changes, purgedRejected: purgeRes.changes };
}
