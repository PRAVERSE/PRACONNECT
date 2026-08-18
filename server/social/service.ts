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
import { generateId, hashPassword, verifyPassword } from '../auth/auth';
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
  conversationNotFound: (): SocialError => ({ code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found.' }),
  messageNotFound: (): SocialError => ({ code: 'MESSAGE_NOT_FOUND', message: 'Message not found.' }),
  messageForbidden: (): SocialError => ({ code: 'MESSAGE_FORBIDDEN', message: 'You are not allowed to do that to this message.' }),
  deleteWindowExpired: (): SocialError => ({ code: 'DELETE_WINDOW_EXPIRED', message: 'This message can no longer be deleted for everyone.' }),
  lockRequired: (): SocialError => ({ code: 'LOCK_REQUIRED', message: 'This conversation is locked.' }),
  lockInvalid: (): SocialError => ({ code: 'LOCK_INVALID', message: 'Incorrect PIN.' }),
  listNotFound: (): SocialError => ({ code: 'LIST_NOT_FOUND', message: 'List not found.' }),
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
  replyToMessageId: string | null;
  forwardedFromMessageId: string | null;
  deletedForEveryone: number;
  deletedAt: string | null;
  deletedByUserId: string | null;
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

/** Canonical conversation id for a pair: sorted user ids joined with ':'. */
export function conversationIdFor(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export interface DirectMessage {
  id: string;
  senderId: string;
  text: string;
  createdAt: string;
  replyToMessageId?: string | null;
  forwardedFromMessageId?: string | null;
  deletedForEveryone?: boolean;
  /** The replied-to message quoted under this one (joined server-side). */
  replyTo?: { id: string; text: string; senderId: string; deleted: boolean } | null;
  /** The original message this one was forwarded from (joined server-side). */
  forwardedFrom?: { id: string; text: string; senderId: string; deleted: boolean } | null;
}

export interface ConversationSummary {
  friendId: string;
  name: string;
  username: string;
  avatar: string;
  online: boolean;
  lastMessage: { text: string; senderId: string; createdAt: string } | null;
  /** Per-user conversation preferences (server-authoritative). */
  archived?: boolean;
  pinned?: boolean;
  favourite?: boolean;
  locked?: boolean;
  unreadCount?: number;
}

/** The original text of a message is NEVER revealed after delete-for-everyone. */
function messageTextFor(row: DirectMessageRow): string {
  return row.deletedForEveryone ? '' : row.text;
}

/** Join the replied-to / forwarded-from origin message for quoting. */
function originPreview(row: { id: string; text: string; senderId: string; deletedForEveryone: number; createdAt: string } | undefined, deletedForMe: boolean):
  { id: string; text: string; senderId: string; deleted: boolean } | null {
  if (!row) return null;
  const deleted = deletedForMe || Boolean(row.deletedForEveryone);
  return {
    id: row.id ?? '',
    text: row.deletedForEveryone ? '' : row.text,
    senderId: row.senderId,
    deleted,
  };
}

/**
 * Load a message the acting user can see, if any. `isDeletedForMe` controls
 * whether delete-for-me tombstones also exclude the row (listing) or only mark
 * it (info previews).
 */
export interface MessageAccess {
  ok: true;
  message: DirectMessageRow;
  /** The peer participant (the other person in the conversation). */
  peerId: string;
  conversationId: string;
}
export type MessageAccessResult = MessageAccess | { ok: false; error: SocialError };

function getMessageRow(id: string): DirectMessageRow | undefined {
  return db.prepare('SELECT * FROM directMessages WHERE id = ?').get(id) as DirectMessageRow | undefined;
}

export { getMessageRow };

/** A message the user is a participant of — in an ACCEPTED-friendship
 *  conversation. Never trusts client-supplied owner ids. */
export function getMessageAccess(userId: string, messageId: string): MessageAccessResult {
  const row = getMessageRow(messageId);
  if (!row) return { ok: false, error: Errors.messageNotFound() };
  const isParticipant = row.senderId === userId || row.recipientId === userId;
  if (!isParticipant) return { ok: false, error: Errors.messageNotFound() };
  const peerId = row.senderId === userId ? row.recipientId : row.senderId;
  if (!isAcceptedFriendship(userId, peerId)) return { ok: false, error: Errors.notFriends() };
  return { ok: true, message: row, peerId, conversationId: conversationIdFor(userId, peerId) };
}

/** Accepted-friends-only conversation list. Historical messages from a
 *  relationship that is no longer accepted are never surfaced here — a
 *  stranger (or a user with a pending/rejected friendship) must not be able to
 *  infer a conversation existed. Sending is separately enforced in
 *  sendDirectMessage / listDirectMessages. Conversations deleted for the
 *  current user are hidden; per-user settings (pinned/archived/favourite/
 *  locked/unread) ride along. Pinned conversations sort above the rest. */
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
    const conversationId = conversationIdFor(userId, peerId);
    const hidden = db.prepare('SELECT 1 FROM conversationDeletions WHERE userId = ? AND conversationId = ?').get(userId, conversationId);
    if (hidden) continue;

    const last = db
      .prepare(
        `SELECT text, senderId, createdAt, deletedForEveryone FROM directMessages
         WHERE (senderId = ? AND recipientId = ?) OR (senderId = ? AND recipientId = ?)
         ORDER BY createdAt DESC LIMIT 1`
      )
      .get(userId, peerId, peerId, userId) as Pick<DirectMessageRow, 'text' | 'senderId' | 'createdAt' | 'deletedForEveryone'> | undefined;
    const presence = db
      .prepare(
        `SELECT 1 FROM roomMembers m JOIN rooms r ON r.id = m.roomId
         WHERE m.userId = ? AND m.leftAt IS NULL AND r.emptySince IS NULL LIMIT 1`
      )
      .get(peerId);

    const settings = db
      .prepare('SELECT * FROM conversationUserSettings WHERE userId = ? AND conversationId = ?')
      .get(userId, conversationId) as ConversationSettingsRow | undefined;

    const unread = (db
      .prepare(
        `SELECT COUNT(*) AS n FROM directMessages
         WHERE senderId = ? AND recipientId = ? AND deletedForEveryone = 0
           AND (? IS NULL OR createdAt > ?)`
      )
      .get(peerId, userId, settings?.lastReadAt ?? null, settings?.lastReadAt ?? null) as { n: number }).n;

    summaries.push({
      friendId: peerId,
      name: peer.name,
      username: peer.username,
      avatar: peer.avatarUrl ?? peer.name.charAt(0).toUpperCase(),
      online: Boolean(presence),
      // Locked conversations never leak preview text — even to the owner.
      lastMessage: last
        ? {
            text: settings?.locked ? '' : last.deletedForEveryone ? '' : last.text,
            senderId: last.senderId,
            createdAt: last.createdAt,
          }
        : null,
      archived: Boolean(settings?.archived),
      pinned: Boolean(settings?.pinned),
      favourite: Boolean(settings?.favourite),
      locked: Boolean(settings?.locked),
      unreadCount: unread,
    });
  }

  summaries.sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
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

/** Latest `limit` messages of a conversation, chronological (oldest first).
 *  Messages tombstoned for the current user are excluded; delete-for-everyone
 *  rows are kept as placeholders with the body stripped. The reply/forward
 *  origin previews are joined so the client never needs follow-up requests. */
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
      `SELECT dm.id, dm.senderId, dm.recipientId, dm.text, dm.createdAt,
              dm.replyToMessageId, dm.forwardedFromMessageId,
              dm.deletedForEveryone, dm.deletedAt, dm.deletedByUserId
       FROM (
         SELECT id FROM directMessages dm
         WHERE ((dm.senderId = ? AND dm.recipientId = ?) OR (dm.senderId = ? AND dm.recipientId = ?))
           AND NOT EXISTS (SELECT 1 FROM messageDeletions md WHERE md.messageId = dm.id AND md.userId = ?)
         ORDER BY dm.createdAt DESC LIMIT ?
       ) sel
       JOIN directMessages dm ON dm.id = sel.id
       ORDER BY dm.createdAt ASC`
    )
    .all(userId, friendId, friendId, userId, userId, clamped) as DirectMessageRow[];

  return {
    ok: true,
    messages: rows.map((r) => mapDirectMessage(userId, r)),
  };
}

function mapDirectMessage(userId: string, row: DirectMessageRow): DirectMessage {
  const replyRow = row.replyToMessageId
    ? (db.prepare('SELECT id, senderId, text, createdAt, deletedForEveryone FROM directMessages WHERE id = ?').get(row.replyToMessageId) as
        | Pick<DirectMessageRow, 'id' | 'senderId' | 'text' | 'createdAt' | 'deletedForEveryone'>
        | undefined)
    : undefined;  const replyDeletedForMe = row.replyToMessageId
    ? Boolean(db.prepare('SELECT 1 FROM messageDeletions WHERE messageId = ? AND userId = ?').get(row.replyToMessageId, userId))
    : false;
  const fwdRow = row.forwardedFromMessageId
    ? (db.prepare('SELECT id, senderId, text, createdAt, deletedForEveryone FROM directMessages WHERE id = ?').get(row.forwardedFromMessageId) as
        | Pick<DirectMessageRow, 'id' | 'senderId' | 'text' | 'createdAt' | 'deletedForEveryone'>
        | undefined)
    : undefined;
  const fwdDeletedForMe = row.forwardedFromMessageId
    ? Boolean(db.prepare('SELECT 1 FROM messageDeletions WHERE messageId = ? AND userId = ?').get(row.forwardedFromMessageId, userId))
    : false;
  return {
    id: row.id,
    senderId: row.senderId,
    text: messageTextFor(row),
    createdAt: row.createdAt,
    replyToMessageId: row.replyToMessageId,
    forwardedFromMessageId: row.forwardedFromMessageId,
    deletedForEveryone: Boolean(row.deletedForEveryone),
    replyTo: row.replyToMessageId ? originPreview(replyRow, replyDeletedForMe) : null,
    forwardedFrom: row.forwardedFromMessageId ? originPreview(fwdRow, fwdDeletedForMe) : null,
  };
}

export interface SendDirectMessageResult {
  ok: boolean;
  message?: DirectMessage;
  error?: SocialError;
}

export interface SendDirectMessageOptions {
  /** Id of the message being replied to — must belong to this same
   *  conversation and be accessible to the sender. */
  replyToMessageId?: string;
  /** Id of an accessible message being forwarded. Forwarding creates a NEW
   *  message and never mutates the original. */
  forwardedFromMessageId?: string;
}

export function sendDirectMessage(
  userId: string,
  friendId: string,
  text: string,
  options: SendDirectMessageOptions = {}
): SendDirectMessageResult {
  if (!isAcceptedFriendship(userId, friendId)) {
    return { ok: false, error: Errors.notFriends() };
  }
  const trimmed = text.trim();
  if (trimmed.length === 0 && !options.forwardedFromMessageId) {
    return { ok: false, error: Errors.validation('Message cannot be empty.') };
  }
  if (trimmed.length > 2000) return { ok: false, error: Errors.validation('Message is too long (max 2000 characters).') };

  if (options.replyToMessageId) {
    const access = getMessageAccess(userId, options.replyToMessageId);
    if (!access.ok) return { ok: false, error: access.error };
    // The reply must stay inside the same conversation pair.
    if (access.conversationId !== conversationIdFor(userId, friendId)) {
      return { ok: false, error: Errors.validation('Reply target is not in this conversation.') };
    }
  }
  if (options.forwardedFromMessageId) {
    const access = getMessageAccess(userId, options.forwardedFromMessageId);
    if (!access.ok) return { ok: false, error: access.error };
  }

  const now = nowIso();
  const id = generateId();
  db.prepare(
    `INSERT INTO directMessages
       (id, senderId, recipientId, text, createdAt, replyToMessageId, forwardedFromMessageId)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userId, friendId, trimmed, now, options.replyToMessageId ?? null, options.forwardedFromMessageId ?? null);

  // A new message revives a chat the sender had "deleted": the row reappears
  // in the conversation list (and, symmetric, for the recipient if they had
  // deleted it too).
  const conversationId = conversationIdFor(userId, friendId);
  db.prepare('DELETE FROM conversationDeletions WHERE conversationId = ?').run(conversationId);

  const row = db.prepare('SELECT * FROM directMessages WHERE id = ?').get(id) as DirectMessageRow;
  return { ok: true, message: mapDirectMessage(userId, row) };
}

// ─── Message forwarding ──────────────────────────────────────────────────────

/** Forward an accessible message into an accepted-friend conversation. The
 *  original message is NEVER mutated — a new message row is created carrying
 *  forwardedFromMessageId metadata. */
export function forwardMessage(
  userId: string,
  messageId: string,
  toFriendId: string
): SendDirectMessageResult {
  const source = getMessageAccess(userId, messageId);
  if (!source.ok) return { ok: false, error: source.error };
  if (source.message.deletedForEveryone) {
    return { ok: false, error: Errors.messageNotFound() };
  }
  return sendDirectMessage(userId, toFriendId, source.message.text, {
    forwardedFromMessageId: messageId,
  });
}

// ─── Message pins ────────────────────────────────────────────────────────────

export function pinMessage(userId: string, messageId: string): { ok: boolean; pinned: boolean; error?: SocialError } {
  const access = getMessageAccess(userId, messageId);
  if (!access.ok) return { ok: false, pinned: false, error: access.error };
  const now = nowIso();
  db.prepare(
    `INSERT OR IGNORE INTO messagePins (id, messageId, conversationId, pinnedByUserId, createdAt)
     VALUES (?, ?, ?, ?, ?)`
  ).run(generateId(), messageId, access.conversationId, userId, now);
  return { ok: true, pinned: true };
}

export function unpinMessage(userId: string, messageId: string): { ok: boolean; pinned: boolean; error?: SocialError } {
  const access = getMessageAccess(userId, messageId);
  if (!access.ok) return { ok: false, pinned: false, error: access.error };
  db.prepare('DELETE FROM messagePins WHERE messageId = ? AND pinnedByUserId = ?').run(messageId, userId);
  return { ok: true, pinned: false };
}

export function isMessagePinnedByUser(userId: string, messageId: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 FROM messagePins WHERE messageId = ? AND pinnedByUserId = ?').get(messageId, userId)
  );
}

/** Pinned messages in a conversation the user can access (both participants'
 *  pins are visible — pinned message state is shared). Sorted newest first. */
export function listPinnedMessages(userId: string, friendId: string): { ok: boolean; messages?: DirectMessage[]; error?: SocialError } {
  if (!isAcceptedFriendship(userId, friendId)) return { ok: false, error: Errors.notFriends() };
  const conversationId = conversationIdFor(userId, friendId);
  const rows = db
    .prepare(
      `SELECT dm.* FROM messagePins mp
       JOIN directMessages dm ON dm.id = mp.messageId
       WHERE mp.conversationId = ?
         AND NOT EXISTS (SELECT 1 FROM messageDeletions md WHERE md.messageId = dm.id AND md.userId = ?)
       ORDER BY mp.createdAt DESC LIMIT 50`
    )
    .all(conversationId, userId) as DirectMessageRow[];
  return { ok: true, messages: rows.map((r) => mapDirectMessage(userId, r)) };
}

// ─── Message stars (user-specific) ───────────────────────────────────────────

export function starMessage(userId: string, messageId: string): { ok: boolean; starred: boolean; error?: SocialError } {
  const access = getMessageAccess(userId, messageId);
  if (!access.ok) return { ok: false, starred: false, error: access.error };
  db.prepare('INSERT OR IGNORE INTO starredMessages (id, userId, messageId, createdAt) VALUES (?, ?, ?, ?)').run(
    generateId(),
    userId,
    messageId,
    nowIso()
  );
  return { ok: true, starred: true };
}

export function unstarMessage(userId: string, messageId: string): { ok: boolean; starred: boolean; error?: SocialError } {
  const access = getMessageAccess(userId, messageId);
  if (!access.ok) return { ok: false, starred: false, error: access.error };
  db.prepare('DELETE FROM starredMessages WHERE userId = ? AND messageId = ?').run(userId, messageId);
  return { ok: true, starred: false };
}

export function isMessageStarredByUser(userId: string, messageId: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 FROM starredMessages WHERE userId = ? AND messageId = ?').get(userId, messageId)
  );
}

export interface StarredMessageItem {
  message: DirectMessage;
  friendId: string;
  peerName: string;
  peerUsername: string;
  starredAt: string;
}

/** The starring user's own starred list — never anyone else's. Messages from
 *  conversations the user can no longer access, or that were deleted for the
 *  user, are excluded. */
export function listStarredMessages(userId: string): StarredMessageItem[] {
  const rows = db
    .prepare(
      `SELECT dm.*, u.name AS peerName, u.username AS peerUsername, sm.createdAt AS starredAt,
              CASE WHEN dm.senderId = ? THEN dm.recipientId ELSE dm.senderId END AS peerId
       FROM starredMessages sm
       JOIN directMessages dm ON dm.id = sm.messageId
       JOIN users u ON u.id = CASE WHEN dm.senderId = ? THEN dm.recipientId ELSE dm.senderId END
       WHERE sm.userId = ?
         AND NOT EXISTS (SELECT 1 FROM messageDeletions md WHERE md.messageId = dm.id AND md.userId = ?)
       ORDER BY sm.createdAt DESC LIMIT 100`
    )
    .all(userId, userId, userId, userId) as (DirectMessageRow & { peerName: string; peerUsername: string; starredAt: string; peerId: string })[];

  return rows
    .filter((r) => isAcceptedFriendship(userId, r.peerId))
    .map((r) => ({
      message: mapDirectMessage(userId, r),
      friendId: r.peerId,
      peerName: r.peerName,
      peerUsername: r.peerUsername,
      starredAt: r.starredAt,
    }));
}

// ─── Delete for me / for everyone ────────────────────────────────────────────

/** Delete-for-me only hides the message for the acting user; the other
 *  participant's history is untouched. */
export function deleteMessageForMe(userId: string, messageId: string): { ok: boolean; error?: SocialError } {
  const access = getMessageAccess(userId, messageId);
  if (!access.ok) return { ok: false, error: access.error };
  db.prepare('INSERT OR IGNORE INTO messageDeletions (id, messageId, userId, deletedAt) VALUES (?, ?, ?, ?)').run(
    generateId(),
    messageId,
    userId,
    nowIso()
  );
  return { ok: true };
}

/** Server-authoritative window: only the ORIGINAL sender can delete for
 *  everyone, and only inside the configured window (default 15 minutes). The
 *  client timestamp is never trusted. */
export const DELETE_FOR_EVERYONE_WINDOW_MS = 15 * 60 * 1000;

export function deleteMessageForEveryone(
  userId: string,
  messageId: string,
  now = Date.now(),
  windowMs = DELETE_FOR_EVERYONE_WINDOW_MS
): { ok: boolean; message?: DirectMessage; error?: SocialError } {
  const access = getMessageAccess(userId, messageId);
  if (!access.ok) return { ok: false, error: access.error };
  if (access.message.senderId !== userId) return { ok: false, error: Errors.messageForbidden() };
  const age = now - Date.parse(access.message.createdAt);
  if (age > windowMs) return { ok: false, error: Errors.deleteWindowExpired() };

  const deletedAt = new Date(now).toISOString();
  db.prepare(
    `UPDATE directMessages SET deletedForEveryone = 1, deletedAt = ?, deletedByUserId = ? WHERE id = ?`
  ).run(deletedAt, userId, messageId);

  const row = db.prepare('SELECT * FROM directMessages WHERE id = ?').get(messageId) as DirectMessageRow;
  return { ok: true, message: mapDirectMessage(userId, row) };
}

// ─── Per-user conversation settings ──────────────────────────────────────────

interface ConversationSettingsRow {
  userId: string;
  conversationId: string;
  archived: number;
  pinned: number;
  favourite: number;
  locked: number;
  lastReadAt: string | null;
  lastReadMessageId: string | null;
  updatedAt: string;
}

export interface ConversationSettings {
  friendId: string;
  conversationId: string;
  archived: boolean;
  pinned: boolean;
  favourite: boolean;
  locked: boolean;
  lastReadAt: string | null;
  lastReadMessageId: string | null;
  hasLock: boolean;
}

function readSettings(userId: string, conversationId: string): ConversationSettingsRow | undefined {
  return db
    .prepare('SELECT * FROM conversationUserSettings WHERE userId = ? AND conversationId = ?')
    .get(userId, conversationId) as ConversationSettingsRow | undefined;
}

function settingsRowFor(userId: string, friendId: string): { ok: true; row: ConversationSettingsRow; conversationId: string } | { ok: false; error: SocialError } {
  if (!isAcceptedFriendship(userId, friendId)) return { ok: false, error: Errors.notFriends() };
  const conversationId = conversationIdFor(userId, friendId);
  const existing = readSettings(userId, conversationId);
  const row: ConversationSettingsRow =
    existing ?? {
      userId,
      conversationId,
      archived: 0,
      pinned: 0,
      favourite: 0,
      locked: 0,
      lastReadAt: null,
      lastReadMessageId: null,
      updatedAt: nowIso(),
    };
  return { ok: true, row, conversationId };
}

export function getConversationSettings(userId: string, friendId: string): { ok: boolean; settings?: ConversationSettings; error?: SocialError } {
  const found = settingsRowFor(userId, friendId);
  if (!found.ok) return { ok: false, error: found.error };
  const hasLock = Boolean(
    db.prepare('SELECT 1 FROM chatLocks WHERE userId = ? AND conversationId = ?').get(userId, found.conversationId)
  );
  return {
    ok: true,
    settings: {
      friendId,
      conversationId: found.conversationId,
      archived: Boolean(found.row.archived),
      pinned: Boolean(found.row.pinned),
      favourite: Boolean(found.row.favourite),
      locked: Boolean(found.row.locked),
      lastReadAt: found.row.lastReadAt,
      lastReadMessageId: found.row.lastReadMessageId,
      hasLock,
    },
  };
}

type SettingsPatch = Partial<Pick<ConversationSettingsRow, 'archived' | 'pinned' | 'favourite' | 'locked' | 'lastReadAt' | 'lastReadMessageId'>>;

/** Upsert a per-user conversation preference. `locked` always mirrors whether
 *  a chatLock row exists — the setting alone never grants/denies access. */
function updateSettings(userId: string, friendId: string, patch: SettingsPatch): { ok: boolean; settings?: ConversationSettings; error?: SocialError } {
  const found = settingsRowFor(userId, friendId);
  if (!found.ok) return { ok: false, error: found.error };
  const now = nowIso();
  db.prepare(
    `INSERT INTO conversationUserSettings (userId, conversationId, archived, pinned, favourite, locked, lastReadAt, lastReadMessageId, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (userId, conversationId) DO UPDATE SET
       archived = excluded.archived,
       pinned = excluded.pinned,
       favourite = excluded.favourite,
       locked = excluded.locked,
       lastReadAt = excluded.lastReadAt,
       lastReadMessageId = excluded.lastReadMessageId,
       updatedAt = excluded.updatedAt`
  ).run(
    userId,
    found.conversationId,
    patch.archived ?? found.row.archived,
    patch.pinned ?? found.row.pinned,
    patch.favourite ?? found.row.favourite,
    patch.locked ?? found.row.locked,
    patch.lastReadAt ?? found.row.lastReadAt,
    patch.lastReadMessageId ?? found.row.lastReadMessageId,
    now
  );
  const result = getConversationSettings(userId, friendId);
  return result.ok ? { ok: true, settings: result.settings } : { ok: false, error: result.error };
}

export function setConversationArchived(userId: string, friendId: string, archived: boolean) {
  return updateSettings(userId, friendId, { archived: archived ? 1 : 0 });
}
export function setConversationPinned(userId: string, friendId: string, pinned: boolean) {
  return updateSettings(userId, friendId, { pinned: pinned ? 1 : 0 });
}
export function setConversationFavourite(userId: string, friendId: string, favourite: boolean) {
  return updateSettings(userId, friendId, { favourite: favourite ? 1 : 0 });
}

/** Mark read: stores the current server time and the latest message id.
 *  Only ever triggered by actually opening/reading the conversation. */
export function markConversationRead(userId: string, friendId: string): { ok: boolean; settings?: ConversationSettings; error?: SocialError } {
  const found = settingsRowFor(userId, friendId);
  if (!found.ok) return { ok: false, error: found.error };
  const latest = db
    .prepare(
      `SELECT id FROM directMessages
       WHERE (senderId = ? AND recipientId = ?) OR (senderId = ? AND recipientId = ?)
       ORDER BY createdAt DESC LIMIT 1`
    )
    .get(userId, friendId, friendId, userId) as { id: string } | undefined;
  return updateSettings(userId, friendId, { lastReadAt: nowIso(), lastReadMessageId: latest?.id ?? null });
}

/** Mark unread: drop the read watermark entirely so every peer message counts
 *  as unread again. (updateSettings cannot express explicit NULLs because of
 *  its COALESCE-style fallbacks, so this runs its own upsert.) */
export function markConversationUnread(userId: string, friendId: string): { ok: boolean; settings?: ConversationSettings; error?: SocialError } {
  const found = settingsRowFor(userId, friendId);
  if (!found.ok) return { ok: false, error: found.error };
  const now = nowIso();
  db.prepare(
    `INSERT INTO conversationUserSettings (userId, conversationId, archived, pinned, favourite, locked, lastReadAt, lastReadMessageId, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)
     ON CONFLICT (userId, conversationId) DO UPDATE SET
       lastReadAt = NULL,
       lastReadMessageId = NULL,
       updatedAt = excluded.updatedAt`
  ).run(userId, found.conversationId, found.row.archived, found.row.pinned, found.row.favourite, found.row.locked, now);
  const result = getConversationSettings(userId, friendId);
  return result.ok ? { ok: true, settings: result.settings } : { ok: false, error: result.error };
}

// ─── Chat locks (application-level) ──────────────────────────────────────────

export const CHAT_LOCK_VERIFY_TTL_MS = 6 * 60 * 60 * 1000;

/** In-memory "verified for this view session" map. Verification is required
 *  before any locked content leaves the server; the client cannot simply flip
 *  a React flag. Ephemeral by design: restarts re-require the PIN. */
const verifiedChatLocks = new Map<string, number>();

function lockKey(userId: string, conversationId: string): string {
  return `${userId}:${conversationId}`;
}

export function isChatVerified(userId: string, conversationId: string, now = Date.now()): boolean {
  const expiry = verifiedChatLocks.get(lockKey(userId, conversationId));
  if (expiry === undefined) return false;
  if (expiry <= now) {
    verifiedChatLocks.delete(lockKey(userId, conversationId));
    return false;
  }
  return true;
}

export function markChatVerified(userId: string, conversationId: string, now = Date.now()): void {
  verifiedChatLocks.set(lockKey(userId, conversationId), now + CHAT_LOCK_VERIFY_TTL_MS);
}

export function clearChatVerification(userId: string, conversationId: string): void {
  verifiedChatLocks.delete(lockKey(userId, conversationId));
}

/** A conversation is locked (content must not leave the server) when a
 *  chatLocks row exists — the settings boolean always mirrors this. */
export function isChatLocked(userId: string, friendId: string): boolean {
  const conversationId = conversationIdFor(userId, friendId);
  return Boolean(db.prepare('SELECT 1 FROM chatLocks WHERE userId = ? AND conversationId = ?').get(userId, conversationId));
}

function lockRowFor(userId: string, friendId: string): { ok: true; row: { pinHash: string }; conversationId: string } | { ok: false; error: SocialError } {
  if (!isAcceptedFriendship(userId, friendId)) return { ok: false, error: Errors.notFriends() };
  const conversationId = conversationIdFor(userId, friendId);
  const row = db.prepare('SELECT pinHash FROM chatLocks WHERE userId = ? AND conversationId = ?').get(userId, conversationId) as
    | { pinHash: string }
    | undefined;
  if (!row) return { ok: false, error: Errors.lockRequired() };
  return { ok: true, row, conversationId };
}

/** Set (or reset) the lock PIN. Only a server-side Argon2id hash is stored. */
export async function setChatLockPin(
  userId: string,
  friendId: string,
  pin: string
): Promise<{ ok: boolean; settings?: ConversationSettings; error?: SocialError }> {
  if (!isAcceptedFriendship(userId, friendId)) return { ok: false, error: Errors.notFriends() };
  if (typeof pin !== 'string' || pin.length < 4 || pin.length > 64) {
    return { ok: false, error: Errors.validation('PIN must be 4–64 characters.') };
  }
  const conversationId = conversationIdFor(userId, friendId);
  const pinHash = await hashPassword(pin);
  const now = nowIso();
  db.prepare(
    `INSERT INTO chatLocks (id, userId, conversationId, pinHash, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (userId, conversationId) DO UPDATE SET pinHash = excluded.pinHash, updatedAt = excluded.updatedAt`
  ).run(generateId(), userId, conversationId, pinHash, now, now);
  const result = updateSettings(userId, friendId, { locked: 1 });
  return result.ok ? { ok: true, settings: result.settings } : { ok: false, error: result.error };
}

/** Remove an existing lock after verifying the PIN. */
export async function unlockChat(
  userId: string,
  friendId: string,
  pin: string
): Promise<{ ok: boolean; settings?: ConversationSettings; error?: SocialError }> {
  const found = lockRowFor(userId, friendId);
  if (!found.ok) return { ok: false, error: found.error };
  const valid = await verifyPassword(found.row.pinHash, pin);
  if (!valid) return { ok: false, error: Errors.lockInvalid() };
  db.prepare('DELETE FROM chatLocks WHERE userId = ? AND conversationId = ?').run(userId, found.conversationId);
  clearChatVerification(userId, found.conversationId);
  const result = updateSettings(userId, friendId, { locked: 0 });
  return result.ok ? { ok: true, settings: result.settings } : { ok: false, error: result.error };
}

/** Verify the PIN for a view session — the lock stays in place. */
export async function verifyChatLock(
  userId: string,
  friendId: string,
  pin: string
): Promise<{ ok: boolean; settings?: ConversationSettings; error?: SocialError }> {
  const found = lockRowFor(userId, friendId);
  if (!found.ok) return { ok: false, error: found.error };
  const valid = await verifyPassword(found.row.pinHash, pin);
  if (!valid) return { ok: false, error: Errors.lockInvalid() };
  markChatVerified(userId, found.conversationId);
  const result = getConversationSettings(userId, friendId);
  return result.ok ? { ok: true, settings: result.settings } : { ok: false, error: result.error };
}

// ─── Clear chat / delete chat (per-user) ─────────────────────────────────────

/** "Clear chat": tombstone every message of the conversation for the acting
 *  user only. Shared rows and the other user's history are untouched. */
export function clearChat(userId: string, friendId: string): { ok: boolean; deletedCount: number; error?: SocialError } {
  if (!isAcceptedFriendship(userId, friendId)) return { ok: false, deletedCount: 0, error: Errors.notFriends() };
  const now = nowIso();
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO messageDeletions (id, messageId, userId, deletedAt)
       SELECT id || ':' || ?, id, ?, ? FROM directMessages
       WHERE (senderId = ? AND recipientId = ?) OR (senderId = ? AND recipientId = ?)`
    )
    .run(userId, userId, now, userId, friendId, friendId, userId);
  return { ok: true, deletedCount: result.changes };
}

/** "Delete chat": hide the conversation for the acting user (and tombstone
 *  their copy of the messages). The other user's history is preserved. */
export function deleteChatForUser(userId: string, friendId: string): { ok: boolean; error?: SocialError } {
  if (!isAcceptedFriendship(userId, friendId)) return { ok: false, error: Errors.notFriends() };
  const conversationId = conversationIdFor(userId, friendId);
  db.prepare(
    'INSERT OR IGNORE INTO conversationDeletions (id, userId, conversationId, deletedAt) VALUES (?, ?, ?, ?)'
  ).run(generateId(), userId, conversationId, nowIso());
  clearChat(userId, friendId);
  return { ok: true };
}

// ─── Custom conversation lists (private to the owner) ────────────────────────

export interface ConversationList {
  id: string;
  name: string;
  createdAt: string;
  /** Canonical conversation ids of the members. */
  conversationIds: string[];
}

export function listConversationLists(userId: string): ConversationList[] {
  const rows = db.prepare('SELECT * FROM conversationLists WHERE userId = ? ORDER BY createdAt ASC').all(userId) as {
    id: string;
    name: string;
    createdAt: string;
  }[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    conversationIds: (
      db.prepare('SELECT conversationId FROM conversationListMembers WHERE listId = ?').all(row.id) as { conversationId: string }[]
    ).map((r) => r.conversationId),
  }));
}

function getOwnedList(userId: string, listId: string): { id: string; name: string } | null {
  const row = db.prepare('SELECT id, name FROM conversationLists WHERE id = ? AND userId = ?').get(listId, userId) as
    | { id: string; name: string }
    | undefined;
  return row ?? null;
}

export function createConversationList(userId: string, name: string): { ok: boolean; list?: ConversationList; error?: SocialError } {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: Errors.validation('List name cannot be empty.') };
  if (trimmed.length > 60) return { ok: false, error: Errors.validation('List name is too long (max 60 characters).') };
  const id = generateId();
  db.prepare('INSERT INTO conversationLists (id, userId, name, createdAt) VALUES (?, ?, ?, ?)').run(id, userId, trimmed, nowIso());
  return { ok: true, list: { id, name: trimmed, createdAt: nowIso(), conversationIds: [] } };
}

export function renameConversationList(userId: string, listId: string, name: string): { ok: boolean; error?: SocialError } {
  if (!getOwnedList(userId, listId)) return { ok: false, error: Errors.listNotFound() };
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: Errors.validation('List name cannot be empty.') };
  if (trimmed.length > 60) return { ok: false, error: Errors.validation('List name is too long (max 60 characters).') };
  db.prepare('UPDATE conversationLists SET name = ? WHERE id = ? AND userId = ?').run(trimmed, listId, userId);
  return { ok: true };
}

export function deleteConversationList(userId: string, listId: string): { ok: boolean; error?: SocialError } {
  if (!getOwnedList(userId, listId)) return { ok: false, error: Errors.listNotFound() };
  db.prepare('DELETE FROM conversationLists WHERE id = ? AND userId = ?').run(listId, userId);
  return { ok: true };
}

export function addConversationToList(userId: string, listId: string, friendId: string): { ok: boolean; error?: SocialError } {
  const list = getOwnedList(userId, listId);
  if (!list) return { ok: false, error: Errors.listNotFound() };
  if (!isAcceptedFriendship(userId, friendId)) return { ok: false, error: Errors.notFriends() };
  const conversationId = conversationIdFor(userId, friendId);
  db.prepare(
    'INSERT OR IGNORE INTO conversationListMembers (id, listId, conversationId, createdAt) VALUES (?, ?, ?, ?)'
  ).run(generateId(), listId, conversationId, nowIso());
  return { ok: true };
}

export function removeConversationFromList(userId: string, listId: string, friendId: string): { ok: boolean; error?: SocialError } {
  if (!getOwnedList(userId, listId)) return { ok: false, error: Errors.listNotFound() };
  const conversationId = conversationIdFor(userId, friendId);
  db.prepare('DELETE FROM conversationListMembers WHERE listId = ? AND conversationId = ?').run(listId, conversationId);
  return { ok: true };
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
