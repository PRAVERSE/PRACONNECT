// server/tests/rooms.test.ts
// Phase 3 server tests (node:test via tsx). Covers auth guards, ownership,
// media/playback/screen-share permissions, moderation, membership, host
// transfer, cleanup, and SSE replay.
//
// Run: npx tsx --test server/tests/rooms.test.ts
//
// NOTE: DATABASE_PATH must be set BEFORE the db module is imported — this
// file uses dynamic imports on purpose (ESM hoists static imports).

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(os.tmpdir(), `praconnect-test-${process.pid}-${Date.now()}.db`);
process.env.ROOM_EMPTY_TTL_MS = '60000';
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `praconnect-uploads-${process.pid}-${Date.now()}`);

const { db } = await import('../db/index');
const { rooms, handleMediaServing, uploadsDir } = await import('../routes/rooms');
const { createSession, SESSION_COOKIE_NAME } = await import('../auth/session');
const { cleanupEmptyRooms } = await import('../rooms/service');

const app = new Hono();
app.route('/api/rooms', rooms);
app.on(['GET', 'HEAD'], '/api/uploads/:filename', handleMediaServing);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function seedUser(id: string, name: string, username: string, email: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, name, username, email, passwordHash, avatarUrl, emailVerified, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, NULL, NULL, 1, ?, ?)`
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

// ─── 1. Authentication guards ────────────────────────────────────────────────

test('unauthenticated requests are rejected with 401', async () => {
  for (const [method, url] of [
    ['GET', '/api/rooms'],
    ['POST', '/api/rooms'],
    ['POST', '/api/rooms/whatever/join'],
    ['POST', '/api/rooms/whatever/leave'],
    ['POST', '/api/rooms/whatever/media'],
    ['GET', '/api/rooms/whatever/events'],
  ] as const) {
    const res = await call(null, method, url, method === 'POST' ? {} : undefined);
    assert.equal(res.status, 401, `${method} ${url} should be 401`);
    const body = await json(res);
    assert.equal((body.error as { code: string }).code, 'UNAUTHENTICATED');
  }
});

// ─── 2. Room creation ────────────────────────────────────────────────────────

test('host creates a public room and is the sole host member', async () => {
  const res = await call(tokens.a, 'POST', '/api/rooms', {
    name: 'Movie Night',
    category: 'Movie',
    privacy: 'public',
    maxParticipants: 4,
  });
  assert.equal(res.status, 201);
  const room = (await json(res)).room as Record<string, unknown>;
  assert.equal(room.hostUserId, U.a);
  assert.equal(room.isHost, true);
  assert.equal((room.code as string).length, 6);
  assert.equal(room.memberCount, 1);
  assert.equal(room.status, 'LIVE');
  assert.equal(room.category, 'Movie');
  assert.equal((room.members as unknown[]).length, 1);
  const member = (room.members as { userId: string; role: string; micOn: boolean }[])[0];
  assert.equal(member.userId, U.a);
  assert.equal(member.role, 'host');
  assert.equal(member.micOn, false);
});

test('empty room name is rejected with VALIDATION_ERROR', async () => {
  const res = await call(tokens.a, 'POST', '/api/rooms', { name: '   ' });
  assert.equal(res.status, 400);
  const body = await json(res);
  assert.equal((body.error as { code: string }).code, 'VALIDATION_ERROR');
});

test('invalid category falls back to Other', async () => {
  const res = await call(tokens.a, 'POST', '/api/rooms', {
    name: 'Weird',
    category: 'General',
  });
  assert.equal(res.status, 201);
  const room = (await json(res)).room as { category: string };
  assert.equal(room.category, 'Other');
});

test('room codes are unique', async () => {
  const codes = new Set<string>();
  for (let i = 0; i < 10; i++) {
    const res = await call(tokens.a, 'POST', '/api/rooms', { name: `Code ${i}` });
    assert.equal(res.status, 201);
    codes.add(((await json(res)).room as { code: string }).code);
  }
  assert.equal(codes.size, 10);
});

// ─── 3. Discovery & detail ───────────────────────────────────────────────────

test('public rooms are listed; private rooms only for members', async () => {
  const publicRoom = await call(tokens.a, 'POST', '/api/rooms', { name: 'Listed', privacy: 'public' });
  const publicId = ((await json(publicRoom)).room as { id: string }).id;

  const privateRoom = await call(tokens.a, 'POST', '/api/rooms', { name: 'Secret', privacy: 'private' });
  const privateId = ((await json(privateRoom)).room as { id: string }).id;
  await call(tokens.b, 'POST', `/api/rooms/${privateId}/join`, {});

  // b sees the public room and their own private room
  const listB = (await json(await call(tokens.b, 'GET', '/api/rooms'))).rooms as { id: string }[];
  assert.ok(listB.some((r) => r.id === publicId));
  assert.ok(listB.some((r) => r.id === privateId));

  // c (not a member) does NOT see the private room
  const listC = (await json(await call(tokens.c, 'GET', '/api/rooms'))).rooms as { id: string }[];
  assert.ok(listC.some((r) => r.id === publicId));
  assert.ok(!listC.some((r) => r.id === privateId));

  // direct detail access to private room is 403 for non-members
  const detail = await call(tokens.c, 'GET', `/api/rooms/${privateId}`);
  assert.equal(detail.status, 403);
  const detailOk = await call(tokens.b, 'GET', `/api/rooms/${privateId}`);
  assert.equal(detailOk.status, 200);
});

test('unknown room detail is 404', async () => {
  const res = await call(tokens.a, 'GET', '/api/rooms/does-not-exist');
  assert.equal(res.status, 404);
});

// ─── 4. Joining ──────────────────────────────────────────────────────────────

test('a second user joins as a member', async () => {
  const created = await call(tokens.a, 'POST', '/api/rooms', { name: 'Join Me' });
  const roomId = ((await json(created)).room as { id: string }).id;

  const res = await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});
  assert.equal(res.status, 200);
  const room = (await json(res)).room as { memberCount: number; members: { userId: string; role: string }[]; isHost: boolean };
  assert.equal(room.memberCount, 2);
  assert.equal(room.members.find((m) => m.userId === U.b)?.role, 'member');
  assert.equal(room.isHost, false, 'joiner must not see isHost=true');
});

test('joining a full room is rejected with 409', async () => {
  const created = await call(tokens.a, 'POST', '/api/rooms', {
    name: 'Tiny Room',
    maxParticipants: 2,
  });
  const roomId = ((await json(created)).room as { id: string }).id;
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});
  const res = await call(tokens.c, 'POST', `/api/rooms/${roomId}/join`, {});
  assert.equal(res.status, 409);
  const body = await json(res);
  assert.equal((body.error as { code: string }).code, 'ROOM_FULL');
});

test('joining a missing room is 404', async () => {
  const res = await call(tokens.a, 'POST', '/api/rooms/nope/join', {});
  assert.equal(res.status, 404);
});

test('rejoining after leaving restores membership', async () => {
  const created = await call(tokens.a, 'POST', '/api/rooms', { name: 'Rejoin' });
  const roomId = ((await json(created)).room as { id: string }).id;
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/leave`, {});
  const again = await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});
  assert.equal(again.status, 200);
  const room = (await json(again)).room as { memberCount: number };
  assert.equal(room.memberCount, 2);
});

// ─── 5. Leaving, host transfer, empty rooms ──────────────────────────────────

test('host leave transfers host to earliest-joined member', async () => {
  const created = await call(tokens.a, 'POST', '/api/rooms', { name: 'Transfer' });
  const roomId = ((await json(created)).room as { id: string }).id;
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});
  await call(tokens.c, 'POST', `/api/rooms/${roomId}/join`, {});

  const res = await call(tokens.a, 'POST', `/api/rooms/${roomId}/leave`, {});
  assert.equal(res.status, 200);
  const detail = (await json(await call(tokens.b, 'GET', `/api/rooms/${roomId}`))).room as {
    hostUserId: string;
    members: { userId: string; role: string }[];
    isHost: boolean;
  };
  assert.equal(detail.hostUserId, U.b, 'earliest-joined member becomes host');
  assert.equal(detail.members.find((m) => m.userId === U.b)?.role, 'host');
  assert.equal(detail.members.find((m) => m.userId === U.c)?.role, 'member');
  assert.equal(detail.isHost, true, 'new host sees isHost=true');
});

test('host leaving alone marks the room empty and hides it from listings', async () => {
  const created = await call(tokens.a, 'POST', '/api/rooms', { name: 'Doomed' });
  const roomId = ((await json(created)).room as { id: string }).id;

  const res = await call(tokens.a, 'POST', `/api/rooms/${roomId}/leave`, {});
  assert.equal(res.status, 200);
  const room = (await json(res)).room as { emptySince: string | null; memberCount: number };
  assert.ok(room.emptySince, 'emptySince must be set');
  assert.equal(room.memberCount, 0);

  const list = (await json(await call(tokens.a, 'GET', '/api/rooms'))).rooms as { id: string }[];
  assert.ok(!list.some((r) => r.id === roomId), 'empty room must not appear in listings');

  // joining an empty room before cleanup timeout succeeds and restores the room
  const join = await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});
  assert.equal(join.status, 200);
  const rejoined = (await json(join)).room as { emptySince: string | null; memberCount: number };
  assert.equal(rejoined.emptySince, null, 'emptySince is reset');
  assert.equal(rejoined.memberCount, 1);
});

// ─── 6. Host-only media/playback/screen-share ────────────────────────────────

test('members cannot change media, playback, or screen share (403 NOT_HOST)', async () => {
  const created = await call(tokens.a, 'POST', '/api/rooms', { name: 'Permission Room' });
  const roomId = ((await json(created)).room as { id: string }).id;
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});

  for (const [path, body] of [
    [`/api/rooms/${roomId}/media`, { title: 'X', url: 'https://example.com/v' }],
    [`/api/rooms/${roomId}/playback`, { isPlaying: true }],
    [`/api/rooms/${roomId}/screen-share`, { active: true }],
    [`/api/rooms/${roomId}/members/${U.a}/mute`, { muted: true }],
    [`/api/rooms/${roomId}/members/${U.a}/camera`, { enabled: false }],
    [`/api/rooms/${roomId}/members/${U.a}/remove`, undefined],
  ] as const) {
    const res = await call(tokens.b, 'POST', path, body ?? {});
    assert.equal(res.status, 403, `${path} by member should be 403`);
    const parsed = await json(res);
    assert.equal((parsed.error as { code: string }).code, 'NOT_HOST');
  }
});

test('host sets, updates, and clears media', async () => {
  const created = await call(tokens.a, 'POST', '/api/rooms', { name: 'Media Room' });
  const roomId = ((await json(created)).room as { id: string }).id;

  const set = await call(tokens.a, 'POST', `/api/rooms/${roomId}/media`, {
    title: 'Big Buck Bunny',
    url: 'https://example.com/bunny.mp4',
    duration: 596,
  });
  assert.equal(set.status, 200);
  let room = (await json(set)).room as { currentMedia: { title: string; url: string; duration: number } | null };
  assert.ok(room.currentMedia);
  assert.equal(room.currentMedia.title, 'Big Buck Bunny');
  assert.equal(room.currentMedia.url, 'https://example.com/bunny.mp4');
  assert.equal(room.currentMedia.duration, 596);

  const clear = await call(tokens.a, 'POST', `/api/rooms/${roomId}/media`, {});
  assert.equal(clear.status, 200);
  room = (await json(clear)).room as { currentMedia: { title: string; url: string; duration: number } | null };
  assert.equal(room.currentMedia, null);
});

test('host playback updates position and playing state', async () => {
  const created = await call(tokens.a, 'POST', '/api/rooms', { name: 'Playback Room' });
  const roomId = ((await json(created)).room as { id: string }).id;

  const res = await call(tokens.a, 'POST', `/api/rooms/${roomId}/playback`, {
    isPlaying: true,
    position: 42,
  });
  assert.equal(res.status, 200);
  const room = (await json(res)).room as { playback: { isPlaying: boolean; position: number } };
  assert.equal(room.playback.isPlaying, true);
  assert.equal(room.playback.position, 42);

  const bad = await call(tokens.a, 'POST', `/api/rooms/${roomId}/playback`, { position: 5 });
  assert.equal(bad.status, 400);
});

test('host screen share flag flips on and off', async () => {
  const created = await call(tokens.a, 'POST', '/api/rooms', { name: 'Share Room' });
  const roomId = ((await json(created)).room as { id: string }).id;

  const on = await call(tokens.a, 'POST', `/api/rooms/${roomId}/screen-share`, { active: true });
  assert.equal(((await json(on)).room as { screenShareActive: boolean }).screenShareActive, true);
  const off = await call(tokens.a, 'POST', `/api/rooms/${roomId}/screen-share`, { active: false });
  assert.equal(((await json(off)).room as { screenShareActive: boolean }).screenShareActive, false);
});

test('media URL must be http(s)', async () => {
  const created = await call(tokens.a, 'POST', '/api/rooms', { name: 'URL Room' });
  const roomId = ((await json(created)).room as { id: string }).id;
  const res = await call(tokens.a, 'POST', `/api/rooms/${roomId}/media`, {
    title: 'X',
    url: 'javascript:alert(1)',
  });
  assert.equal(res.status, 400);
});

// ─── 7. Moderation ───────────────────────────────────────────────────────────

test('host removes a member; removed member is locked out', async () => {
  const created = await call(tokens.a, 'POST', '/api/rooms', { name: 'Mod Room' });
  const roomId = ((await json(created)).room as { id: string }).id;
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});

  const res = await call(tokens.a, 'POST', `/api/rooms/${roomId}/members/${U.b}/remove`, {});
  assert.equal(res.status, 200);
  const room = (await json(res)).room as { members: { userId: string }[]; memberCount: number };
  assert.equal(room.memberCount, 1);
  assert.ok(!room.members.some((m) => m.userId === U.b));

  // removed member cannot set own state or join back via /self
  const self = await call(tokens.b, 'POST', `/api/rooms/${roomId}/self`, { micOn: true });
  assert.equal(self.status, 403);
  const body = await json(self);
  assert.equal((body.error as { code: string }).code, 'REMOVED_FROM_ROOM');
});

test('host cannot remove themselves; cannot remove non-members', async () => {
  const created = await call(tokens.a, 'POST', '/api/rooms', { name: 'Mod Rules' });
  const roomId = ((await json(created)).room as { id: string }).id;

  const self = await call(tokens.a, 'POST', `/api/rooms/${roomId}/members/${U.a}/remove`, {});
  assert.equal(self.status, 403);
  assert.equal(((await json(self)).error as { code: string }).code, 'INVALID_TARGET');

  const ghost = await call(tokens.a, 'POST', `/api/rooms/${roomId}/members/${U.d}/remove`, {});
  assert.equal(ghost.status, 403);
});

test('host mutes a member and forces camera state', async () => {
  const created = await call(tokens.a, 'POST', '/api/rooms', { name: 'Device Room' });
  const roomId = ((await json(created)).room as { id: string }).id;
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/self`, { micOn: true, cameraOn: true });

  const mute = await call(tokens.a, 'POST', `/api/rooms/${roomId}/members/${U.b}/mute`, { muted: true });
  assert.equal(mute.status, 200);
  const memberMuted = ((await json(mute)).room as { members: { userId: string; micOn: boolean; cameraOn: boolean }[] }).members.find(
    (m) => m.userId === U.b
  );
  assert.equal(memberMuted?.micOn, false);

  const cam = await call(tokens.a, 'POST', `/api/rooms/${roomId}/members/${U.b}/camera`, { enabled: false });
  assert.equal(cam.status, 200);
  const memberCam = ((await json(cam)).room as { members: { userId: string; micOn: boolean; cameraOn: boolean }[] }).members.find(
    (m) => m.userId === U.b
  );
  assert.equal(memberCam?.cameraOn, false);
});

// ─── 8. Self device state ────────────────────────────────────────────────────

test('members update their own mic/camera state', async () => {
  const created = await call(tokens.a, 'POST', '/api/rooms', { name: 'Self Room' });
  const roomId = ((await json(created)).room as { id: string }).id;
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});

  const res = await call(tokens.b, 'POST', `/api/rooms/${roomId}/self`, { micOn: true, cameraOn: false });
  assert.equal(res.status, 200);
  const member = ((await json(res)).room as { members: { userId: string; micOn: boolean; cameraOn: boolean }[] })
    .members.find((m) => m.userId === U.b);
  assert.equal(member?.micOn, true);
  assert.equal(member?.cameraOn, false);
});

// ─── 9. SSE stream + replay ──────────────────────────────────────────────────

test('SSE stream delivers persisted events; Last-Event-ID resumes after them', async () => {
  const created = await call(tokens.a, 'POST', '/api/rooms', { name: 'Stream Room' });
  const roomId = ((await json(created)).room as { id: string }).id;
  await call(tokens.a, 'POST', `/api/rooms/${roomId}/media`, {
    title: 'S1',
    url: 'https://example.com/s1.mp4',
  });

  async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, stop: (text: string) => boolean, ms = 5000): Promise<string> {
    const decoder = new TextDecoder();
    let received = '';
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const read = reader.read();
      const timeout = new Promise<{ done: true; value?: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true }), Math.max(0, deadline - Date.now()))
      );
      const { done, value } = await Promise.race([read, timeout]);
      if (!value) break;
      received += decoder.decode(value, { stream: true });
      if (stop(received)) break;
    }
    return received;
  }

  const res = await call(tokens.a, 'GET', `/api/rooms/${roomId}/events`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);

  const reader = res.body!.getReader();
  const received = await readUntil(reader, (text) => (text.match(/event: room:update/g) ?? []).length >= 2);
  await reader.cancel();

  assert.ok((received.match(/event: room:update/g) ?? []).length >= 2, 'create + media events must replay');
  const ids = Array.from(received.matchAll(/^id: (\d+)$/gm), (m) => Number(m[1]));
  assert.ok(ids.length >= 2);
  assert.ok(ids[0] < ids[1], 'events must be in ascending id order');

  // Reconnect with Last-Event-ID = first event id → only later events replay
  const res2 = await call(tokens.a, 'GET', `/api/rooms/${roomId}/events`, undefined, {
    'last-event-id': String(ids[0]),
  });
  const reader2 = res2.body!.getReader();
  const after = await readUntil(reader2, (text) => /event: room:update/.test(text));
  await reader2.cancel();
  assert.ok(!after.includes(`id: ${ids[0]}`), 'consumed event must not replay');
  assert.match(after, /id: \d+/, 'newer events still replay');
});

test('SSE stream is 403 for non-members of a private room', async () => {
  const created = await call(tokens.a, 'POST', '/api/rooms', { name: 'Secret Stream', privacy: 'private' });
  const roomId = ((await json(created)).room as { id: string }).id;
  const res = await call(tokens.d, 'GET', `/api/rooms/${roomId}/events`);
  assert.equal(res.status, 403);
});

// ─── 10. Empty-room cleanup ──────────────────────────────────────────────────

test('cleanup deletes expired empty rooms, members, and events', async () => {
  const created = await call(tokens.a, 'POST', '/api/rooms', { name: 'Expire Me' });
  const roomId = ((await json(created)).room as { id: string }).id;
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});
  await call(tokens.a, 'POST', `/api/rooms/${roomId}/leave`, {});
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/leave`, {});

  // Force the room to be empty since long ago (simulates TTL expiry).
  const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  db.prepare('UPDATE rooms SET emptySince = ? WHERE id = ?').run(old, roomId);

  const membersBefore = (
    db.prepare('SELECT COUNT(*) AS n FROM roomMembers WHERE roomId = ?').get(roomId) as { n: number }
  ).n;
  assert.ok(membersBefore > 0, 'members rows exist before cleanup');
  const eventsBefore = (
    db.prepare('SELECT COUNT(*) AS n FROM roomEvents WHERE roomId = ?').get(roomId) as { n: number }
  ).n;
  assert.ok(eventsBefore > 0, 'event rows exist before cleanup');

  const deleted = cleanupEmptyRooms();
  assert.ok(deleted.includes(roomId));

  const roomAfter = db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId);
  assert.equal(roomAfter, undefined, 'room row deleted');
  const membersAfter = (
    db.prepare('SELECT COUNT(*) AS n FROM roomMembers WHERE roomId = ?').get(roomId) as { n: number }
  ).n;
  assert.equal(membersAfter, 0, 'member rows deleted');
  const eventsAfter = (
    db.prepare('SELECT COUNT(*) AS n FROM roomEvents WHERE roomId = ?').get(roomId) as { n: number }
  ).n;
  assert.equal(eventsAfter, 0, 'event rows deleted');

  // Remaining users are untouched.
  const users = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  assert.equal(users.n, 4, 'user accounts are never deleted');
});

test('recently-empty rooms survive cleanup', async () => {
  const created = await call(tokens.a, 'POST', '/api/rooms', { name: 'Fresh Empty' });
  const roomId = ((await json(created)).room as { id: string }).id;
  await call(tokens.a, 'POST', `/api/rooms/${roomId}/leave`, {});

  const deleted = cleanupEmptyRooms();
  assert.ok(!deleted.includes(roomId), 'room within TTL must survive');
  const stillThere = db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId);
  assert.ok(stillThere, 'room row still present');
});

test('rejoining an empty room before timeout cancels emptySince cleanup state', async () => {
  const created = await call(tokens.a, 'POST', '/api/rooms', { name: 'Rejoin Keep Alive' });
  const roomId = ((await json(created)).room as { id: string }).id;
  await call(tokens.a, 'POST', `/api/rooms/${roomId}/leave`, {});

  const roomEmpty = db.prepare('SELECT emptySince FROM rooms WHERE id = ?').get(roomId) as { emptySince: string | null };
  assert.ok(roomEmpty.emptySince !== null, 'emptySince must be set when empty');

  // Rejoin before timeout
  const rejoin = await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});
  assert.equal(rejoin.status, 200);

  const roomAlive = db.prepare('SELECT emptySince FROM rooms WHERE id = ?').get(roomId) as { emptySince: string | null };
  assert.equal(roomAlive.emptySince, null, 'emptySince must be reset to null when someone rejoins');
});

test('room can be looked up and joined using 6-character room code', async () => {
  const created = await call(tokens.a, 'POST', '/api/rooms', { name: 'Code Lookup Room' });
  const createdData = (await json(created)).room as { id: string; code: string };
  const code = createdData.code;
  const roomId = createdData.id;

  // Detail by code
  const detail = await call(tokens.a, 'GET', `/api/rooms/${code}`);
  assert.equal(detail.status, 200);
  const detailData = (await json(detail)).room as { id: string };
  assert.equal(detailData.id, roomId);

  // Join by code
  const joinRes = await call(tokens.b, 'POST', `/api/rooms/${code}/join`, {});
  assert.equal(joinRes.status, 200);
  const joinData = (await json(joinRes)).room as { id: string };
  assert.equal(joinData.id, roomId);
});

test('active member can send room chat; non-member is rejected with 403', async () => {
  const created = await call(tokens.a, 'POST', '/api/rooms', { name: 'Chat Room' });
  const createdData = (await json(created)).room as { id: string };
  const roomId = createdData.id;

  // Member sends chat
  const chatRes = await call(tokens.a, 'POST', `/api/rooms/${roomId}/chat`, { text: 'Hello squad!' });
  assert.equal(chatRes.status, 201);
  const msg = (await json(chatRes)).message as { senderId: string; text: string; senderName: string };
  assert.equal(msg.senderId, U.a);
  assert.equal(msg.text, 'Hello squad!');

  // Non-member tries to send chat
  const rejected = await call(tokens.c, 'POST', `/api/rooms/${roomId}/chat`, { text: 'Intruder' });
  assert.equal(rejected.status, 403);
});

test('active member can send WebRTC signal; non-member is rejected with 403', async () => {
  const created = await call(tokens.a, 'POST', '/api/rooms', { name: 'Signal Room' });
  const createdData = (await json(created)).room as { id: string };
  const roomId = createdData.id;
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});

  // Valid signal
  const sigRes = await call(tokens.a, 'POST', `/api/rooms/${roomId}/signal`, {
    targetUserId: U.b,
    signal: { type: 'offer', sdp: 'fake-sdp' },
  });
  assert.equal(sigRes.status, 200);

  // Missing signal body
  const badSig = await call(tokens.a, 'POST', `/api/rooms/${roomId}/signal`, {});
  assert.equal(badSig.status, 400);

  // Non-member signal
  const nonMemberSig = await call(tokens.c, 'POST', `/api/rooms/${roomId}/signal`, {
    signal: { type: 'offer', sdp: 'fake-sdp' },
  });
  assert.equal(nonMemberSig.status, 403);
});

test('media URL rejects blob URLs; host can upload media and stream with HTTP 206', async () => {
  const created = await call(tokens.a, 'POST', '/api/rooms', { name: 'Movie Room' });
  const createdData = (await json(created)).room as { id: string };
  const roomId = createdData.id;
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});

  // 1. Reject blob: URLs
  const blobRes = await call(tokens.a, 'POST', `/api/rooms/${roomId}/media`, {
    url: 'blob:http://localhost:3000/1234-5678',
    title: 'Local Blob',
  });
  assert.equal(blobRes.status, 400);

  // 2. Non-host cannot upload media
  const nonHostFormData = new FormData();
  nonHostFormData.append('file', new Blob(['fake video content'], { type: 'video/mp4' }), 'movie.mp4');
  const nonHostUpload = await app.request(`/api/rooms/${roomId}/media/upload`, {
    method: 'POST',
    headers: {
      cookie: cookie(tokens.b),
    },
    body: nonHostFormData,
  });
  assert.equal(nonHostUpload.status, 403);

  // 3. Unsupported format rejected (.txt)
  const badFormData = new FormData();
  badFormData.append('file', new Blob(['fake text content'], { type: 'text/plain' }), 'document.txt');
  const badUpload = await app.request(`/api/rooms/${roomId}/media/upload`, {
    method: 'POST',
    headers: {
      cookie: cookie(tokens.a),
    },
    body: badFormData,
  });
  assert.equal(badUpload.status, 400);

  // 3b. MKV container format rejected immediately with clear message
  const mkvBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x88, 0x6d, 0x61, 0x74, 0x72, 0x6f, 0x73, 0x6b, 0x61]);
  const mkvFormData = new FormData();
  mkvFormData.append('file', new Blob([mkvBytes], { type: 'video/x-matroska' }), 'movie.mkv');
  const mkvUpload = await app.request(`/api/rooms/${roomId}/media/upload`, {
    method: 'POST',
    headers: {
      cookie: cookie(tokens.a),
    },
    body: mkvFormData,
  });
  assert.equal(mkvUpload.status, 400);
  const mkvJson = (await mkvUpload.json()) as { error: { message: string } };
  assert.match(mkvJson.error.message, /isn't supported for playback/);

  // 3c. Spoofed MKV with .mp4 filename rejected via container inspection
  const spoofedFormData = new FormData();
  spoofedFormData.append('file', new Blob([mkvBytes], { type: 'video/mp4' }), 'spoofed.mp4');
  const spoofedUpload = await app.request(`/api/rooms/${roomId}/media/upload`, {
    method: 'POST',
    headers: {
      cookie: cookie(tokens.a),
    },
    body: spoofedFormData,
  });
  assert.equal(spoofedUpload.status, 400);

  // 3d. 0-byte empty file is rejected with 400 EMPTY_FILE
  const emptyFormData = new FormData();
  emptyFormData.append('file', new Blob([], { type: 'video/mp4' }), 'empty.mp4');
  const emptyUpload = await app.request(`/api/rooms/${roomId}/media/upload`, {
    method: 'POST',
    headers: {
      cookie: cookie(tokens.a),
    },
    body: emptyFormData,
  });
  assert.equal(emptyUpload.status, 400);
  const emptyJson = (await emptyUpload.json()) as { error: { code: string; message: string } };
  assert.equal(emptyJson.error.code, 'EMPTY_FILE');

  // 4. Valid host video upload
  const validFormData = new FormData();
  const testBytes = new Uint8Array(2048);
  for (let i = 0; i < testBytes.length; i++) testBytes[i] = i % 256;
  validFormData.append('file', new Blob([testBytes], { type: 'video/mp4' }), 'test-movie.mp4');

  const uploadRes = await app.request(`/api/rooms/${roomId}/media/upload`, {
    method: 'POST',
    headers: {
      cookie: cookie(tokens.a),
    },
    body: validFormData,
  });
  assert.equal(uploadRes.status, 200);
  const uploadJson = (await uploadRes.json()) as { ok: boolean; media: { url: string; title: string } };
  assert.equal(uploadJson.ok, true);
  assert.match(uploadJson.media.url, /^\/api\/uploads\/media-/);

  // 5. Verify HEAD request returns Content-Length, Accept-Ranges, and Content-Type
  const headRes = await app.request(uploadJson.media.url, {
    method: 'HEAD',
  });
  assert.equal(headRes.status, 200);
  assert.equal(headRes.headers.get('content-length'), '2048');
  assert.equal(headRes.headers.get('accept-ranges'), 'bytes');
  assert.equal(headRes.headers.get('content-type'), 'video/mp4');

  // 6. Verify initial chunk range request (bytes 0-1023) returns HTTP 206
  const range1Res = await app.request(uploadJson.media.url, {
    method: 'GET',
    headers: {
      range: 'bytes=0-1023',
    },
  });
  assert.equal(range1Res.status, 206);
  assert.equal(range1Res.headers.get('content-range'), 'bytes 0-1023/2048');
  assert.equal(range1Res.headers.get('content-length'), '1024');
  assert.equal(range1Res.headers.get('accept-ranges'), 'bytes');

  // 7. Verify seeking to subsequent chunk (bytes 1024-2047) returns HTTP 206
  const range2Res = await app.request(uploadJson.media.url, {
    method: 'GET',
    headers: {
      range: 'bytes=1024-2047',
    },
  });
  assert.equal(range2Res.status, 206);
  assert.equal(range2Res.headers.get('content-range'), 'bytes 1024-2047/2048');
  assert.equal(range2Res.headers.get('content-length'), '1024');

  // 8. Verify out-of-bounds seek returns HTTP 416 Range Not Satisfiable
  const rangeInvalidRes = await app.request(uploadJson.media.url, {
    method: 'GET',
    headers: {
      range: 'bytes=5000-6000',
    },
  });
  assert.equal(rangeInvalidRes.status, 416);
  assert.equal(rangeInvalidRes.headers.get('content-range'), 'bytes */2048');
});

// ─── 12b. Streaming upload hardening ──────────────────────────────────────────

test('upload at exactly the byte limit is accepted; over-limit is rejected and leaves no partial file', async () => {
  process.env.MAX_UPLOAD_BYTES = '4096';
  try {
    const created = await call(tokens.a, 'POST', '/api/rooms', { name: 'Limit Room' });
    const roomId = ((await json(created)).room as { id: string }).id;

    // Exact limit accepted
    const exactBytes = new Uint8Array(4096);
    for (let i = 0; i < exactBytes.length; i++) exactBytes[i] = (i * 7) % 256;
    const exactForm = new FormData();
    exactForm.append('file', new Blob([exactBytes], { type: 'video/mp4' }), 'exact.mp4');
    const exactRes = await app.request(`/api/rooms/${roomId}/media/upload`, {
      method: 'POST',
      headers: { cookie: cookie(tokens.a) },
      body: exactForm,
    });
    assert.equal(exactRes.status, 200);
    const exactJson = (await exactRes.json()) as { ok: boolean; media: { url: string } };
    assert.equal(exactJson.ok, true);
    const exactFile = path.join(uploadsDir, path.basename(exactJson.media.url));
    assert.equal(fs.statSync(exactFile).size, 4096);

    // Over limit rejected
    const overBytes = new Uint8Array(8192);
    for (let i = 0; i < overBytes.length; i++) overBytes[i] = (i * 13) % 256;
    const overForm = new FormData();
    overForm.append('file', new Blob([overBytes], { type: 'video/mp4' }), 'over.mp4');
    const overRes = await app.request(`/api/rooms/${roomId}/media/upload`, {
      method: 'POST',
      headers: { cookie: cookie(tokens.a) },
      body: overForm,
    });
    assert.equal(overRes.status, 400);
    const overJson = (await overRes.json()) as { error: { code: string } };
    assert.equal(overJson.error.code, 'FILE_TOO_LARGE');

    // No temp or oversized files may remain
    const leftovers = fs.readdirSync(uploadsDir).filter((f) => f.endsWith('.part'));
    assert.deepEqual(leftovers, [], 'no .part temp files may remain after a rejected upload');
    const oversized = fs
      .readdirSync(uploadsDir)
      .filter((f) => f.startsWith('media-') && fs.statSync(path.join(uploadsDir, f)).size > 4096);
    assert.deepEqual(oversized, [], 'no file above the limit may remain');
  } finally {
    delete process.env.MAX_UPLOAD_BYTES;
  }
});

test('hostile client filenames are neutralized; only the generated safe name is stored', async () => {
  const created = await call(tokens.a, 'POST', '/api/rooms', { name: 'Evil Name Room' });
  const roomId = ((await json(created)).room as { id: string }).id;

  const bytes = new Uint8Array(512).fill(0x5a);
  const evilForm = new FormData();
  evilForm.append('file', new Blob([bytes], { type: 'video/mp4' }), '../../evil-escape.mp4');
  const res = await app.request(`/api/rooms/${roomId}/media/upload`, {
    method: 'POST',
    headers: { cookie: cookie(tokens.a) },
    body: evilForm,
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; media: { url: string; title: string } };
  assert.match(body.media.url, /^\/api\/uploads\/media-[0-9]+-[0-9a-f-]{12}\.mp4$/);
  assert.ok(!body.media.url.includes('..'), 'stored URL must not contain path traversal');
  const storedName = path.basename(body.media.url);
  assert.ok(fs.existsSync(path.join(uploadsDir, storedName)), 'file must exist on disk under the safe name');
  assert.ok(!fs.existsSync(path.join(uploadsDir, '..', 'evil-escape.mp4')), 'no file may escape the uploads dir');
});

test('disallowed container rejection cleans up any temporary upload file', async () => {
  const created = await call(tokens.a, 'POST', '/api/rooms', { name: 'Container Cleanup Room' });
  const roomId = ((await json(created)).room as { id: string }).id;

  const mkvBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x88, 0x6d, 0x61, 0x74, 0x72, 0x6f, 0x73, 0x6b, 0x61]);
  const form = new FormData();
  form.append('file', new Blob([mkvBytes], { type: 'video/x-matroska' }), 'clip.mkv');
  const res = await app.request(`/api/rooms/${roomId}/media/upload`, {
    method: 'POST',
    headers: { cookie: cookie(tokens.a) },
    body: form,
  });
  assert.equal(res.status, 400);

  const leftovers = fs.readdirSync(uploadsDir);
  assert.ok(!leftovers.some((f) => f.endsWith('.part')), 'no .part temp file may remain');
  assert.ok(!leftovers.some((f) => f.startsWith('media-') && f.endsWith('.mkv')), 'rejected container must not be stored');
});

test('zero-byte upload is rejected without creating any file', async () => {
  const created = await call(tokens.a, 'POST', '/api/rooms', { name: 'Empty File Room' });
  const roomId = ((await json(created)).room as { id: string }).id;

  const filesBefore = fs.readdirSync(uploadsDir).filter((f) => f.startsWith('media-')).length;
  const form = new FormData();
  form.append('file', new Blob([], { type: 'video/mp4' }), 'empty.mp4');
  const res = await app.request(`/api/rooms/${roomId}/media/upload`, {
    method: 'POST',
    headers: { cookie: cookie(tokens.a) },
    body: form,
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'EMPTY_FILE');

  const filesAfter = fs.readdirSync(uploadsDir).filter((f) => f.startsWith('media-')).length;
  assert.equal(filesAfter, filesBefore, 'rejected empty upload must not create any file');
  assert.ok(!fs.readdirSync(uploadsDir).some((f) => f.endsWith('.part')), 'no .part temp file may remain');
});

// ─── 13. Ephemeral signal buffering (SSE-registration race) ───────────────────

test('signals sent before the target SSE stream registers are buffered and delivered on connect', async () => {
  const created = await call(tokens.a, 'POST', '/api/rooms', { name: 'Signal Race Room' });
  const roomId = ((await json(created)).room as { id: string }).id;
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`);

  // A signals B *before* B's SSE stream is registered — the historical race
  // where the offer was dropped and the remote camera never appeared.
  const sigRes = await call(tokens.a, 'POST', `/api/rooms/${roomId}/signal`, {
    targetUserId: U.b,
    signal: { type: 'offer', sdp: 'v=0\r\no=test' },
  });
  assert.equal(sigRes.status, 200);

  // B opens its SSE stream *after* the signal was sent
  const res = await call(tokens.b, 'GET', `/api/rooms/${roomId}/events`);
  assert.equal(res.status, 200);

  async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, stop: (text: string) => boolean, ms = 5000): Promise<string> {
    const decoder = new TextDecoder();
    let received = '';
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const read = reader.read();
      const timeout = new Promise<{ done: true; value?: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true }), Math.max(0, deadline - Date.now()))
      );
      const { done, value } = await Promise.race([read, timeout]);
      if (!value) break;
      received += decoder.decode(value, { stream: true });
      if (stop(received)) break;
    }
    return received;
  }

  const reader = res.body!.getReader();
  const received = await readUntil(reader, (text) => text.includes('event: signal'));
  await reader.cancel();

  assert.ok(received.includes('event: signal'), 'buffered signal must be delivered after SSE connects');
  assert.ok(received.includes('"fromUserId":"' + U.a + '"'), 'signal must carry the sender');
  assert.ok(received.includes('"type":"offer"'), 'signal payload must be intact');
});