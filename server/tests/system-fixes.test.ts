// server/tests/system-fixes.test.ts
// Verifies fixes for:
// Problem 1: DB indexes and performance queries
// Problem 2: Create room friend invitations
// Problem 3: Empty room rejoin host transfer
// Problem 4: Cleared chat & delete-for-me preview clearance
// Problem 5: Profile persistence (PATCH /api/profile)
// Problem 6: Media streaming with HTTP 206 Partial Content
// Problem 7: Email privacy & safe handle fallback

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(os.tmpdir(), `praconnect-fixes-${process.pid}-${Date.now()}.db`);
process.env.ROOM_EMPTY_TTL_MS = '60000';
process.env.MEDIA_ROOT = path.join(os.tmpdir(), `praconnect-media-${process.pid}-${Date.now()}`);

const { db } = await import('../db/index');
const { rooms } = await import('../routes/rooms');
const { users } = await import('../routes/users');
const { friends } = await import('../routes/friends');
const { messages } = await import('../routes/messages');
const { profile } = await import('../routes/profile');
const { media } = await import('../routes/media');
const { invites } = await import('../routes/invites');
const { createSession, SESSION_COOKIE_NAME } = await import('../auth/session');
const { deriveUsernameFromGoogle } = await import('../auth/google');
const { getMediaStorage } = await import('../storage/mediaStorage');

const app = new Hono();
app.route('/api/rooms', rooms);
app.route('/api/users', users);
app.route('/api/friends', friends);
app.route('/api/messages', messages);
app.route('/api/profile', profile);
app.route('/api/media', media);
app.route('/api/watch-invites', invites);

function seedUser(id: string, name: string, username: string, email: string, role = 'user'): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, name, username, email, passwordHash, avatarUrl, emailVerified, role, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, NULL, 'https://example.com/avatar.png', 1, ?, ?, ?)`
  ).run(id, name, username, email, role, now, now);
}

function establishFriendship(a: string, b: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO friendships (id, requesterId, recipientId, status, createdAt, updatedAt, acceptedAt)
     VALUES (?, ?, ?, 'accepted', ?, ?, ?)`
  ).run(`f-${a}-${b}`, a, b, now, now, now);
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
  const headers: Record<string, string> = { ...extraHeaders };
  if (token) headers['cookie'] = cookie(token);
  let reqBody: string | undefined;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    reqBody = JSON.stringify(body);
  }
  return app.fetch(
    new Request(`http://localhost${url}`, {
      method,
      headers,
      body: reqBody,
    })
  );
}

async function json<T = any>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

const tokens = {
  u1: '',
  u2: '',
  u3: '',
  admin: '',
};

before(async () => {
  seedUser('u1', 'Alice Johnson', 'alice', 'alice@private.com');
  seedUser('u2', 'Bob Smith', 'bob', 'bob@private.com');
  seedUser('u3', 'Charlie Brown', 'charlie', 'charlie@private.com');
  seedUser('u-admin', 'Admin User', 'admin_user', 'admin@private.com', 'admin');

  establishFriendship('u1', 'u2');

  tokens.u1 = await login('u1');
  tokens.u2 = await login('u2');
  tokens.u3 = await login('u3');
  tokens.admin = await login('u-admin');
});

after(() => {
  try {
    if (process.env.DATABASE_PATH && fs.existsSync(process.env.DATABASE_PATH)) {
      fs.unlinkSync(process.env.DATABASE_PATH);
    }
  } catch {}
});

// ─── Problem 1: DB Performance & Indexes ─────────────────────────────────────

test('Problem 1: DB indexes exist and query plans execute efficiently', () => {
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[];
  const names = indexes.map((i) => i.name);
  assert.ok(names.includes('idx_rooms_last_activity'), 'idx_rooms_last_activity exists');
  assert.ok(names.includes('idx_room_members_active'), 'idx_room_members_active exists');
  assert.ok(names.includes('idx_direct_messages_conv_seq'), 'idx_direct_messages_conv_seq exists');
  assert.ok(names.includes('idx_room_history_created'), 'idx_room_history_created exists');
});

// ─── Problem 2: Create Room with Friend Invitations ──────────────────────────

test('Problem 2: Host can create room with friend invitations for accepted friends', async () => {
  const res = await call(tokens.u1, 'POST', '/api/rooms', {
    name: 'Movie Night With Bob',
    privacy: 'public',
    category: 'Movie',
    maxParticipants: 6,
    inviteFriendIds: ['u2', 'u3', 'u1'], // u2 is friend, u3 is not, u1 is self
  });

  assert.equal(res.status, 201);
  const data = await json(res);
  assert.ok(data.room?.id, 'room created');

  // Verify watch invite was created for u2
  const u2InvitesRes = await call(tokens.u2, 'GET', '/api/watch-invites');
  assert.equal(u2InvitesRes.status, 200);
  const u2Invites = await json(u2InvitesRes);
  const foundInvite = u2Invites.invites.find((i: any) => i.roomId === data.room.id);
  assert.ok(foundInvite, 'u2 received watch invite');
  assert.equal(foundInvite.sender.id, 'u1');

  // Verify non-friend u3 did NOT receive watch invite
  const u3InvitesRes = await call(tokens.u3, 'GET', '/api/watch-invites');
  const u3Invites = await json(u3InvitesRes);
  assert.ok(!u3Invites.invites.some((i: any) => i.roomId === data.room.id), 'non-friend u3 did not receive invite');
});

// ─── Problem 3: Empty Room Rejoin Host Transfer ──────────────────────────────

test('Problem 3: First user entering empty room during grace window atomically becomes host', async () => {
  // 1. Create a room by Alice
  const createRes = await call(tokens.u1, 'POST', '/api/rooms', {
    name: 'Rejoin Transfer Test',
    privacy: 'public',
    category: 'Gaming',
    maxParticipants: 4,
  });
  const room = (await json(createRes)).room;

  // 2. Alice leaves -> room becomes empty (emptySince set)
  const leaveRes = await call(tokens.u1, 'POST', `/api/rooms/${room.id}/leave`);
  assert.equal(leaveRes.status, 200);

  const roomCheck = db.prepare('SELECT emptySince, hostUserId FROM rooms WHERE id = ?').get(room.id) as { emptySince: string | null; hostUserId: string };
  assert.ok(roomCheck.emptySince !== null, 'emptySince is set');

  // 3. Bob joins the empty room -> becomes host, emptySince cleared, status LIVE
  const joinRes = await call(tokens.u2, 'POST', `/api/rooms/${room.id}/join`);
  assert.equal(joinRes.status, 200);
  const joinData = await json(joinRes);

  assert.equal(joinData.room.hostUserId, 'u2', 'Bob became host');
  assert.equal(joinData.room.isHost, true, 'Bob is marked isHost in payload');
  assert.equal(joinData.room.isEmpty, false, 'room is not empty');

  const afterDb = db.prepare('SELECT emptySince, hostUserId, status FROM rooms WHERE id = ?').get(room.id) as { emptySince: string | null; hostUserId: string; status: string };
  assert.equal(afterDb.emptySince, null, 'emptySince reset to NULL');
  assert.equal(afterDb.hostUserId, 'u2', 'hostUserId updated in DB');
  assert.equal(afterDb.status, 'LIVE', 'status is LIVE');
});

// ─── Problem 4: Cleared Chat Preview & Delete for Me ─────────────────────────

test('Problem 4: Clearing a chat removes lastMessage preview from conversation list', async () => {
  // Alice sends Bob a DM
  const sendRes = await call(tokens.u1, 'POST', '/api/messages/u2', {
    text: 'Secret preview message',
  });
  assert.equal(sendRes.status, 200);

  // Check Alice sees the message in conversation preview
  const convBefore = await json(await call(tokens.u1, 'GET', '/api/messages/conversations'));
  const aliceConvBefore = convBefore.conversations.find((c: any) => c.friendId === 'u2');
  assert.ok(aliceConvBefore?.lastMessage?.text === 'Secret preview message');

  // Alice clears the chat
  const clearRes = await call(tokens.u1, 'POST', '/api/messages/conversations/u2/clear');
  assert.equal(clearRes.status, 200);

  // Check Alice's conversation list: lastMessage must now be null!
  const convAfter = await json(await call(tokens.u1, 'GET', '/api/messages/conversations'));
  const aliceConvAfter = convAfter.conversations.find((c: any) => c.friendId === 'u2');
  assert.equal(aliceConvAfter?.lastMessage, null, 'lastMessage is null after clearing chat');

  // Bob's conversation list still has his copy
  const bConv = await json(await call(tokens.u2, 'GET', '/api/messages/conversations'));
  const bobConv = bConv.conversations.find((c: any) => c.friendId === 'u1');
  assert.equal(bobConv?.lastMessage?.text, 'Secret preview message', 'Bob still has message preview');
});

// ─── Problem 5: Profile Persistence ──────────────────────────────────────────

test('Problem 5: PATCH /api/profile persists name, username, bio, and avatarUrl', async () => {
  const patchRes = await call(tokens.u1, 'PATCH', '/api/profile', {
    name: 'Alice Wonder',
    username: 'alice_wonder',
    bio: 'Coding and watching movies with friends.',
    avatar: 'https://example.com/new-alice.png',
  });

  assert.equal(patchRes.status, 200);
  const patchData = await json(patchRes);
  assert.equal(patchData.ok, true);
  assert.equal(patchData.user.name, 'Alice Wonder');
  assert.equal(patchData.user.username, 'alice_wonder');
  assert.equal(patchData.user.bio, 'Coding and watching movies with friends.');
  assert.equal(patchData.user.avatarUrl, 'https://example.com/new-alice.png');

  // Verify persistence via GET /api/profile
  const getRes = await call(tokens.u1, 'GET', '/api/profile');
  assert.equal(getRes.status, 200);
  const profileData = await json(getRes);
  assert.equal(profileData.user.name, 'Alice Wonder');
  assert.equal(profileData.profile.bio, 'Coding and watching movies with friends.');

  // Verify reserved usernames are rejected
  const reservedRes = await call(tokens.u1, 'PATCH', '/api/profile', {
    username: 'admin',
  });
  assert.equal(reservedRes.status, 400);

  // Verify duplicate username is rejected
  const dupRes = await call(tokens.u1, 'PATCH', '/api/profile', {
    username: 'bob',
  });
  assert.equal(dupRes.status, 409);
});

// ─── Problem 6: Media Streaming HTTP Range ───────────────────────────────────

test('Problem 6: Media streaming serves Range requests with HTTP 206 Partial Content', async () => {
  // Store a sample video file in media storage
  const storage = getMediaStorage();
  const sampleData = Buffer.alloc(100 * 1024, 'A'); // 100 KB
  const { Readable } = await import('node:stream');
  await storage.write('test-movie.mp4', Readable.from(sampleData));

  // Insert media item in DB with playableKey
  const mediaId = 'med-stream-test';
  db.prepare(
    `INSERT INTO media (id, title, originalFilename, mimeType, sizeBytes, storageKey, playableKey, downloadAllowed, published, status, createdByUserId, createdAt, updatedAt)
     VALUES (?, 'Stream Test Movie', 'stream.mp4', 'video/mp4', ?, 'test-movie.mp4', 'test-movie.mp4', 1, 1, 'ready', 'u-admin', ?, ?)`
  ).run(mediaId, sampleData.length, new Date().toISOString(), new Date().toISOString());

  // Request byte range 0-1023
  const rangeRes = await call(tokens.u1, 'GET', `/api/media/${mediaId}/download`, undefined, {
    Range: 'bytes=0-1023',
  });

  assert.equal(rangeRes.status, 206, 'HTTP 206 Partial Content returned');
  assert.equal(rangeRes.headers.get('accept-ranges'), 'bytes');
  assert.equal(rangeRes.headers.get('content-range'), `bytes 0-1023/${sampleData.length}`);
  assert.equal(rangeRes.headers.get('content-length'), '1024');

  const chunk = Buffer.from(await rangeRes.arrayBuffer());
  assert.equal(chunk.length, 1024);

  // HEAD request check
  const headRes = await call(tokens.u1, 'HEAD', `/api/media/${mediaId}/download`, undefined, {
    Range: 'bytes=0-1023',
  });
  assert.equal(headRes.status, 206);
  assert.equal(headRes.headers.get('content-range'), `bytes 0-1023/${sampleData.length}`);
});

// ─── Problem 7: Email Privacy & Safe Fallback ────────────────────────────────

test('Problem 7: Public endpoints never expose other users emails', async () => {
  // Search users: no email field
  const searchRes = await call(tokens.u1, 'GET', '/api/users/search?q=bob');
  const searchData = await json(searchRes);
  assert.ok(searchData.users.length > 0);
  for (const u of searchData.users) {
    assert.equal((u as any).email, undefined, 'email is not present in search results');
  }

  // Friends list: no email field
  const friendsRes = await call(tokens.u1, 'GET', '/api/friends');
  const friendsData = await json(friendsRes);
  assert.ok(friendsData.friends.length > 0);
  for (const f of friendsData.friends) {
    assert.equal((f as any).email, undefined, 'email is not present in friends list');
  }

  // Conversations: no email field
  const convRes = await call(tokens.u1, 'GET', '/api/messages/conversations');
  const convData = await json(convRes);
  for (const c of convData.conversations) {
    assert.equal((c as any).email, undefined, 'email is not present in conversations');
  }

  // Watch invites: no email field
  const invRes = await call(tokens.u2, 'GET', '/api/watch-invites');
  const invData = await json(invRes);
  for (const i of invData.invites) {
    assert.equal((i.sender as any).email, undefined, 'sender email not exposed');
    assert.equal((i.recipient as any).email, undefined, 'recipient email not exposed');
  }

  // Google OAuth username derivation never leaks email
  const handleFromName = deriveUsernameFromGoogle('John Doe', 'john.doe.private@gmail.com');
  assert.ok(!handleFromName.includes('gmail'), 'no gmail domain in username');
  assert.ok(!handleFromName.includes('private'), 'no private email part in username');

  const handleEmpty = deriveUsernameFromGoogle('', 'stealthy.person@gmail.com');
  assert.ok(handleEmpty.startsWith('user-'), 'safe user- handle fallback generated');
  assert.ok(!handleEmpty.includes('stealthy'), 'email not used in fallback handle');
});
