// server/tests/reconnect.test.ts
// Phase 6.5: SSE reconnect & realtime membership recovery.
// Covers Last-Event-ID resume (multi-reconnect, no duplicate replay), the
// disconnect grace window, membership expiry & rejoin, removed-member
// lockout, private-room 403 gates, room-full / room-gone terminals,
// ephemeral signal buffering, and the truncated-replay resync marker.
//
// Run: npx tsx --test server/tests/reconnect.test.ts
//
// NOTE: DISCONNECT_GRACE_MS must be set BEFORE the realtime module is
// imported — this file uses dynamic imports on purpose (ESM hoists static
// imports). Each test file runs in its own process under tsx --test.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(os.tmpdir(), `praconnect-reconnect-${process.pid}-${Date.now()}.db`);
process.env.ROOM_EMPTY_TTL_MS = '60000';
process.env.DISCONNECT_GRACE_MS = '200';
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `praconnect-uploads-${process.pid}-${Date.now()}`);

const { db } = await import('../db/index');
const { rooms } = await import('../routes/rooms');
const { createSession, SESSION_COOKIE_NAME } = await import('../auth/session');
const { cleanupEmptyRooms } = await import('../rooms/service');
const { emit, emitEphemeral, lastEventId, REPLAY_WINDOW } = await import('../rooms/realtime');

const app = new Hono();
app.route('/api/rooms', rooms);

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Read the SSE body until `stop(text)` returns true or the deadline passes.
 *  Never abandons an in-flight read(): when the deadline wins the race the
 *  pending read is drained first, so live frames are never swallowed. */
async function collect(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  stop: (text: string) => boolean,
  ms = 5000
): Promise<string> {
  const decoder = new TextDecoder();
  let received = '';
  const deadline = Date.now() + ms;
  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const read = reader.read();
    const timeout = new Promise<{ done: true; value?: undefined }>((resolve) =>
      setTimeout(() => resolve({ done: true }), remaining)
    );
    const settled = await Promise.race([read, timeout]);
    if (settled.done && settled.value === undefined) {
      // Deadline won: drain the in-flight read (bounded) before returning.
      const drained = await Promise.race([
        read,
        new Promise<{ done: true; value?: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: true }), 1000)
        ),
      ]);
      if (!drained.done && drained.value) {
        received += decoder.decode(drained.value, { stream: true });
        if (stop(received)) return received;
      }
      break;
    }
    if (settled.done) break;
    if (!settled.value) break;
    received += decoder.decode(settled.value, { stream: true });
    if (stop(received)) return received;
  }
  return received;
}

const idsIn = (text: string): number[] => Array.from(text.matchAll(/^id: (\d+)$/gm), (m) => Number(m[1]));

async function createRoom(hostToken: string, name: string, extra?: Record<string, unknown>): Promise<string> {
  const res = await call(hostToken, 'POST', '/api/rooms', { name, ...extra });
  assert.equal(res.status, 201, `create ${name}`);
  return ((await json(res)).room as { id: string }).id;
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
  fs.rmSync(process.env.UPLOADS_DIR!, { recursive: true, force: true });
});

// ─── A. Last-Event-ID resume across multiple reconnects ──────────────────────

test('A: reconnect resumes strictly after the cursor across multiple drops', async () => {
  const roomId = await createRoom(tokens.a, 'A Resume');
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});
  const baseline = lastEventId(roomId);
  assert.ok(baseline >= 2, `create + join events exist (got ${baseline})`);

  // First connection: replay everything, capture the cursor.
  const r1 = await call(tokens.b, 'GET', `/api/rooms/${roomId}/events`);
  assert.equal(r1.status, 200);
  const reader1 = r1.body!.getReader();
  await collect(reader1, (t) => idsIn(t).length >= 2);
  await reader1.cancel();
  const cursor = baseline;

  // Drop and reconnect with the cursor (inside the grace window). The single
  // collect() spans both the idle window and the live event, so nothing can
  // be replayed twice or swallowed.
  await sleep(50);
  const r2 = await call(tokens.b, 'GET', `/api/rooms/${roomId}/events`, undefined, {
    'last-event-id': String(cursor),
  });
  const reader2 = r2.body!.getReader();
  const pending2 = collect(reader2, (t) => idsIn(t).length >= 1, 3000);
  await sleep(300);
  const media = await call(tokens.a, 'POST', `/api/rooms/${roomId}/media`, {
    title: 'S1',
    url: 'https://example.com/s1.mp4',
  });
  assert.equal(media.status, 200);
  const got2 = await pending2;
  await reader2.cancel();
  const ids2 = idsIn(got2);
  assert.equal(ids2.length, 1, 'only the new event replays');
  assert.ok(ids2[0] > cursor, `new id ${ids2[0]} > cursor ${cursor}`);
  assert.ok(!ids2.includes(cursor), 'cursor event never reappears');

  // Second drop/reconnect with the updated cursor: no duplicates of old ids.
  await sleep(50);
  const r3 = await call(tokens.b, 'GET', `/api/rooms/${roomId}/events`, undefined, {
    'last-event-id': String(ids2[0]),
  });
  const reader3 = r3.body!.getReader();
  const pending3 = collect(reader3, (t) => idsIn(t).length >= 1, 3000);
  await sleep(300);
  const media2 = await call(tokens.a, 'POST', `/api/rooms/${roomId}/media`, {
    title: 'S2',
    url: 'https://example.com/s2.mp4',
  });
  assert.equal(media2.status, 200);
  const got3 = await pending3;
  await reader3.cancel();
  const ids3 = idsIn(got3);
  assert.equal(ids3.length, 1);
  assert.ok(ids3[0] > ids2[0], `new id ${ids3[0]} > previous cursor ${ids2[0]}`);
  assert.ok(!ids3.includes(ids2[0]) && !ids3.includes(cursor), 'no duplicate replay');
});

// ─── B. Same cursor → zero duplicate ids ─────────────────────────────────────

test('B: reconnect with the current cursor never redelivers consumed events', async () => {
  const roomId = await createRoom(tokens.a, 'B Dedup');
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});
  const cursor = lastEventId(roomId);

  const r1 = await call(tokens.b, 'GET', `/api/rooms/${roomId}/events`, undefined, {
    'last-event-id': String(cursor),
  });
  assert.equal(r1.status, 200);
  const reader1 = r1.body!.getReader();
  const pending = collect(reader1, (t) => idsIn(t).length >= 1, 3000);
  await sleep(400);
  const media = await call(tokens.a, 'POST', `/api/rooms/${roomId}/media`, {
    title: 'S1',
    url: 'https://example.com/s1.mp4',
  });
  assert.equal(media.status, 200);
  const got = await pending;
  await reader1.cancel();
  const ids = idsIn(got);
  assert.equal(ids.length, 1, 'exactly one live event, no replayed duplicates');
  assert.ok(ids[0] > cursor);
  assert.ok(!ids.includes(cursor), `cursor event ${cursor} must not reappear`);
});

// ─── C. Reconnect inside the grace window keeps membership ───────────────────

test('C: reconnect within the grace window preserves membership', async () => {
  const roomId = await createRoom(tokens.a, 'C Grace');
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});

  const r1 = await call(tokens.b, 'GET', `/api/rooms/${roomId}/events`);
  const reader1 = r1.body!.getReader();
  await collect(reader1, (t) => t.includes('event:'));
  await reader1.cancel();

  // Reconnect before DISCONNECT_GRACE_MS (200ms) elapses.
  await sleep(100);
  const r2 = await call(tokens.b, 'GET', `/api/rooms/${roomId}/events`);
  assert.equal(r2.status, 200, 'stream reconnects while grace is pending');
  const reader2 = r2.body!.getReader();
  await sleep(50);
  await reader2.cancel();

  const self = await call(tokens.b, 'POST', `/api/rooms/${roomId}/self`, { micOn: true });
  assert.equal(self.status, 200, 'member still active after quick reconnect');
});

// ─── D. Grace expiry removes membership (no ghost members) ───────────────────

test('D: membership expires after the grace window', async () => {
  const roomId = await createRoom(tokens.a, 'D Expire');
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});
  assert.equal(((await json(await call(tokens.a, 'GET', `/api/rooms/${roomId}`))).room as { memberCount: number }).memberCount, 2);

  const r1 = await call(tokens.b, 'GET', `/api/rooms/${roomId}/events`);
  const reader1 = r1.body!.getReader();
  await collect(reader1, (t) => t.includes('event:'));
  await reader1.cancel();

  // Wait longer than the 200ms grace window.
  await sleep(600);

  const self = await call(tokens.b, 'POST', `/api/rooms/${roomId}/self`, { micOn: true });
  assert.equal(self.status, 403, 'expired member cannot use /self');
  assert.equal(((await json(self)).error as { code: string }).code, 'REMOVED_FROM_ROOM');

  const detail = ((await json(await call(tokens.a, 'GET', `/api/rooms/${roomId}`))).room as {
    members: { userId: string }[];
    memberCount: number;
  });
  assert.equal(detail.memberCount, 1, 'member removed from the room');
  assert.ok(!detail.members.some((m) => m.userId === U.b), 'ghost member is gone');
});

// ─── E. Expired member can rejoin (left, not removed) ────────────────────────

test('E: expired member rejoins successfully', async () => {
  const roomId = await createRoom(tokens.a, 'E Rejoin');
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});

  const r1 = await call(tokens.b, 'GET', `/api/rooms/${roomId}/events`);
  const reader1 = r1.body!.getReader();
  await collect(reader1, (t) => t.includes('event:'));
  await reader1.cancel();
  await sleep(600);

  const rejoin = await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});
  assert.equal(rejoin.status, 200, 'left member may re-enter');
  const member = ((await json(rejoin)).room as { members: { userId: string }[] }).members.find((m) => m.userId === U.b);
  assert.ok(member, 'member appears in the room again');
});

// ─── F. Removed member is locked out of the room entirely ────────────────────

test('F: host-removed member cannot rejoin via the join API', async () => {
  const roomId = await createRoom(tokens.a, 'F Lockout');
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});

  const remove = await call(tokens.a, 'POST', `/api/rooms/${roomId}/members/${U.b}/remove`, {});
  assert.equal(remove.status, 200);

  const rejoin = await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});
  assert.equal(rejoin.status, 403);
  assert.equal(((await json(rejoin)).error as { code: string }).code, 'REMOVED_FROM_ROOM');
});

// ─── G. Private-room authorization gates after expiry ────────────────────────

test('G: private room returns 403 to expired members and outsiders', async () => {
  const roomId = await createRoom(tokens.a, 'G Private', { privacy: 'private' });
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});

  // Authorized member can connect...
  const r1 = await call(tokens.b, 'GET', `/api/rooms/${roomId}/events`);
  assert.equal(r1.status, 200);
  const reader1 = r1.body!.getReader();
  await collect(reader1, (t) => t.includes('event:'));
  await reader1.cancel();
  await sleep(600);

  // ...but once the grace window passes, the 403 gate appears (recovery path:
  // client re-joins, then reconnects).
  const expired = await call(tokens.b, 'GET', `/api/rooms/${roomId}/events`);
  assert.equal(expired.status, 403);
  assert.equal(((await json(expired)).error as { code: string }).code, 'ROOM_MEMBERSHIP_REQUIRED');

  const outsider = await call(tokens.d, 'GET', `/api/rooms/${roomId}/events`);
  assert.equal(outsider.status, 403);

  // Recovery: join then reconnect.
  const rejoin = await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});
  assert.equal(rejoin.status, 200);
  const r2 = await call(tokens.b, 'GET', `/api/rooms/${roomId}/events`);
  assert.equal(r2.status, 200, 'member reconnects after recovery join');
  await r2.body!.getReader().cancel();
});

// ─── H. Room deleted → terminal 404s ─────────────────────────────────────────

test('H: deleted room returns 404 ROOM_GONE on events and join', async () => {
  const roomId = await createRoom(tokens.a, 'H Gone');
  await call(tokens.a, 'POST', `/api/rooms/${roomId}/leave`, {});

  const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  db.prepare('UPDATE rooms SET emptySince = ? WHERE id = ?').run(old, roomId);
  cleanupEmptyRooms();

  const events = await call(tokens.a, 'GET', `/api/rooms/${roomId}/events`);
  assert.equal(events.status, 404);
  assert.equal(((await json(events)).error as { code: string }).code, 'ROOM_GONE');

  const join = await call(tokens.a, 'POST', `/api/rooms/${roomId}/join`, {});
  assert.equal(join.status, 404);
  assert.equal(((await json(join)).error as { code: string }).code, 'ROOM_NOT_FOUND');
});

// ─── I. Room full → 409 ROOM_FULL terminal ───────────────────────────────────

test('I: full room returns 409 ROOM_FULL on join', async () => {
  const roomId = await createRoom(tokens.a, 'I Full', { maxParticipants: 2 });
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});
  assert.equal(((await json(await call(tokens.a, 'GET', `/api/rooms/${roomId}`))).room as { memberCount: number }).memberCount, 2);

  const full = await call(tokens.c, 'POST', `/api/rooms/${roomId}/join`, {});
  assert.equal(full.status, 409);
  assert.equal(((await json(full)).error as { code: string }).code, 'ROOM_FULL');
});

// ─── J. Ephemeral signal buffering survives stream drop ──────────────────────

test('J: ephemeral signals buffered for a disconnected peer are flushed on reconnect', async () => {
  const roomId = await createRoom(tokens.a, 'J Signal');
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});

  // Peer b is a member but has no open SSE stream: the signal must be buffered.
  const signal = await call(tokens.a, 'POST', `/api/rooms/${roomId}/signal`, {
    targetUserId: U.b,
    signal: { type: 'offer', sdp: 'x' },
  });
  assert.equal(signal.status, 200);

  const r1 = await call(tokens.b, 'GET', `/api/rooms/${roomId}/events`);
  assert.equal(r1.status, 200);
  const reader1 = r1.body!.getReader();
  const got = await collect(reader1, (t) => t.includes('event: signal'));
  await reader1.cancel();

  assert.match(got, /event: signal/, 'buffered signal delivered on open');
  assert.ok(!/^id: \d+/m.test(got.split('event: signal')[0]), 'ephemeral frames carry no persisted id');
  assert.ok(got.includes('"fromUserId":"' + U.a + '"'), 'signal payload intact');
});

// ─── K. Truncated replay emits the room:resync marker first ──────────────────

test('K: replay beyond the window emits room:resync before the replay frames', async () => {
  const roomId = await createRoom(tokens.a, 'K Resync');
  const cursor = lastEventId(roomId);

  // Seed more than REPLAY_WINDOW persisted events (direct emit bypasses the
  // chat rate limiter; these are synthetic room:update frames).
  for (let i = 1; i <= REPLAY_WINDOW + 2; i++) {
    emit(roomId, 'room:update', { room: { seq: i } });
  }
  assert.ok(lastEventId(roomId) - cursor >= REPLAY_WINDOW + 2, 'events seeded');

  const r1 = await call(tokens.b, 'GET', `/api/rooms/${roomId}/events`, undefined, {
    'last-event-id': String(cursor),
  });
  assert.equal(r1.status, 200);
  const reader1 = r1.body!.getReader();
  const got = await collect(reader1, (t) => idsIn(t).length >= REPLAY_WINDOW);
  await reader1.cancel();

  assert.match(got, /event: room:resync/, 'resync marker present');
  assert.ok(got.indexOf('event: room:resync') < got.indexOf('id: '), 'resync marker precedes replay');
  const ids = idsIn(got);
  assert.equal(ids.length, REPLAY_WINDOW, 'exactly REPLAY_WINDOW frames replayed');
  assert.ok(ids[0] > cursor && ids[ids.length - 1] > cursor, 'all replayed ids are after the cursor');
  assert.ok(!ids.includes(cursor), 'cursor event never reappears');
});
