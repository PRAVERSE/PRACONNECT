// server/tests/social.test.ts
// Social feature server tests (node:test via tsx). Covers the user directory,
// friend requests (including collision convergence), friendships + presence,
// direct message authorization, watch invitations, the user-scoped SSE hub,
// and social data cleanup.
//
// Run: npx tsx --test server/tests/social.test.ts
//
// NOTE: env vars must be set BEFORE the modules are imported — this file uses
// dynamic imports on purpose (ESM hoists static imports).

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(os.tmpdir(), `praconnect-social-${process.pid}-${Date.now()}.db`);
process.env.ROOM_EMPTY_TTL_MS = '60000';
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `praconnect-social-uploads-${process.pid}-${Date.now()}`);

const { db } = await import('../db/index');
const { rooms, handleMediaServing, uploadsDir } = await import('../routes/rooms');
const { users } = await import('../routes/users');
const { friends } = await import('../routes/friends');
const { messages } = await import('../routes/messages');
const { invites } = await import('../routes/invites');
const { requireAuth } = await import('../middleware/auth');
const { createSession, SESSION_COOKIE_NAME } = await import('../auth/session');
const { emitUserEvent, openUserEventStream, userStreamCount } = await import('../social/realtime');
const { cleanupSocialData } = await import('../social/service');

const app = new Hono();
app.route('/api/rooms', rooms);
app.route('/api/users', users);
app.route('/api/friends', friends);
app.route('/api/messages', messages);
app.route('/api/watch-invites', invites);
app.use('/api/uploads/*', requireAuth);
app.on(['GET', 'HEAD'], '/api/uploads/:filename', handleMediaServing);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function seedUser(id: string, name: string, username: string, email: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, name, username, email, passwordHash, avatarUrl, emailVerified, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, NULL, 'https://example.com/avatar.png', 1, ?, ?)`
  ).run(id, name, username, email, now, now);
}

async function login(userId: string): Promise<string> {
  return createSession(userId);
}

function cookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

async function call(
  token: string | null,
  method: string,
  url: string,
  body?: unknown,
  extraHeaders?: Record<string, string>
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers['cookie'] = cookie(token);
  if (body !== undefined) headers['content-type'] = 'application/json';
  Object.assign(headers, extraHeaders ?? {});
  return app.request(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>;
}

async function createRoom(hostToken: string, name: string): Promise<{ id: string; code: string }> {
  const res = await call(hostToken, 'POST', '/api/rooms', {
    name,
    category: 'Movie',
    privacy: 'public',
    maxParticipants: 4,
  });
  assert.equal(res.status, 201, `createRoom ${name} should succeed`);
  const room = (await json(res)).room as { id: string; code: string };
  return { id: room.id, code: room.code };
}

const U = { a: 'user-a', b: 'user-b', c: 'user-c', d: 'user-d' };
let tokens: Record<string, string> = {};

before(async () => {
  for (const [key, id] of Object.entries(U)) {
    seedUser(id, `User ${key.toUpperCase()}`, `user${key}`, `${key}@test.dev`);
  }
  for (const [key, id] of Object.entries(U)) {
    tokens[key] = await login(id);
  }
});

after(() => {
  db.close();
  fs.rmSync(uploadsDir, { recursive: true, force: true });
});

// ─── A. Authentication guards ────────────────────────────────────────────────

test('A: unauthenticated social requests are rejected with 401', async () => {
  for (const [method, url, body] of [
    ['GET', '/api/users/search?q=x', undefined],
    ['POST', '/api/users/user-b/friend-request', {}],
    ['GET', '/api/users/events', undefined],
    ['GET', '/api/friends', undefined],
    ['GET', '/api/friends/requests', undefined],
    ['POST', '/api/friends/requests/x/accept', {}],
    ['POST', '/api/friends/requests/x/reject', {}],
    ['GET', '/api/messages/conversations', undefined],
    ['GET', '/api/messages/user-b', undefined],
    ['POST', '/api/messages/user-b', { text: 'hi' }],
    ['GET', '/api/watch-invites', undefined],
    ['POST', '/api/watch-invites', { recipientUserId: 'x', roomId: 'y' }],
    ['POST', '/api/watch-invites/x/accept', {}],
  ] as const) {
    const res = await call(null, method, url, body);
    assert.equal(res.status, 401, `${method} ${url} should be 401`);
    const parsed = await json(res);
    assert.equal((parsed.error as { code: string }).code, 'UNAUTHENTICATED');
  }
});

// ─── B. User directory search ────────────────────────────────────────────────

test('B: search is case-insensitive, matches name or username, and excludes self', async () => {
  const res = await call(tokens.a, 'GET', '/api/users/search?q=USERB');
  assert.equal(res.status, 200);
  const body = await json(res);
  const results = body.users as { username: string; name: string }[];
  assert.ok(results.some((u) => u.username === 'userb'), 'username match');
  assert.ok(!results.some((u) => u.username === 'usera'), 'self must never appear');

  const byName = await call(tokens.a, 'GET', '/api/users/search?q=USER B');
  const body2 = await json(byName);
  assert.ok((body2.users as { name: string }[]).some((u) => u.name === 'User B'), 'name match');
});

test('C: @ prefix restricts the search to usernames', async () => {
  const res = await call(tokens.a, 'GET', '/api/users/search?q=@userb');
  assert.equal(res.status, 200);
  const body = await json(res);
  const results = body.users as { username: string }[];
  assert.ok(results.length >= 1);
  assert.ok(results.every((u) => u.username.startsWith('userb')), 'only username matches');
});

test('D: search results never leak sensitive fields', async () => {
  const res = await call(tokens.a, 'GET', '/api/users/search?q=userb');
  const body = await json(res);
  for (const user of body.users as Record<string, unknown>[]) {
    assert.ok(!('email' in user), 'no email in directory results');
    assert.ok(!('passwordHash' in user), 'no password hash in directory results');
    assert.ok('id' in user && 'name' in user && 'username' in user, 'safe public fields present');
  }
});

test('E: search paginates with total and nextOffset', async () => {
  const res = await call(tokens.a, 'GET', '/api/users/search?q=user&limit=2&offset=0');
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal((body.users as unknown[]).length, 2);
  assert.equal(body.total, 3, 'b, c, d remain (self excluded)');
  assert.equal(body.nextOffset, 2);

  const page2 = await call(tokens.a, 'GET', '/api/users/search?q=user&limit=2&offset=2');
  const body2 = await json(page2);
  assert.equal((body2.users as unknown[]).length, 1);
  assert.equal(body2.nextOffset, 3);
});

test('F: invalid pagination is rejected', async () => {
  for (const q of ['?q=user&limit=0&offset=0', '?q=user&limit=-1&offset=0', '?q=user&limit=2&offset=-1']) {
    const res = await call(tokens.a, 'GET', `/api/users/search${q}`);
    assert.equal(res.status, 400, q);
  }
});

// ─── G. Friend requests ──────────────────────────────────────────────────────

test('G: sending a request appears in recipient incoming and sender outgoing', async () => {
  const res = await call(tokens.a, 'POST', '/api/users/user-b/friend-request');
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal((body.request as { requester: { username: string } }).requester.username, 'usera');

  const incoming = await call(tokens.b, 'GET', '/api/friends/requests');
  const inc = await json(incoming);
  const inList = (inc.incoming as { direction: string; user: { username: string } }[]).filter(
    (r) => r.direction === 'incoming'
  );
  assert.ok(inList.some((r) => r.user.username === 'usera'));

  const outgoing = await call(tokens.a, 'GET', '/api/friends/requests');
  const out = await json(outgoing);
  const outList = (out.outgoing as { direction: string; user: { username: string } }[]).filter(
    (r) => r.direction === 'outgoing'
  );
  assert.ok(outList.some((r) => r.user.username === 'userb'));
});

test('G2: request items carry the REAL user id (not the friendship id) so the directory can match relationships', async () => {
  const res = await call(tokens.a, 'POST', '/api/users/user-b/friend-request');
  assert.equal(res.status, 200);
  const body = await json(res);
  const requestId = (body.request as { id: string }).id;

  const incoming = await json(await call(tokens.b, 'GET', '/api/friends/requests'));
  const incomingForA = (incoming.incoming as { id: string; user: { id: string; username: string } }[]).find(
    (r) => r.user.username === 'usera'
  );
  assert.ok(incomingForA, 'incoming request for usera must exist');
  assert.equal(incomingForA!.id, requestId, 'item id is the friendship id used to accept');
  assert.equal(incomingForA!.user.id, U.a, 'user.id must be the requester user id, not the request id');

  const outgoing = await json(await call(tokens.a, 'GET', '/api/friends/requests'));
  const outgoingForB = (outgoing.outgoing as { id: string; user: { id: string; username: string } }[]).find(
    (r) => r.user.username === 'userb'
  );
  assert.ok(outgoingForB, 'outgoing request for userb must exist');
  assert.equal(outgoingForB!.id, requestId, 'item id is the friendship id used to accept');
  assert.equal(outgoingForB!.user.id, U.b, 'user.id must be the recipient user id, not the request id');
});

test('H: sending to yourself is rejected', async () => {
  const res = await call(tokens.a, 'POST', '/api/users/user-a/friend-request');
  assert.equal(res.status, 400);
  const body = await json(res);
  assert.equal((body.error as { code: string }).code, 'CANNOT_FRIEND_SELF');
});

test('I: sending to a nonexistent user is 404', async () => {
  const res = await call(tokens.a, 'POST', '/api/users/nobody-here/friend-request');
  assert.equal(res.status, 404);
  const body = await json(res);
  assert.equal((body.error as { code: string }).code, 'USER_NOT_FOUND');
});

test('J: duplicate request is idempotent — no second row', async () => {
  const before = db.prepare('SELECT COUNT(*) AS n FROM friendships WHERE requesterId = ? AND recipientId = ?')
    .get(U.a, U.b) as { n: number };
  const res = await call(tokens.a, 'POST', '/api/users/user-b/friend-request');
  assert.equal(res.status, 200);
  const after = db.prepare('SELECT COUNT(*) AS n FROM friendships WHERE requesterId = ? AND recipientId = ?')
    .get(U.a, U.b) as { n: number };
  assert.equal(after.n, before.n, 're-send must not duplicate');
  assert.ok(res);
});

test('K: collision converges — B sending to A while A already sent B stays canonical', async () => {
  await call(tokens.a, 'POST', '/api/users/user-b/friend-request');
  const res = await call(tokens.b, 'POST', '/api/users/user-a/friend-request');
  assert.equal(res.status, 200);

  const rows = db.prepare(
    "SELECT * FROM friendships WHERE (requesterId = ? AND recipientId = ?) OR (requesterId = ? AND recipientId = ?)"
  ).all(U.a, U.b, U.b, U.a) as { requesterId: string; recipientId: string; status: string }[];
  assert.equal(rows.length, 1, 'exactly one canonical row');
  assert.equal(rows[0].status, 'pending');

  // A still has it in outgoing, B in incoming — never both directions.
  const aOut = await json(await call(tokens.a, 'GET', '/api/friends/requests'));
  const bIn = await json(await call(tokens.b, 'GET', '/api/friends/requests'));
  const aOutgoing = (aOut.outgoing as { user: { username: string } }[]).filter((r) => r.user.username === 'userb');
  const bIncoming = (bIn.incoming as { user: { username: string } }[]).filter((r) => r.user.username === 'usera');
  assert.equal(aOutgoing.length, 1);
  assert.equal(bIncoming.length, 1);
});

// ─── L. Accept / reject ──────────────────────────────────────────────────────

test('L: only the recipient can accept; accept creates a mutual friendship', async () => {
  const reqId = (db.prepare(
    "SELECT id FROM friendships WHERE requesterId = ? AND recipientId = ? AND status = 'pending' LIMIT 1"
  ).get(U.a, U.b) as { id: string }).id;

  // C cannot accept A->B's request.
  const wrong = await call(tokens.c, 'POST', `/api/friends/requests/${reqId}/accept`);
  assert.equal(wrong.status, 404);

  const res = await call(tokens.b, 'POST', `/api/friends/requests/${reqId}/accept`);
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal((body.friendship as { status: string }).status, 'accepted');
  assert.equal((body.friend as { username: string }).username, 'usera');

  const aFriends = await json(await call(tokens.a, 'GET', '/api/friends'));
  const bFriends = await json(await call(tokens.b, 'GET', '/api/friends'));
  const aList = (aFriends.friends as { username: string }[]).map((f) => f.username);
  const bList = (bFriends.friends as { username: string }[]).map((f) => f.username);
  assert.ok(aList.includes('userb'));
  assert.ok(bList.includes('usera'));
});

test('M: already-friends cannot receive another request', async () => {
  const res = await call(tokens.a, 'POST', '/api/users/user-b/friend-request');
  assert.equal(res.status, 409);
  const body = await json(res);
  assert.equal((body.error as { code: string }).code, 'ALREADY_FRIENDS');
});

test('N: accept twice is rejected', async () => {
  const reqId = (db.prepare(
    "SELECT id FROM friendships WHERE requesterId = ? AND recipientId = ? AND status = 'accepted' LIMIT 1"
  ).get(U.a, U.b) as { id: string }).id;
  const res = await call(tokens.b, 'POST', `/api/friends/requests/${reqId}/accept`);
  assert.equal(res.status, 404);
});

test('O: rejecting removes the request and allows a fresh request afterwards', async () => {
  const res = await call(tokens.a, 'POST', '/api/users/user-c/friend-request');
  assert.equal(res.status, 200);
  const reqId = (db.prepare(
    "SELECT id FROM friendships WHERE requesterId = ? AND recipientId = ? AND status = 'pending' LIMIT 1"
  ).get(U.a, U.c) as { id: string }).id;

  const rej = await call(tokens.c, 'POST', `/api/friends/requests/${reqId}/reject`);
  assert.equal(rej.status, 200);

  const cReq = await json(await call(tokens.c, 'GET', '/api/friends/requests'));
  assert.equal((cReq.incoming as unknown[]).length, 0);

  // A fresh request is possible after rejection (the canonical unique index
  // only covers pending/accepted rows).
  const fresh = await call(tokens.a, 'POST', '/api/users/user-c/friend-request');
  assert.equal(fresh.status, 200);
  const freshRow = db.prepare(
    "SELECT status FROM friendships WHERE requesterId = ? AND recipientId = ? ORDER BY createdAt DESC LIMIT 1"
  ).get(U.a, U.c) as { status: string };
  assert.equal(freshRow.status, 'pending');
});

// ─── P. Presence ─────────────────────────────────────────────────────────────

test('P: friends list reflects live room presence', async () => {
  const room = await createRoom(tokens.a, 'Presence Room');
  const bFriends = await json(await call(tokens.b, 'GET', '/api/friends'));
  const userA = (bFriends.friends as { username: string; online: boolean; currentRoomName: string | null; currentRoomCode: string | null }[])
    .find((f) => f.username === 'usera');
  assert.ok(userA, 'A is in B\'s friends list');
  assert.equal(userA.online, true);
  assert.equal(userA.currentRoomName, 'Presence Room');
  assert.equal(userA.currentRoomCode, room.code);
});

// ─── Q. Direct messages ──────────────────────────────────────────────────────

test('Q: non-friends cannot message each other', async () => {
  const res = await call(tokens.c, 'POST', '/api/messages/user-d', { text: 'hi there' });
  assert.equal(res.status, 403);
  const body = await json(res);
  assert.equal((body.error as { code: string }).code, 'FRIENDSHIP_REQUIRED');

  const history = await call(tokens.c, 'GET', '/api/messages/user-d');
  assert.equal(history.status, 403);
});

test('R: friends exchange messages and history is chronological', async () => {
  const room = await createRoom(tokens.a, 'DM Room');
  assert.ok(room.id);

  const m1 = await call(tokens.a, 'POST', '/api/messages/user-b', { text: 'first' });
  assert.equal(m1.status, 200);
  const m2 = await call(tokens.b, 'POST', '/api/messages/user-a', { text: 'second' });
  assert.equal(m2.status, 200);

  const history = await call(tokens.a, 'GET', '/api/messages/user-b');
  assert.equal(history.status, 200);
  const body = await json(history);
  const msgs = body.messages as { senderId: string; text: string }[];
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].text, 'first');
  assert.equal(msgs[1].text, 'second');
  assert.equal(msgs[0].senderId, U.a);
  assert.equal(msgs[1].senderId, U.b);

  const convs = await json(await call(tokens.a, 'GET', '/api/messages/conversations'));
  const list = convs.conversations as { friendId: string; lastMessage: { text: string } | null }[];
  assert.ok(list.some((c) => c.friendId === U.b && c.lastMessage?.text === 'second'));
});

test('S: message validation — empty and oversized text are rejected', async () => {
  const empty = await call(tokens.a, 'POST', '/api/messages/user-b', { text: '   ' });
  assert.equal(empty.status, 400);
  const tooLong = await call(tokens.a, 'POST', '/api/messages/user-b', { text: 'x'.repeat(2001) });
  assert.equal(tooLong.status, 400);
  const parsed = await json(tooLong);
  assert.equal((parsed.error as { code: string }).code, 'VALIDATION_ERROR');
});

test('T: dm:new event is delivered to the recipient SSE stream', async () => {
  const controller = new AbortController();
  const received: string[] = [];
  const sink = {
    enqueue(chunk: Uint8Array) {
      received.push(new TextDecoder().decode(chunk));
    },
    close() {
      received.push('__closed__');
    },
  };
  const cleanup = openUserEventStream(U.b, controller.signal, sink);

  const res = await call(tokens.a, 'POST', '/api/messages/user-b', { text: 'live event check' });
  assert.equal(res.status, 200);

  const frames = received.join('');
  assert.ok(frames.includes('event: dm:new'), 'recipient must receive dm:new');
  assert.ok(frames.includes('"text":"live event check"'), 'payload must be intact');
  assert.ok(frames.includes('"recipientId":"' + U.b + '"'), 'payload carries the recipient');

  controller.abort();
  assert.equal(userStreamCount(U.b), 0, 'stream deregisters on abort');
  assert.ok(cleanup);
});

// ─── U. Watch invitations ────────────────────────────────────────────────────

test('U: watch invite requires an accepted friendship', async () => {
  const room = await createRoom(tokens.a, 'Invite Room');
  const res = await call(tokens.a, 'POST', '/api/watch-invites', {
    recipientUserId: U.c,
    roomId: room.id,
  });
  assert.equal(res.status, 403);
  const body = await json(res);
  assert.equal((body.error as { code: string }).code, 'FRIENDSHIP_REQUIRED');
});

test('V: watch invite requires the sender to be in the room', async () => {
  const room = await createRoom(tokens.a, 'Sender Room');
  // B is friends with A but not a member of the room.
  const res = await call(tokens.b, 'POST', '/api/watch-invites', {
    recipientUserId: U.a,
    roomId: room.id,
  });
  assert.equal(res.status, 403);
  const body = await json(res);
  assert.equal((body.error as { code: string }).code, 'ROOM_MEMBERSHIP_REQUIRED');
});

test('W: sending a watch invite notifies the recipient and is idempotent', async () => {
  const room = await createRoom(tokens.a, 'Watch Party');
  const controller = new AbortController();
  const received: string[] = [];
  const sink = {
    enqueue(chunk: Uint8Array) {
      received.push(new TextDecoder().decode(chunk));
    },
    close() {},
  };
  openUserEventStream(U.b, controller.signal, sink);

  const res = await call(tokens.a, 'POST', '/api/watch-invites', {
    recipientUserId: U.b,
    roomId: room.id,
  });
  assert.equal(res.status, 200);
  const body = await json(res);
  const invite = body.invite as { id: string; roomCode: string; roomName: string };
  assert.equal(invite.roomCode, room.code);
  assert.equal(invite.roomName, 'Watch Party');

  const frames = received.join('');
  assert.ok(frames.includes('event: watch:invite'), 'recipient must receive watch:invite');
  assert.ok(frames.includes('"roomCode":"' + room.code + '"'), 'invite carries the room code');

  // Idempotent re-send returns the same invite.
  const again = await call(tokens.a, 'POST', '/api/watch-invites', {
    recipientUserId: U.b,
    roomId: room.id,
  });
  const body2 = await json(again);
  assert.equal((body2.invite as { id: string }).id, invite.id, 'pending invite reused');

  const bInvites = await json(await call(tokens.b, 'GET', '/api/watch-invites'));
  assert.ok((bInvites.invites as { id: string }[]).some((i) => i.id === invite.id));

  controller.abort();
});

test('X: accepting a watch invite returns the room and notifies the sender', async () => {
  const room = await createRoom(tokens.a, 'Joinable Party');
  await call(tokens.a, 'POST', '/api/watch-invites', { recipientUserId: U.b, roomId: room.id });
  const invite = (db.prepare(
    "SELECT id FROM watchInvites WHERE roomId = ? AND recipientUserId = ? AND status = 'pending' LIMIT 1"
  ).get(room.id, U.b) as { id: string }).id;

  const controller = new AbortController();
  const received: string[] = [];
  const sink = {
    enqueue(chunk: Uint8Array) {
      received.push(new TextDecoder().decode(chunk));
    },
    close() {},
  };
  openUserEventStream(U.a, controller.signal, sink);

  const res = await call(tokens.b, 'POST', `/api/watch-invites/${invite}/accept`);
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.roomCode, room.code);
  assert.equal((body.invite as { status: string }).status, 'accepted');

  const frames = received.join('');
  assert.ok(frames.includes('event: watch:invite:accepted'), 'sender must be notified');
  assert.ok(frames.includes('"recipientId":"' + U.b + '"'), 'sender learns who accepted');

  controller.abort();
});

test('Y: declining a watch invite notifies the sender', async () => {
  const room = await createRoom(tokens.a, 'Decline Party');
  await call(tokens.a, 'POST', '/api/watch-invites', { recipientUserId: U.b, roomId: room.id });
  const invite = (db.prepare(
    "SELECT id FROM watchInvites WHERE roomId = ? AND recipientUserId = ? AND status = 'pending' LIMIT 1"
  ).get(room.id, U.b) as { id: string }).id;

  const controller = new AbortController();
  const received: string[] = [];
  const sink = {
    enqueue(chunk: Uint8Array) {
      received.push(new TextDecoder().decode(chunk));
    },
    close() {},
  };
  openUserEventStream(U.a, controller.signal, sink);

  const res = await call(tokens.b, 'POST', `/api/watch-invites/${invite}/decline`);
  assert.equal(res.status, 200);
  const frames = received.join('');
  assert.ok(frames.includes('event: watch:invite:declined'));

  controller.abort();
});

test('Z: invites addressed to others are 404', async () => {
  const room = await createRoom(tokens.a, 'Other Party');
  await call(tokens.a, 'POST', '/api/watch-invites', { recipientUserId: U.b, roomId: room.id });
  const invite = (db.prepare(
    "SELECT id FROM watchInvites WHERE roomId = ? AND recipientUserId = ? AND status = 'pending' LIMIT 1"
  ).get(room.id, U.b) as { id: string }).id;

  const res = await call(tokens.c, 'POST', `/api/watch-invites/${invite}/accept`);
  assert.equal(res.status, 404);
  const body = await json(res);
  assert.equal((body.error as { code: string }).code, 'INVITE_NOT_FOUND');
});

test('AA: expired watch invites are rejected with INVITE_EXPIRED', async () => {
  const room = await createRoom(tokens.a, 'Expired Invite Room');
  await call(tokens.a, 'POST', '/api/watch-invites', { recipientUserId: U.b, roomId: room.id });
  db.prepare('UPDATE watchInvites SET expiresAt = ? WHERE recipientUserId = ? AND status = \'pending\'')
    .run(new Date(Date.now() - 1000).toISOString(), U.b);

  const invite = (db.prepare(
    "SELECT id FROM watchInvites WHERE roomId = ? AND recipientUserId = ? AND status = 'pending' LIMIT 1"
  ).get(room.id, U.b) as { id: string }).id;

  const res = await call(tokens.b, 'POST', `/api/watch-invites/${invite}/accept`);
  assert.equal(res.status, 409);
  const body = await json(res);
  assert.equal((body.error as { code: string }).code, 'INVITE_EXPIRED');
});

test('AB: accepting an invite for an expired room fails with ROOM_GONE', async () => {
  const room = await createRoom(tokens.a, 'Dead Room');
  await call(tokens.a, 'POST', '/api/watch-invites', { recipientUserId: U.b, roomId: room.id });
  // Force the room into the expired window (emptySince older than the TTL).
  db.prepare('UPDATE rooms SET emptySince = ? WHERE id = ?').run(
    new Date(Date.now() - 120000).toISOString(),
    room.id
  );

  const invite = (db.prepare(
    "SELECT id FROM watchInvites WHERE roomId = ? AND recipientUserId = ? AND status = 'pending' LIMIT 1"
  ).get(room.id, U.b) as { id: string }).id;

  const res = await call(tokens.b, 'POST', `/api/watch-invites/${invite}/accept`);
  assert.equal(res.status, 409);
  const body = await json(res);
  assert.equal((body.error as { code: string }).code, 'ROOM_GONE');
});

// ─── AC. SSE hub bookkeeping ─────────────────────────────────────────────────

test('AC: user event streams register and deregister cleanly', async () => {
  assert.equal(userStreamCount(U.c), 0);

  const controller = new AbortController();
  const sinkA = { enqueue() {}, close() {} };
  const sinkB = { enqueue() {}, close() {} };
  const cleanup1 = openUserEventStream(U.c, controller.signal, sinkA);
  const cleanup2 = openUserEventStream(U.c, controller.signal, sinkB);
  assert.equal(userStreamCount(U.c), 2);

  cleanup2();
  assert.equal(userStreamCount(U.c), 1);

  cleanup1();
  assert.equal(userStreamCount(U.c), 0);

  // Abort path also removes the sink.
  const controller2 = new AbortController();
  openUserEventStream(U.c, controller2.signal, { enqueue() {}, close() {} });
  assert.equal(userStreamCount(U.c), 1);
  controller2.abort();
  assert.equal(userStreamCount(U.c), 0);
});

test('AD: emitUserEvent reaches only the target user streams', async () => {
  const receivedA: string[] = [];
  const receivedD: string[] = [];
  const ca = new AbortController();
  const cd = new AbortController();
  openUserEventStream(U.a, ca.signal, {
    enqueue(chunk: Uint8Array) {
      receivedA.push(new TextDecoder().decode(chunk));
    },
    close() {},
  });
  openUserEventStream(U.d, cd.signal, {
    enqueue(chunk: Uint8Array) {
      receivedD.push(new TextDecoder().decode(chunk));
    },
    close() {},
  });

  emitUserEvent(U.a, 'friend:request', { marker: 'only-a' });

  assert.ok(receivedA.join('').includes('event: friend:request'));
  assert.ok(receivedA.join('').includes('"marker":"only-a"'));
  assert.equal(receivedD.join(''), '', 'unrelated user receives nothing');

  ca.abort();
  cd.abort();
});

// ─── AE. Social data cleanup ─────────────────────────────────────────────────

test('AE: cleanup expires stale invites and purges old rejected friendships', async () => {
  const now = Date.now();

  // Seed a pending invite that expires an hour from now (recipient = A so A
  // sees it; lazy expiry keeps it visible until its deadline passes).
  db.prepare(
    `INSERT INTO watchInvites (id, senderUserId, recipientUserId, roomId, roomCode, roomName, status, createdAt, expiresAt)
     VALUES ('stale-invite', ?, ?, 'fake-room', 'ABCDEF', 'Old Room', 'pending', ?, ?)`
  ).run(U.b, U.a, new Date(now).toISOString(), new Date(now + 3600000).toISOString());

  const aInvites = await json(await call(tokens.a, 'GET', '/api/watch-invites'));
  assert.ok((aInvites.invites as { id: string }[]).some((i) => i.id === 'stale-invite'));

  // Advance the clock past the invite deadline so the cleanup sweep expires it.
  const result = cleanupSocialData(now + 3600000 + 5000);
  assert.ok(result.expiredInvites >= 1);

  const aInvites2 = await json(await call(tokens.a, 'GET', '/api/watch-invites'));
  assert.ok(!(aInvites2.invites as { id: string }[]).some((i) => i.id === 'stale-invite'));

  // Seed a long-rejected friendship and confirm the purge.
  db.prepare(
    `INSERT INTO friendships (id, requesterId, recipientId, status, createdAt, updatedAt)
     VALUES ('old-reject', ?, ?, 'rejected', ?, ?)`
  ).run(U.a, U.d, new Date(now - 45 * 24 * 3600000).toISOString(), new Date(now - 45 * 24 * 3600000).toISOString());
  const purge = cleanupSocialData(now);
  assert.ok(purge.purgedRejected >= 1);
  const gone = db.prepare('SELECT id FROM friendships WHERE id = ?').get('old-reject');
  assert.equal(gone, undefined, 'old rejected friendship purged');
});

// ─── AF. Friendship-gated DM authorization (fresh pair, no prior state) ─────
// Fresh users are seeded here (after all earlier tests) so the directory
// count assertions above keep their exact totals.

test('AF: DM send/history are blocked before any friendship exists', async () => {
  seedUser('user-e', 'User E', 'usere', 'e@test.dev');
  seedUser('user-f', 'User F', 'userf', 'f@test.dev');
  seedUser('user-g', 'User G', 'userg', 'g@test.dev');
  tokens.e = await login('user-e');
  tokens.f = await login('user-f');
  tokens.g = await login('user-g');

  const send = await call(tokens.e, 'POST', '/api/messages/user-f', { text: 'hi there' });
  assert.equal(send.status, 403);
  const body = await json(send);
  assert.equal((body.error as { code: string }).code, 'FRIENDSHIP_REQUIRED');

  const history = await call(tokens.e, 'GET', '/api/messages/user-f');
  assert.equal(history.status, 403);

  const convs = await json(await call(tokens.e, 'GET', '/api/messages/conversations'));
  assert.ok(
    !(convs.conversations as { friendId: string }[]).some((c) => c.friendId === 'user-f'),
    'strangers never appear in conversations'
  );
});

test('AG: DM is blocked while a request is pending in EITHER direction', async () => {
  await call(tokens.e, 'POST', '/api/users/user-f/friend-request');

  // E holds the outgoing pending request.
  const out = await call(tokens.e, 'POST', '/api/messages/user-f', { text: 'nope' });
  assert.equal(out.status, 403);
  const outHist = await call(tokens.e, 'GET', '/api/messages/user-f');
  assert.equal(outHist.status, 403);

  // F holds the incoming pending request.
  const inc = await call(tokens.f, 'POST', '/api/messages/user-e', { text: 'nope' });
  assert.equal(inc.status, 403);
  const incHist = await call(tokens.f, 'GET', '/api/messages/user-e');
  assert.equal(incHist.status, 403);
});

test('AH: accepting the request unlocks DMs and emits friend:accepted', async () => {
  const reqId = (db.prepare(
    "SELECT id FROM friendships WHERE requesterId = ? AND recipientId = ? AND status = 'pending' LIMIT 1"
  ).get('user-e', 'user-f') as { id: string }).id;

  const controller = new AbortController();
  const received: string[] = [];
  const sink = {
    enqueue(chunk: Uint8Array) {
      received.push(new TextDecoder().decode(chunk));
    },
    close() {},
  };
  openUserEventStream('user-e', controller.signal, sink);

  const accept = await call(tokens.f, 'POST', `/api/friends/requests/${reqId}/accept`);
  assert.equal(accept.status, 200);

  const frames = received.join('');
  assert.ok(frames.includes('event: friend:accepted'), 'requester receives friend:accepted');
  assert.ok(frames.includes('"id":"user-f"'), 'payload carries the accepting friend');

  const send = await call(tokens.e, 'POST', '/api/messages/user-f', { text: 'hello friend' });
  assert.equal(send.status, 200);

  const hist = await call(tokens.f, 'GET', '/api/messages/user-e');
  assert.equal(hist.status, 200);
  const msgs = (await json(hist)).messages as { text: string }[];
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].text, 'hello friend');

  controller.abort();
});

test('AI: a rejected friendship blocks DMs in both directions', async () => {
  await call(tokens.e, 'POST', '/api/users/user-g/friend-request');
  const reqId = (db.prepare(
    "SELECT id FROM friendships WHERE requesterId = ? AND recipientId = ? AND status = 'pending' LIMIT 1"
  ).get('user-e', 'user-g') as { id: string }).id;
  await call(tokens.g, 'POST', `/api/friends/requests/${reqId}/reject`);

  const send = await call(tokens.e, 'POST', '/api/messages/user-g', { text: 'after reject' });
  assert.equal(send.status, 403);
  const hist = await call(tokens.g, 'GET', '/api/messages/user-e');
  assert.equal(hist.status, 403);
});

test('AJ: conversations never expose unauthorized relationships (legacy rows)', async () => {
  // Simulate a stale message row for a now-rejected relationship: the
  // conversation list must not reveal it, and history must stay locked.
  db.prepare(
    `INSERT INTO directMessages (id, senderId, recipientId, text, createdAt)
     VALUES ('legacy-e-g', ?, ?, 'legacy', ?)`
  ).run('user-e', 'user-g', new Date().toISOString());

  const convs = await json(await call(tokens.e, 'GET', '/api/messages/conversations'));
  const list = convs.conversations as { friendId: string }[];
  assert.ok(!list.some((c) => c.friendId === 'user-g'), 'rejected peer must not appear');

  const hist = await call(tokens.e, 'GET', '/api/messages/user-g');
  assert.equal(hist.status, 403);
});

test('AK: friendship and DM state survive a reconnect (fresh refetch after accept)', async () => {
  // Re-fetch everything as if the SSE stream dropped and the client re-synced.
  const eFriends = await json(await call(tokens.e, 'GET', '/api/friends'));
  const eList = (eFriends.friends as { username: string }[]).map((f) => f.username);
  assert.ok(eList.includes('userf'), 'E still sees F as a friend after reconnect');

  const eReq = await json(await call(tokens.e, 'GET', '/api/friends/requests'));
  assert.ok(
    !(eReq.outgoing as { user: { username: string } }[]).some((r) => r.user.username === 'userf'),
    'no stale outgoing request for F after reconnect'
  );

  const again = await call(tokens.e, 'POST', '/api/messages/user-f', { text: 'still works' });
  assert.equal(again.status, 200);

  const convs = await json(await call(tokens.e, 'GET', '/api/messages/conversations'));
  assert.ok(
    (convs.conversations as { friendId: string }[]).some((c) => c.friendId === 'user-f'),
    'conversation visible for the accepted friend'
  );
});

test('AL: watch invitations still require an accepted friendship', async () => {
  const room = await createRoom(tokens.e, 'Gated Invite Room');

  // E→G is a rejected relationship: the invite must fail.
  const rejected = await call(tokens.e, 'POST', '/api/watch-invites', {
    recipientUserId: 'user-g',
    roomId: room.id,
  });
  assert.equal(rejected.status, 403);
  const body = await json(rejected);
  assert.equal((body.error as { code: string }).code, 'FRIENDSHIP_REQUIRED');

  // E→F are friends: the invite succeeds.
  const okInvite = await call(tokens.e, 'POST', '/api/watch-invites', {
    recipientUserId: 'user-f',
    roomId: room.id,
  });
  assert.equal(okInvite.status, 200);
});
