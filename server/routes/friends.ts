// server/routes/friends.ts
// Friend list + request inbox/outbox + accept/reject.
// All routes require a session; authorization is re-validated server-side.

import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { apiError } from '../auth/auth';
import {
  listFriends,
  listFriendRequests,
  acceptFriendRequest,
  rejectFriendRequest,
  getUserById,
} from '../social/service';
import { emitUserEvent } from '../social/realtime';

export const friends = new Hono();

friends.use('*', requireAuth);

// ─── GET /api/friends — accepted friends with live presence ─────────────────

friends.get('/', (c) => {
  const userId = c.get('userId');
  return c.json({ friends: listFriends(userId) });
});

// ─── GET /api/friends/requests — pending request inbox + outbox ─────────────

friends.get('/requests', (c) => {
  const userId = c.get('userId');
  const { incoming, outgoing } = listFriendRequests(userId);
  return c.json({ incoming, outgoing });
});

// ─── POST /api/friends/requests/:id/accept — accept an incoming request ─────

friends.post('/requests/:id/accept', (c) => {
  const userId = c.get('userId');
  const result = acceptFriendRequest(userId, c.req.param('id'));
  if (!result.ok) {
    const err = result.error!;
    return c.json(apiError(err.code, err.message), err.code === 'REQUEST_NOT_FOUND' ? 404 : 400);
  }

  if (result.otherUser) {
    const me = getUserById(userId);
    emitUserEvent(result.friendship!.requesterId, 'friend:accepted', {
      friendshipId: result.friendship!.id,
      friend: {
        id: userId,
        name: me?.name ?? 'Someone',
        username: me?.username ?? '',
        avatarUrl: me?.avatarUrl ?? null,
      },
      acceptedAt: result.friendship!.acceptedAt,
    });
  }

  return c.json({ friendship: result.friendship, friend: result.otherUser });
});

// ─── POST /api/friends/requests/:id/reject — reject an incoming request ─────

friends.post('/requests/:id/reject', (c) => {
  const userId = c.get('userId');
  const result = rejectFriendRequest(userId, c.req.param('id'));
  if (!result.ok) {
    const err = result.error!;
    return c.json(apiError(err.code, err.message), err.code === 'REQUEST_NOT_FOUND' ? 404 : 400);
  }
  return c.json({ ok: true });
});
