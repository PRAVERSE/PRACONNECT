// server/routes/messages.ts
// Direct messages + the message/conversation context features: replies,
// forwarding, pins, stars, per-user deletions, conversation preferences,
// chat locks, clear/delete chat, and private conversation lists.
//
// Authorization invariants (never trust the body for identity):
//   - userId always comes from the authenticated session
//   - every mutation verifies accepted-friendship membership of the pair
//   - per-user rows (stars, settings, lists, deletions) are keyed by the
//     session userId, never by a client-supplied owner id
//   - delete-for-everyone requires the original sender AND the time window
//   - locked conversations require a verified PIN before content leaves

import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { apiError } from '../auth/auth';
import { rateLimit } from '../rate-limit';
import {
  listConversations,
  listDirectMessages,
  sendDirectMessage,
  getUserById,
  getMessageAccess,
  getMessageRow,
  forwardMessage,
  pinMessage,
  unpinMessage,
  listPinnedMessages,
  starMessage,
  unstarMessage,
  listStarredMessages,
  deleteMessageForMe,
  deleteMessageForEveryone,
  getConversationSettings,
  setConversationArchived,
  setConversationPinned,
  setConversationFavourite,
  markConversationRead,
  markConversationUnread,
  setChatLockPin,
  unlockChat,
  verifyChatLock,
  isChatLocked,
  isChatVerified,
  clearChat,
  deleteChatForUser,
  listConversationLists,
  createConversationList,
  renameConversationList,
  deleteConversationList,
  addConversationToList,
  removeConversationFromList,
  conversationIdFor,
  isAcceptedFriendship,
} from '../social/service';
import { emitUserEvent } from '../social/realtime';

export const messages = new Hono();

messages.use('*', requireAuth);

function serviceStatus(code: string): number {
  switch (code) {
    case 'FRIENDSHIP_REQUIRED':
    case 'MESSAGE_FORBIDDEN':
    case 'LOCK_REQUIRED':
      return 403;
    case 'CONVERSATION_NOT_FOUND':
    case 'MESSAGE_NOT_FOUND':
    case 'LIST_NOT_FOUND':
      return 404;
    case 'LOCK_INVALID':
    case 'DELETE_WINDOW_EXPIRED':
      return 409;
    default:
      return 400;
  }
}

function serviceError(c: { json: (body: unknown, status?: number) => Response }, code: string, message: string): Response {
  return c.json(apiError(code, message), serviceStatus(code));
}

function readBody(body: Record<string, unknown> | null, key: string): unknown {
  return body && typeof body === 'object' ? (body as Record<string, unknown>)[key] : undefined;
}

// ─── GET /api/messages/conversations — conversation list (per-user settings) ─

messages.get('/conversations', (c) => {
  const userId = c.get('userId');
  return c.json({ conversations: listConversations(userId) });
});

// ─── GET /api/messages/starred — the user's own starred messages ────────────

messages.get('/starred', (c) => {
  const userId = c.get('userId');
  return c.json({ starred: listStarredMessages(userId) });
});

// ─── Custom conversation lists (private to the owner) ───────────────────────

messages.get('/lists', (c) => {
  const userId = c.get('userId');
  return c.json({ lists: listConversationLists(userId) });
});

messages.post('/lists', async (c) => {
  const userId = c.get('userId');
  const tooMany = rateLimit(c, `dmConversationSettings:${userId}`, 'dmConversationSettings');
  if (tooMany) return tooMany;
  const body = await c.req.json().catch(() => null);
  const name = typeof readBody(body, 'name') === 'string' ? (readBody(body, 'name') as string) : '';
  const result = createConversationList(userId, name);
  if (!result.ok) return serviceError(c, result.error!.code, result.error!.message);
  return c.json({ list: result.list });
});

messages.post('/lists/:listId/rename', async (c) => {
  const userId = c.get('userId');
  const tooMany = rateLimit(c, `dmConversationSettings:${userId}`, 'dmConversationSettings');
  if (tooMany) return tooMany;
  const body = await c.req.json().catch(() => null);
  const name = typeof readBody(body, 'name') === 'string' ? (readBody(body, 'name') as string) : '';
  const result = renameConversationList(userId, c.req.param('listId'), name);
  if (!result.ok) return serviceError(c, result.error!.code, result.error!.message);
  return c.json({ ok: true });
});

messages.delete('/lists/:listId', (c) => {
  const userId = c.get('userId');
  const result = deleteConversationList(userId, c.req.param('listId'));
  if (!result.ok) return serviceError(c, result.error!.code, result.error!.message);
  emitUserEvent(userId, 'conversation:updated', { conversationId: null, friendId: null });
  return c.json({ ok: true });
});

messages.post('/lists/:listId/members', async (c) => {
  const userId = c.get('userId');
  const tooMany = rateLimit(c, `dmConversationSettings:${userId}`, 'dmConversationSettings');
  if (tooMany) return tooMany;
  const body = await c.req.json().catch(() => null);
  const friendId = typeof readBody(body, 'friendId') === 'string' ? (readBody(body, 'friendId') as string) : '';
  const result = addConversationToList(userId, c.req.param('listId'), friendId);
  if (!result.ok) return serviceError(c, result.error!.code, result.error!.message);
  return c.json({ ok: true });
});

messages.delete('/lists/:listId/members/:friendId', (c) => {
  const userId = c.get('userId');
  const result = removeConversationFromList(userId, c.req.param('listId'), c.req.param('friendId'));
  if (!result.ok) return serviceError(c, result.error!.code, result.error!.message);
  return c.json({ ok: true });
});

// ─── GET /api/messages/conversations/:id/pinned — pinned messages ───────────

messages.get('/conversations/:id/pinned', (c) => {
  const userId = c.get('userId');
  const friendId = c.req.param('id');
  const result = listPinnedMessages(userId, friendId);
  if (!result.ok) return serviceError(c, result.error!.code, result.error!.message);
  return c.json({ messages: result.messages });
});

// ─── Conversation settings / actions ────────────────────────────────────────

messages.get('/conversations/:id/settings', (c) => {
  const userId = c.get('userId');
  const result = getConversationSettings(userId, c.req.param('id'));
  if (!result.ok) return serviceError(c, result.error!.code, result.error!.message);
  return c.json({ settings: result.settings });
});

async function settingsAction(c: { req: { param: (k: string) => string }; json: (body: unknown, status?: number) => Response }, action: () => { ok: boolean; settings?: unknown; error?: { code: string; message: string } }) {
  const result = action();
  if (!result.ok) return serviceError(c, result.error!.code, result.error!.message);
  return c.json({ settings: result.settings });
}

messages.post('/conversations/:id/archive', (c) => {
  const userId = c.get('userId');
  return settingsAction(c, () => setConversationArchived(userId, c.req.param('id'), true));
});
messages.post('/conversations/:id/unarchive', (c) => {
  const userId = c.get('userId');
  return settingsAction(c, () => setConversationArchived(userId, c.req.param('id'), false));
});
messages.post('/conversations/:id/pin', (c) => {
  const userId = c.get('userId');
  return settingsAction(c, () => setConversationPinned(userId, c.req.param('id'), true));
});
messages.delete('/conversations/:id/pin', (c) => {
  const userId = c.get('userId');
  return settingsAction(c, () => setConversationPinned(userId, c.req.param('id'), false));
});
messages.post('/conversations/:id/read', (c) => {
  const userId = c.get('userId');
  const tooMany = rateLimit(c, `dmConversationSettings:${userId}`, 'dmConversationSettings');
  if (tooMany) return tooMany;
  return settingsAction(c, () => markConversationRead(userId, c.req.param('id')));
});
messages.post('/conversations/:id/unread', (c) => {
  const userId = c.get('userId');
  const tooMany = rateLimit(c, `dmConversationSettings:${userId}`, 'dmConversationSettings');
  if (tooMany) return tooMany;
  return settingsAction(c, () => markConversationUnread(userId, c.req.param('id')));
});
messages.post('/conversations/:id/favourite', (c) => {
  const userId = c.get('userId');
  return settingsAction(c, () => setConversationFavourite(userId, c.req.param('id'), true));
});
messages.delete('/conversations/:id/favourite', (c) => {
  const userId = c.get('userId');
  return settingsAction(c, () => setConversationFavourite(userId, c.req.param('id'), false));
});

// ─── Clear / delete chat (per-user) ─────────────────────────────────────────

messages.post('/conversations/:id/clear', (c) => {
  const userId = c.get('userId');
  const tooMany = rateLimit(c, `dmDelete:${userId}`, 'dmDelete');
  if (tooMany) return tooMany;
  const result = clearChat(userId, c.req.param('id'));
  if (!result.ok) return serviceError(c, result.error!.code, result.error!.message);
  emitUserEvent(userId, 'conversation:updated', { conversationId: conversationIdFor(userId, c.req.param('id')), friendId: c.req.param('id') });
  return c.json({ ok: true, deletedCount: result.deletedCount });
});

messages.delete('/conversations/:id', (c) => {
  const userId = c.get('userId');
  const tooMany = rateLimit(c, `dmDelete:${userId}`, 'dmDelete');
  if (tooMany) return tooMany;
  const result = deleteChatForUser(userId, c.req.param('id'));
  if (!result.ok) return serviceError(c, result.error!.code, result.error!.message);
  emitUserEvent(userId, 'conversation:updated', { conversationId: conversationIdFor(userId, c.req.param('id')), friendId: c.req.param('id') });
  return c.json({ ok: true });
});

// ─── Chat locks ──────────────────────────────────────────────────────────────

messages.post('/conversations/:id/lock', async (c) => {
  const userId = c.get('userId');
  const tooMany = rateLimit(c, `dmLock:${userId}`, 'dmLock');
  if (tooMany) return tooMany;
  const body = await c.req.json().catch(() => null);
  const pin = typeof readBody(body, 'pin') === 'string' ? (readBody(body, 'pin') as string) : '';
  const result = await setChatLockPin(userId, c.req.param('id'), pin);
  if (!result.ok) return serviceError(c, result.error!.code, result.error!.message);
  emitUserEvent(userId, 'conversation:updated', { conversationId: result.settings?.conversationId, friendId: c.req.param('id') });
  return c.json({ settings: result.settings });
});

messages.post('/conversations/:id/unlock', async (c) => {
  const userId = c.get('userId');
  const tooMany = rateLimit(c, `dmLock:${userId}`, 'dmLock');
  if (tooMany) return tooMany;
  const body = await c.req.json().catch(() => null);
  const pin = typeof readBody(body, 'pin') === 'string' ? (readBody(body, 'pin') as string) : '';
  const result = await unlockChat(userId, c.req.param('id'), pin);
  if (!result.ok) return serviceError(c, result.error!.code, result.error!.message);
  emitUserEvent(userId, 'conversation:updated', { conversationId: result.settings?.conversationId, friendId: c.req.param('id') });
  return c.json({ settings: result.settings });
});

messages.post('/conversations/:id/verify', async (c) => {
  const userId = c.get('userId');
  const tooMany = rateLimit(c, `dmLock:${userId}`, 'dmLock');
  if (tooMany) return tooMany;
  const body = await c.req.json().catch(() => null);
  const pin = typeof readBody(body, 'pin') === 'string' ? (readBody(body, 'pin') as string) : '';
  const result = await verifyChatLock(userId, c.req.param('id'), pin);
  if (!result.ok) return serviceError(c, result.error!.code, result.error!.message);
  return c.json({ settings: result.settings });
});

// ─── GET /api/messages/:friendId — message history ──────────────────────────

messages.get('/:friendId', (c) => {
  const userId = c.get('userId');
  const friendId = c.req.param('friendId');

  const rawLimit = c.req.query('limit') ?? '50';
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit <= 0) {
    return c.json(apiError('VALIDATION_ERROR', 'Invalid limit parameter.'), 400);
  }

  // Locked conversations never release message bodies without verification.
  if (isChatLocked(userId, friendId) && !isChatVerified(userId, conversationIdFor(userId, friendId))) {
    return c.json(apiError('LOCK_REQUIRED', 'This conversation is locked.'), 403);
  }

  const result = listDirectMessages(userId, friendId, limit);
  if (!result.ok) {
    const err = result.error!;
    return serviceError(c, err.code, err.message);
  }
  // Opening the conversation is the ONLY normal read-state trigger.
  markConversationRead(userId, friendId);
  return c.json({ messages: result.messages });
});

// ─── POST /api/messages/:friendId — send a message (optionally a reply) ─────

messages.post('/:friendId', async (c) => {
  const userId = c.get('userId');
  const friendId = c.req.param('friendId');

  const tooMany = rateLimit(c, `dmSend:${userId}`, 'dmSend');
  if (tooMany) return tooMany;

  if (isChatLocked(userId, friendId) && !isChatVerified(userId, conversationIdFor(userId, friendId))) {
    return c.json(apiError('LOCK_REQUIRED', 'This conversation is locked.'), 403);
  }

  const body = await c.req.json().catch(() => null);
  const text = typeof readBody(body, 'text') === 'string' ? (readBody(body, 'text') as string) : '';
  const replyToMessageId =
    typeof readBody(body, 'replyToMessageId') === 'string' ? (readBody(body, 'replyToMessageId') as string) : undefined;
  const forwardedFromMessageId =
    typeof readBody(body, 'forwardedFromMessageId') === 'string'
      ? (readBody(body, 'forwardedFromMessageId') as string)
      : undefined;

  const result = sendDirectMessage(userId, friendId, text, { replyToMessageId, forwardedFromMessageId });
  if (!result.ok) {
    const err = result.error!;
    return serviceError(c, err.code, err.message);
  }

  const payload = { message: result.message, senderName: getUserById(userId)?.name ?? 'You', recipientId: friendId };
  // Notify both parties: the recipient shows it live, the sender's other
  // tabs (conversation preview) re-sync.
  emitUserEvent(friendId, 'dm:new', payload);
  if (userId !== friendId) emitUserEvent(userId, 'dm:new', payload);
  return c.json(payload);
});

// ─── POST /api/messages/:messageId/forward — forward to an accepted friend ──

messages.post('/:messageId/forward', async (c) => {
  const userId = c.get('userId');
  const messageId = c.req.param('messageId');

  const tooMany = rateLimit(c, `dmForward:${userId}`, 'dmForward');
  if (tooMany) return tooMany;

  const body = await c.req.json().catch(() => null);
  const toFriendId = typeof readBody(body, 'toFriendId') === 'string' ? (readBody(body, 'toFriendId') as string) : '';
  if (!toFriendId || !isAcceptedFriendship(userId, toFriendId)) {
    return c.json(apiError('FRIENDSHIP_REQUIRED', 'You must be friends to do that.'), 403);
  }
  if (isChatLocked(userId, toFriendId) && !isChatVerified(userId, conversationIdFor(userId, toFriendId))) {
    return c.json(apiError('LOCK_REQUIRED', 'This conversation is locked.'), 403);
  }

  const result = forwardMessage(userId, messageId, toFriendId);
  if (!result.ok) {
    const err = result.error!;
    return serviceError(c, err.code, err.message);
  }

  const payload = { message: result.message!, senderName: getUserById(userId)?.name ?? 'You', recipientId: toFriendId };
  emitUserEvent(toFriendId, 'dm:new', payload);
  if (userId !== toFriendId) emitUserEvent(userId, 'dm:new', payload);
  return c.json(payload);
});

// ─── Message pins ────────────────────────────────────────────────────────────

messages.post('/:messageId/pin', (c) => {
  const userId = c.get('userId');
  const tooMany = rateLimit(c, `dmPin:${userId}`, 'dmPin');
  if (tooMany) return tooMany;
  const result = pinMessage(userId, c.req.param('messageId'));
  if (!result.ok) return serviceError(c, result.error!.code, result.error!.message);
  emitMessagePinEvent(userId, c, c.req.param('messageId'), 'dm:pinned');
  return c.json({ ok: true, pinned: true });
});

messages.delete('/:messageId/pin', (c) => {
  const userId = c.get('userId');
  const tooMany = rateLimit(c, `dmPin:${userId}`, 'dmPin');
  if (tooMany) return tooMany;
  const result = unpinMessage(userId, c.req.param('messageId'));
  if (!result.ok) return serviceError(c, result.error!.code, result.error!.message);
  emitMessagePinEvent(userId, c, c.req.param('messageId'), 'dm:unpinned');
  return c.json({ ok: true, pinned: false });
});

/** Broadcast a pin/unpin to BOTH participants (pinned message state is
 *  shared). Private per-user flags never ride this event. */
function emitMessagePinEvent(userId: string, c: { req: { param: (k: string) => string } }, messageId: string, type: string): void {
  const result = getMessageAccess(userId, messageId);
  if (!result.ok) return;
  emitUserEvent(userId, type, { messageId, friendId: result.peerId, pinnedByUserId: userId });
  emitUserEvent(result.peerId, type, { messageId, friendId: userId, pinnedByUserId: userId });
}

// ─── Message stars (user-specific) ───────────────────────────────────────────

messages.post('/:messageId/star', (c) => {
  const userId = c.get('userId');
  const tooMany = rateLimit(c, `dmStar:${userId}`, 'dmStar');
  if (tooMany) return tooMany;
  const result = starMessage(userId, c.req.param('messageId'));
  if (!result.ok) return serviceError(c, result.error!.code, result.error!.message);
  return c.json({ ok: true, starred: true });
});

messages.delete('/:messageId/star', (c) => {
  const userId = c.get('userId');
  const tooMany = rateLimit(c, `dmStar:${userId}`, 'dmStar');
  if (tooMany) return tooMany;
  const result = unstarMessage(userId, c.req.param('messageId'));
  if (!result.ok) return serviceError(c, result.error!.code, result.error!.message);
  return c.json({ ok: true, starred: false });
});

// ─── Delete for me / for everyone ────────────────────────────────────────────

messages.post('/:messageId/delete-for-me', (c) => {
  const userId = c.get('userId');
  const tooMany = rateLimit(c, `dmDelete:${userId}`, 'dmDelete');
  if (tooMany) return tooMany;
  const result = deleteMessageForMe(userId, c.req.param('messageId'));
  if (!result.ok) return serviceError(c, result.error!.code, result.error!.message);
  return c.json({ ok: true });
});

messages.post('/:messageId/delete-for-everyone', (c) => {
  const userId = c.get('userId');
  const tooMany = rateLimit(c, `dmDelete:${userId}`, 'dmDelete');
  if (tooMany) return tooMany;
  const result = deleteMessageForEveryone(userId, c.req.param('messageId'));
  if (!result.ok) return serviceError(c, result.error!.code, result.error!.message);

  // Both participants learn about the deletion live; the body is already
  // stripped server-side and can never be reconstructed from the event.
  const payload = { message: { id: result.message!.id, senderId: result.message!.senderId, deletedForEveryone: true } };
  emitUserEvent(userId, 'dm:deleted', payload);
  const peerId = getPeerFromMessage(result.message!.id);
  if (peerId && peerId !== userId) emitUserEvent(peerId, 'dm:deleted', payload);
  return c.json({ message: result.message });
});

function getPeerFromMessage(messageId: string): string | null {
  const row = getMessageRow(messageId);
  return row ? row.recipientId : null;
}
