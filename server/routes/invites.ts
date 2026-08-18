// server/routes/invites.ts
// Watch invitations. An invite never creates a friendship (the sender must
// already be friends with the recipient) and never joins anyone to a room —
// accepting returns the room code and the client uses its normal join flow.

import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { apiError } from '../auth/auth';
import { rateLimit } from '../rate-limit';
import { listWatchInvites, sendWatchInvite, respondWatchInvite } from '../social/service';
import { emitUserEvent } from '../social/realtime';

export const invites = new Hono();

invites.use('*', requireAuth);

function inviteErrorStatus(code: string): 400 | 403 | 404 | 409 {
  switch (code) {
    case 'INVITE_NOT_FOUND':
    case 'ROOM_NOT_FOUND':
      return 404;
    case 'FRIENDSHIP_REQUIRED':
    case 'ROOM_MEMBERSHIP_REQUIRED':
      return 403;
    case 'INVITE_EXPIRED':
    case 'ROOM_GONE':
      return 409;
    default:
      return 400;
  }
}

// ─── GET /api/watch-invites — pending invites (incoming + outgoing) ──────────

invites.get('/', (c) => {
  const userId = c.get('userId');
  return c.json({ invites: listWatchInvites(userId) });
});

// ─── POST /api/watch-invites — invite a friend to your room ─────────────────

invites.post('/', async (c) => {
  const userId = c.get('userId');

  const tooMany = rateLimit(c, `watchInvite:${userId}`, 'watchInvite');
  if (tooMany) return tooMany;

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json(apiError('VALIDATION_ERROR', 'Invalid request body.'), 400);
  }
  const { recipientUserId, roomId } = body as Record<string, unknown>;
  if (typeof recipientUserId !== 'string' || typeof roomId !== 'string') {
    return c.json(apiError('VALIDATION_ERROR', 'recipientUserId and roomId are required.'), 400);
  }

  const result = sendWatchInvite(userId, recipientUserId, roomId);
  if (!result.ok) {
    const err = result.error!;
    return c.json(apiError(err.code, err.message), inviteErrorStatus(err.code));
  }

  emitUserEvent(recipientUserId, 'watch:invite', { invite: result.invite });
  return c.json({ invite: result.invite });
});

// ─── POST /api/watch-invites/:id/accept — accept and return the room ─────────

invites.post('/:id/accept', (c) => {
  const userId = c.get('userId');
  const result = respondWatchInvite(userId, c.req.param('id'), 'accepted');
  if (!result.ok) {
    const err = result.error!;
    return c.json(apiError(err.code, err.message), inviteErrorStatus(err.code));
  }

  emitUserEvent(result.invite!.sender.id, 'watch:invite:accepted', {
    inviteId: result.invite!.id,
    roomCode: result.roomCode,
    recipientId: userId,
  });

  return c.json({ invite: result.invite, roomCode: result.roomCode });
});

// ─── POST /api/watch-invites/:id/decline — decline an invite ─────────────────

invites.post('/:id/decline', (c) => {
  const userId = c.get('userId');
  const result = respondWatchInvite(userId, c.req.param('id'), 'declined');
  if (!result.ok) {
    const err = result.error!;
    return c.json(apiError(err.code, err.message), inviteErrorStatus(err.code));
  }

  emitUserEvent(result.invite!.sender.id, 'watch:invite:declined', {
    inviteId: result.invite!.id,
    recipientId: userId,
  });

  return c.json({ invite: result.invite });
});
