// server/routes/users.ts
// User directory + friend requests + the user-scoped social event stream.
// All routes require a session; identity always comes from the session, never
// from client input.

import { Hono } from 'hono';
import type { Context } from 'hono';
import { requireAuth } from '../middleware/auth';
import { apiError } from '../auth/auth';
import { rateLimit } from '../rate-limit';
import {
  searchUsers,
  sendFriendRequest,
  getUserById,
  type FriendRequestResult,
} from '../social/service';
import { openUserEventStream, emitUserEvent } from '../social/realtime';

export const users = new Hono();

users.use('*', requireAuth);

function serviceErrorStatus(code: string): 400 | 403 | 404 | 409 {
  switch (code) {
    case 'USER_NOT_FOUND':
    case 'REQUEST_NOT_FOUND':
    case 'INVITE_NOT_FOUND':
      return 404;
    case 'CANNOT_FRIEND_SELF':
    case 'ALREADY_FRIENDS':
    case 'REQUEST_ALREADY_SENT':
    case 'FRIENDSHIP_REQUIRED':
    case 'INVITE_EXPIRED':
    case 'ROOM_GONE':
      return 409;
    default:
      return 400;
  }
}

function sendFriendResult(c: Context, result: FriendRequestResult) {
  if (!result.ok) {
    const err = result.error!;
    return c.json({ error: { code: err.code, message: err.message } }, serviceErrorStatus(err.code));
  }
  return c.json({ request: result.request });
}

// ─── GET /api/users/search — public directory (authenticated) ───────────────

users.get('/search', (c) => {
  const userId = c.get('userId');
  const tooMany = rateLimit(c, `userSearch:${userId}`, 'userSearch');
  if (tooMany) return tooMany;

  const rawQuery = c.req.query('q') ?? '';
  if (rawQuery.length > 60) {
    return c.json(apiError('VALIDATION_ERROR', 'Search query is too long (max 60 characters).'), 400);
  }
  const rawLimit = c.req.query('limit') ?? '20';
  const rawOffset = c.req.query('offset') ?? '0';
  const limit = Number(rawLimit);
  const offset = Number(rawOffset);
  if (!Number.isInteger(limit) || !Number.isInteger(offset) || limit <= 0 || offset < 0) {
    return c.json(apiError('VALIDATION_ERROR', 'Invalid pagination parameters.'), 400);
  }

  const result = searchUsers(userId, rawQuery, limit, offset);
  return c.json({ users: result.users, total: result.total, nextOffset: result.nextOffset });
});

// ─── POST /api/users/:userId/friend-request — send a friend request ─────────

users.post('/:userId/friend-request', async (c) => {
  const userId = c.get('userId');
  const targetId = c.req.param('userId');

  if (targetId === userId) {
    return c.json(apiError('CANNOT_FRIEND_SELF', 'You cannot send a friend request to yourself.'), 400);
  }
  const tooMany = rateLimit(c, `friendRequest:${userId}:${targetId}`, 'friendRequest');
  if (tooMany) return tooMany;

  const target = getUserById(targetId);
  if (!target) {
    return c.json(apiError('USER_NOT_FOUND', 'User not found.'), 404);
  }

  const result = sendFriendRequest(userId, targetId);
  if (result.ok) {
    emitUserEvent(targetId, 'friend:request', {
      requestId: result.request!.id,
      requester: result.request!.requester,
      createdAt: result.request!.createdAt,
    });
  }
  return sendFriendResult(c, result);
});

// ─── GET /api/users/events — live social event stream (SSE) ─────────────────

users.get('/events', (c) => {
  const userId = c.get('userId');
  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      cleanup = openUserEventStream(
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
    },
    cancel() {
      cleanup?.();
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
