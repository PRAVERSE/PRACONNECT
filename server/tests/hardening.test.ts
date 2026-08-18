// server/tests/hardening.test.ts
// Phase 6.8: production hardening — auth data cleanup, upload file lifecycle,
// room event retention, participant cap, transactional room cleanup, poster
// URL validation, and logout-all-devices.
//
// Run: npx tsx --test server/tests/hardening.test.ts
//
// NOTE: env vars must be set BEFORE the modules are imported — this file
// uses dynamic imports on purpose (ESM hoists static imports).

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(os.tmpdir(), `praconnect-harden-${process.pid}-${Date.now()}.db`);
process.env.ROOM_EMPTY_TTL_MS = '60000';
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `praconnect-harden-uploads-${process.pid}-${Date.now()}`);
process.env.MAX_ROOM_PARTICIPANTS = '12';
process.env.DISCONNECT_GRACE_MS = '200';
process.env.RATE_LIMIT_CHAT_MAX = '3';
process.env.RATE_LIMIT_CHAT_WINDOW_MS = '60000';

const { db } = await import('../db/index');
const { rooms, uploadsDir } = await import('../routes/rooms');
const { auth } = await import('../routes/auth');
const { createSession, getSessionUser, SESSION_COOKIE_NAME } = await import('../auth/session');
const { hashPassword, generateId } = await import('../auth/auth');
const { createPendingSignup } = await import('../auth/pendingSignup');
const { cleanupEmptyRooms, MAX_ROOM_PARTICIPANTS } = await import('../rooms/service');
const { emit, replayEventsWithMeta, lastEventId, cleanupRoomEvents, REPLAY_WINDOW } = await import('../rooms/realtime');
const { cleanupAuthData } = await import('../auth/cleanup');
const { sweepOrphanUploads } = await import('../uploads/lifecycle');
const { resetRateLimits } = await import('../rate-limit');

const app = new Hono();
app.route('/api/auth', auth);
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

async function createRoom(hostToken: string, name: string, extra?: Record<string, unknown>): Promise<string> {
  const res = await call(hostToken, 'POST', '/api/rooms', { name, category: 'Movie', privacy: 'public', maxParticipants: 4, ...extra });
  assert.equal(res.status, 201, `create ${name}`);
  return ((await json(res)).room as { id: string }).id;
}

/** Read the SSE body until `stop(text)` returns true or the deadline passes. */
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

function uploadBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) % 256;
  return bytes;
}

async function uploadFile(roomId: string, token: string, name: string, bytes: Uint8Array): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([bytes as any], { type: 'video/mp4' }), name);
  const res = await app.request(`/api/rooms/${roomId}/media/upload`, {
    method: 'POST',
    headers: { cookie: cookie(token) },
    body: form,
  });
  assert.equal(res.status, 200, 'upload must succeed');
  return path.basename(((await res.json()) as { media: { url: string } }).media.url);
}

// a..m = 13 users so a room capped at 12 can be filled and one more rejected.
const U: Record<string, string> = {};
for (const key of 'abcdefghijklm') U[key] = `user-${key}`;
let tokens: Record<string, string> = {};

before(async () => {
  for (const [key, id] of Object.entries(U)) {
    seedUser(id, `User ${key.toUpperCase()}`, `user${key}`, `${key}@test.dev`);
  }
  for (const [key, id] of Object.entries(U)) {
    tokens[key] = await login(id);
  }
});

beforeEach(() => {
  resetRateLimits();
});

after(() => {
  db.close();
  fs.rmSync(uploadsDir, { recursive: true, force: true });
});

// ─── A. Auth data cleanup (P1/A) ─────────────────────────────────────────────

test('A: cleanup removes expired auth rows and old login activity, keeps valid rows', async () => {
  const now = Date.now();
  const past = new Date(now - 1000).toISOString();
  const future = new Date(now + 3_600_000).toISOString();

  const validToken = await createSession(U.a);
  db.prepare(
    `INSERT INTO sessions (id, userId, tokenHash, expiresAt, createdAt, lastUsedAt) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(generateId(), U.a, 'expired-session-hash', past, past, past);
  db.prepare(
    `INSERT INTO emailOtps (id, userId, email, purpose, otpHash, expiresAt, attempts, consumedAt, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)`
  ).run(generateId(), U.a, 'expired-otp@test.dev', 'password_reset', 'otp-hash-1', past, past);
  db.prepare(
    `INSERT INTO emailOtps (id, userId, email, purpose, otpHash, expiresAt, attempts, consumedAt, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)`
  ).run(generateId(), U.a, 'valid-otp@test.dev', 'password_reset', 'otp-hash-2', future, past);
  db.prepare(
    `INSERT INTO passwordResetTokens (id, userId, tokenHash, expiresAt, usedAt, createdAt) VALUES (?, ?, ?, ?, NULL, ?)`
  ).run(generateId(), U.a, 'reset-token-hash', past, past);

  const ph = await hashPassword('ValidPass123!');
  await createPendingSignup('Ghost User', 'ghostuser', 'ghost@test.dev', ph);
  db.prepare('UPDATE pendingSignups SET expiresAt = ? WHERE email = ?').run(past, 'ghost@test.dev');

  db.prepare(
    `INSERT INTO loginActivity (id, userId, loginTime, location, authenticationMethod) VALUES (?, ?, ?, ?, ?)`
  ).run(generateId(), U.a, new Date(now - 40 * 86_400_000).toISOString(), 'unknown', 'email');
  db.prepare(
    `INSERT INTO loginActivity (id, userId, loginTime, location, authenticationMethod) VALUES (?, ?, ?, ?, ?)`
  ).run(generateId(), U.a, new Date(now - 60_000).toISOString(), 'unknown', 'google');

  const result = cleanupAuthData(now);
  assert.ok(result.deletedSessions >= 1, 'expired session deleted');
  assert.ok(result.deletedOtps >= 1, 'expired OTP deleted');
  assert.ok(result.deletedResetTokens >= 1, 'expired reset token deleted');
  assert.ok(result.deletedPendingSignups >= 1, 'expired pending signup deleted');
  assert.ok(result.deletedLoginActivity >= 1, 'old login activity deleted');

  assert.ok(await getSessionUser(validToken), 'valid session must survive');
  const otpCount = (
    db.prepare('SELECT COUNT(*) AS n FROM emailOtps WHERE email = ?').get('valid-otp@test.dev') as { n: number }
  ).n;
  assert.equal(otpCount, 1, 'still-valid OTP must survive');
  const recentLogin = (
    db.prepare('SELECT COUNT(*) AS n FROM loginActivity WHERE userId = ?').get(U.a) as { n: number }
  ).n;
  assert.equal(recentLogin, 1, 'recent login activity must survive');
});

test('A2: auth cleanup is idempotent and safe to run repeatedly', async () => {
  const first = cleanupAuthData();
  const second = cleanupAuthData();
  assert.equal(second.total, 0, 'a second run deletes nothing more');
  assert.ok(first.total >= 0);
});

// ─── B. Upload file lifecycle (P1/B) ─────────────────────────────────────────

test('B: room deletion removes the uploaded media file from disk', async () => {
  const roomId = await createRoom(tokens.a, 'File Lifecycle');
  const filename = await uploadFile(roomId, tokens.a, 'lifecycle.mp4', uploadBytes(2048));
  const filePath = path.join(uploadsDir, filename);
  assert.ok(fs.existsSync(filePath), 'file exists after upload');

  await call(tokens.a, 'POST', `/api/rooms/${roomId}/leave`, {});
  db.prepare('UPDATE rooms SET emptySince = ? WHERE id = ?').run(
    new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    roomId
  );
  const deleted = cleanupEmptyRooms();
  assert.ok(deleted.includes(roomId), 'room cleaned up');

  assert.ok(!fs.existsSync(filePath), 'media file removed with the room');
  const record = db.prepare('SELECT filename FROM uploads WHERE filename = ?').get(filename);
  assert.equal(record, undefined, 'upload record cascaded away');
});

test('B2: orphan sweep deletes only old generated files without DB records', async () => {
  const now = Date.now();
  const oldTime = new Date(now - 2 * 3_600_000);
  const freshTime = new Date(now - 60_000);
  const mk = (name: string, mtime: Date, content: string) => {
    fs.writeFileSync(path.join(uploadsDir, name), content);
    fs.utimesSync(path.join(uploadsDir, name), mtime, mtime);
  };

  // Old orphan (no DB record) → deleted.
  mk(`media-${now - 7_200_000}-aaaaaaaa-bbbb.mp4`, oldTime, 'x');
  // Stale .part temp file → deleted.
  mk(`media-${now - 7_200_000}-cccccccc-dddd.webm.part`, oldTime, 'p');
  // Fresh file within the grace period → survives.
  mk(`media-${now - 60_000}-eeeeeeee-ffff.mp4`, freshTime, 'y');
  // Unrelated file → never touched.
  mk('notes.txt', oldTime, 'keep me');

  // Registered file (has a DB record) → survives even though old.
  const roomId = await createRoom(tokens.a, 'Registered File');
  const recorded = `media-${now - 7_200_000}-11111111-2222.mov`;
  mk(recorded, oldTime, 'z');
  db.prepare(
    `INSERT INTO uploads (filename, roomId, userId, size, mimeType, createdAt) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(recorded, roomId, U.a, 1, 'video/quicktime', new Date(now - 7_200_000).toISOString());

  const deleted = sweepOrphanUploads(now);
  assert.equal(deleted, 2, 'exactly the old orphan + stale .part are deleted');
  assert.ok(!fs.existsSync(path.join(uploadsDir, `media-${now - 7_200_000}-aaaaaaaa-bbbb.mp4`)), 'old orphan removed');
  assert.ok(!fs.existsSync(path.join(uploadsDir, `media-${now - 7_200_000}-cccccccc-dddd.webm.part`)), 'stale part removed');
  assert.ok(fs.existsSync(path.join(uploadsDir, `media-${now - 60_000}-eeeeeeee-ffff.mp4`)), 'fresh file survives grace');
  assert.ok(fs.existsSync(path.join(uploadsDir, 'notes.txt')), 'unrelated files are never touched');
  assert.ok(fs.existsSync(path.join(uploadsDir, recorded)), 'registered files survive');
});

test('B3: orphan sweep tolerates a missing uploads directory', async () => {
  const backup = path.join(os.tmpdir(), `praconnect-harden-moved-${process.pid}-${Date.now()}`);
  fs.renameSync(uploadsDir, backup);
  try {
    assert.equal(sweepOrphanUploads(), 0, 'missing directory is tolerated');
  } finally {
    fs.renameSync(backup, uploadsDir);
  }
});

// ─── C. Room event retention (P1/C) ──────────────────────────────────────────

test('C: event cleanup removes old events, keeps recent, replay still works', async () => {
  const roomId = await createRoom(tokens.a, 'Event Trim');
  const cursor = lastEventId(roomId);
  for (let i = 1; i <= 700; i++) emit(roomId, 'room:update', { room: { seq: i } });
  const maxId = lastEventId(roomId);

  const result = cleanupRoomEvents(Date.now(), { maxPerRoom: 501, retentionMs: 0 });
  assert.ok(result.deleted > 0, 'old events were removed');

  const remaining = (
    db.prepare('SELECT COUNT(*) AS n FROM roomEvents WHERE roomId = ?').get(roomId) as { n: number }
  ).n;
  assert.ok(remaining <= 501, `at most 501 events remain (got ${remaining})`);
  assert.equal(lastEventId(roomId), maxId, 'the newest event survives');

  const recent = replayEventsWithMeta(roomId, maxId - 5);
  assert.equal(recent.events.length, 5, 'recent events still replay');

  const fromCursor = replayEventsWithMeta(roomId, cursor);
  assert.equal(fromCursor.truncated, true, 'a cursor older than the window truncates');
  assert.ok(fromCursor.events.length > 0 && fromCursor.events[0].id > cursor, 'only events after the cursor replay');
});

test('C2: age-based retention removes stale events but preserves the replay window', async () => {
  const roomId = await createRoom(tokens.a, 'Age Trim');
  const firstId = lastEventId(roomId);
  for (let i = 1; i <= 700; i++) emit(roomId, 'room:update', { room: { seq: i } });
  const maxId = lastEventId(roomId);

  // Age the oldest 101 events (701 total − 600 protected = 101 eligible).
  const stale = firstId + 100;
  db.prepare('UPDATE roomEvents SET createdAt = ? WHERE roomId = ? AND id <= ?').run(
    new Date(Date.now() - 2 * 86_400_000).toISOString(),
    roomId,
    stale
  );

  const result = cleanupRoomEvents(Date.now(), { maxPerRoom: 100000, retentionMs: 86_400_000 });
  assert.ok(result.deleted >= 100, 'stale events removed by age');

  assert.equal(lastEventId(roomId), maxId, 'newest event survives');
  const remaining = (
    db.prepare('SELECT COUNT(*) AS n FROM roomEvents WHERE roomId = ?').get(roomId) as { n: number }
  ).n;
  assert.equal(remaining, 600, 'the protected replay window survives');
  const recent = replayEventsWithMeta(roomId, maxId - 10);
  assert.equal(recent.events.length, 10, 'recent events still replay');
});

test('C3: after cleanup, Last-Event-ID replay still works and room:resync fires when the cursor falls outside the window', async () => {
  const roomId = await createRoom(tokens.a, 'Resync After Trim');
  const cursor = lastEventId(roomId);
  for (let i = 1; i <= 700; i++) emit(roomId, 'room:update', { room: { seq: i } });
  cleanupRoomEvents(Date.now(), { maxPerRoom: 501, retentionMs: 0 });

  const res = await call(tokens.a, 'GET', `/api/rooms/${roomId}/events`, undefined, {
    'last-event-id': String(cursor),
  });
  assert.equal(res.status, 200);
  const reader = res.body!.getReader();
  const got = await collect(reader, (t) => idsIn(t).length >= REPLAY_WINDOW);
  await reader.cancel();

  assert.match(got, /event: room:resync/, 'cursor outside the retained window triggers resync');
  assert.ok(got.indexOf('event: room:resync') < got.indexOf('id: '), 'resync precedes replay');
  const ids = idsIn(got);
  assert.equal(ids.length, REPLAY_WINDOW, 'the 500-event replay window is intact after cleanup');
  assert.ok(ids.every((id) => id > cursor), 'deleted events never replay');
});

test('C4: chat rate limiting is enforced only after membership authorization', async () => {
  const roomId = await createRoom(tokens.a, 'Chat Gate');

  // A non-member floods chat: every attempt is 403 — the guard runs before
  // the limiter, so the attacker cannot consume anyone's chat quota.
  for (let i = 0; i < 5; i++) {
    const res = await call(tokens.c, 'POST', `/api/rooms/${roomId}/chat`, { text: `intruder ${i}` });
    assert.equal(res.status, 403, `non-member attempt ${i + 1} must be 403, not 429`);
    assert.equal(((await json(res)).error as { code: string }).code, 'ROOM_MEMBERSHIP_REQUIRED');
  }

  const hostOk = await call(tokens.a, 'POST', `/api/rooms/${roomId}/chat`, { text: 'hello squad' });
  assert.equal(hostOk.status, 201, 'the host bucket was never polluted');

  // A member hits the limiter after the guard passes.
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});
  for (let i = 0; i < 3; i++) {
    const res = await call(tokens.b, 'POST', `/api/rooms/${roomId}/chat`, { text: `m${i}` });
    assert.equal(res.status, 201);
  }
  const blocked = await call(tokens.b, 'POST', `/api/rooms/${roomId}/chat`, { text: 'spam' });
  assert.equal(blocked.status, 429, 'chat rate limit remains enforced');
});

// ─── D. Room participant cap (P1/D) ──────────────────────────────────────────

test('D: maxParticipants above the server cap is clamped; lower limits preserved', async () => {
  const res = await call(tokens.a, 'POST', '/api/rooms', { name: 'Big Room', maxParticipants: 100 });
  assert.equal(res.status, 201);
  const room = (await json(res)).room as { maxParticipants: number };
  assert.equal(room.maxParticipants, MAX_ROOM_PARTICIPANTS, 'client value above the cap is clamped');

  const small = await call(tokens.a, 'POST', '/api/rooms', { name: 'Small Room', maxParticipants: 4 });
  const smallRoom = (await json(small)).room as { maxParticipants: number };
  assert.equal(smallRoom.maxParticipants, 4, 'lower requested limits are preserved');
});

test('D2: a room at the capped participant limit rejects joins with ROOM_FULL', async () => {
  const roomId = await createRoom(tokens.a, 'Cap Room', { maxParticipants: MAX_ROOM_PARTICIPANTS });
  for (const key of 'bcdefghijkl') {
    const res = await call(tokens[key], 'POST', `/api/rooms/${roomId}/join`, {});
    assert.equal(res.status, 200, `${key} joins`);
  }
  const detail = (await json(await call(tokens.a, 'GET', `/api/rooms/${roomId}`))).room as { memberCount: number };
  assert.equal(detail.memberCount, MAX_ROOM_PARTICIPANTS, 'room is full at the cap');

  const full = await call(tokens.m, 'POST', `/api/rooms/${roomId}/join`, {});
  assert.equal(full.status, 409);
  assert.equal(((await json(full)).error as { code: string }).code, 'ROOM_FULL');
});

// ─── E. Transactional room cleanup (P2/E) ────────────────────────────────────

test('E: room cleanup is atomic — no partial state survives, files are removed', async () => {
  const roomId = await createRoom(tokens.a, 'Tx Room');
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});
  await call(tokens.a, 'POST', `/api/rooms/${roomId}/media`, {
    title: 'S',
    url: 'https://example.com/s.mp4',
  });
  const filename = await uploadFile(roomId, tokens.a, 'tx.mp4', uploadBytes(1024));
  const filePath = path.join(uploadsDir, filename);

  await call(tokens.a, 'POST', `/api/rooms/${roomId}/leave`, {});
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/leave`, {});
  db.prepare('UPDATE rooms SET emptySince = ? WHERE id = ?').run(
    new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    roomId
  );

  const deleted = cleanupEmptyRooms();
  assert.ok(deleted.includes(roomId));

  // Room + every dependent row are gone together (nothing partial remains).
  assert.equal(db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId), undefined, 'room row gone');
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM roomMembers WHERE roomId = ?').get(roomId) as { n: number }).n,
    0,
    'member rows gone'
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM roomEvents WHERE roomId = ?').get(roomId) as { n: number }).n,
    0,
    'event rows gone'
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM uploads WHERE roomId = ?').get(roomId) as { n: number }).n,
    0,
    'upload records cascaded away'
  );
  assert.ok(!fs.existsSync(filePath), 'media file removed from disk');

  // A join after cleanup can never observe a partially-deleted room.
  const join = await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});
  assert.equal(join.status, 404);
  assert.equal(((await json(join)).error as { code: string }).code, 'ROOM_NOT_FOUND');
});

// ─── F. Poster URL validation (P2/F) ─────────────────────────────────────────

test('F: poster URLs are validated server-side', async () => {
  const roomId = await createRoom(tokens.a, 'Poster Room');
  const rejected = [
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'blob:http://localhost:3000/1234-5678',
    'file:///etc/passwd',
    '//evil.example.com/x.png',
    'ftp://example.com/x.png',
  ];
  for (const poster of rejected) {
    const res = await call(tokens.a, 'POST', `/api/rooms/${roomId}/media`, {
      title: 'T',
      url: 'https://example.com/v.mp4',
      poster,
    });
    assert.equal(res.status, 400, `${poster} must be rejected`);
    assert.equal(((await json(res)).error as { code: string }).code, 'VALIDATION_ERROR');
  }

  const accepted = [
    'https://images.example.com/p.png',
    'http://images.example.com/p.png',
    '/api/uploads/media-1-aaaaaaaa-bbbb.mp4',
  ];
  for (const poster of accepted) {
    const res = await call(tokens.a, 'POST', `/api/rooms/${roomId}/media`, {
      title: 'T',
      url: 'https://example.com/v.mp4',
      poster,
    });
    assert.equal(res.status, 200, `${poster} must be accepted`);
  }
});

// ─── G. Logout all devices (P2/G) ────────────────────────────────────────────
// Kept last: it invalidates the shared before() session tokens on purpose.

test('G: logout-all invalidates every session including the current one', async () => {
  const token1 = await createSession(U.m);
  const token2 = await createSession(U.m);
  const res = await call(token1, 'POST', '/api/auth/logout-all', {});
  assert.equal(res.status, 200);
  assert.equal(await getSessionUser(token1), null, 'current session invalidated');
  assert.equal(await getSessionUser(token2), null, 'all other sessions invalidated');
  const setCookie = res.headers.get('set-cookie') ?? '';
  assert.match(setCookie, new RegExp(`${SESSION_COOKIE_NAME}=;`), 'session cookie cleared');
});

test('G2: logout-all only affects the calling user', async () => {
  const otherToken = await createSession(U.m); // m has no sessions left after G
  const mine = await createSession(U.a);
  const res = await call(mine, 'POST', '/api/auth/logout-all', {});
  assert.equal(res.status, 200);
  assert.ok(await getSessionUser(otherToken), 'other users sessions are unaffected');
  assert.equal(await getSessionUser(mine), null, 'my session is gone');
});

test('G3: logout-all requires authentication', async () => {
  const res = await call(null, 'POST', '/api/auth/logout-all', {});
  assert.equal(res.status, 401);
  assert.equal(((await json(res)).error as { code: string }).code, 'UNAUTHENTICATED');
});
