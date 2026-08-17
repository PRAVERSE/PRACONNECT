// server/tests/history.test.ts
// Phase 6.11: persistent room history & user statistics. Verifies that the
// 5-minute active-room cleanup never erases hosted/joined/watch statistics
// because durable roomHistory / roomHistoryMembers records are maintained at
// every lifecycle event and are excluded from the cleanup sweep.
//
// Run: npx tsx --test server/tests/history.test.ts

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(os.tmpdir(), `praconnect-history-test-${process.pid}-${Date.now()}.db`);
process.env.ROOM_EMPTY_TTL_MS = '60000';
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `praconnect-history-uploads-${process.pid}-${Date.now()}`);

const { db } = await import('../db/index');
const { rooms } = await import('../routes/rooms');
const { profile } = await import('../routes/profile');
const { createSession, SESSION_COOKIE_NAME } = await import('../auth/session');
const { cleanupEmptyRooms } = await import('../rooms/service');

const app = new Hono();
app.route('/api/rooms', rooms);
app.route('/api/profile', profile);

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
  body?: unknown
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers['cookie'] = cookie(token);
  if (body !== undefined) headers['content-type'] = 'application/json';
  return app.request(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>;
}

async function createRoomAs(token: string, name: string, opts: Record<string, unknown> = {}): Promise<string> {
  const res = await call(token, 'POST', '/api/rooms', { name, category: 'Movie', privacy: 'public', maxParticipants: 8, ...opts });
  assert.equal(res.status, 201, `create room ${name}`);
  return ((await json(res)).room as { id: string }).id;
}

function historyRows(roomId: string): number {
  return (
    db.prepare('SELECT COUNT(*) AS n FROM roomHistory WHERE roomId = ?').get(roomId) as { n: number }
  ).n;
}

function historyMemberRows(roomId: string, userId?: string): number {
  if (userId) {
    return (
      db
        .prepare('SELECT COUNT(*) AS n FROM roomHistoryMembers WHERE roomId = ? AND userId = ?')
        .get(roomId, userId) as { n: number }
    ).n;
  }
  return (
    db.prepare('SELECT COUNT(*) AS n FROM roomHistoryMembers WHERE roomId = ?').get(roomId) as { n: number }
  ).n;
}

function participationDuration(roomId: string, userId: string): number {
  const row = db
    .prepare('SELECT durationSeconds FROM roomHistoryMembers WHERE roomId = ? AND userId = ?')
    .get(roomId, userId) as { durationSeconds: number } | undefined;
  return row?.durationSeconds ?? -1;
}

function historyEndedAt(roomId: string): string | null {
  const row = db.prepare('SELECT endedAt FROM roomHistory WHERE roomId = ?').get(roomId) as
    | { endedAt: string | null }
    | undefined;
  return row?.endedAt ?? null;
}

async function statsFor(token: string): Promise<{
  hostedRooms: number;
  joinedRooms: number;
  totalWatchSeconds: number;
  recentRooms: { roomId: string; role: string; durationSeconds: number; endedAt: string | null }[];
}> {
  const res = await call(token, 'GET', '/api/profile/stats');
  assert.equal(res.status, 200, 'stats endpoint must be accessible');
  const body = (await json(res)).stats as {
    hostedRooms: number;
    joinedRooms: number;
    totalWatchSeconds: number;
    recentRooms: { roomId: string; role: string; durationSeconds: number; endedAt: string | null }[];
  };
  return body;
}

/** Force a room to look like it has been empty for longer than the TTL. */
function expireRoom(roomId: string): void {
  db.prepare('UPDATE rooms SET emptySince = ? WHERE id = ?').run(
    new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    roomId
  );
}

const U = { a: 'user-a', b: 'user-b', c: 'user-c', d: 'user-d' };
let tokens: Record<string, string> = {};

before(async () => {
  for (const [key, id] of Object.entries(U)) {
    seedUser(id, `User ${key.toUpperCase()}`, `user${key}`, `${key}@hist.test`);
  }
  for (const [key, id] of Object.entries(U)) {
    tokens[key] = await login(id);
  }
});

after(() => {
  db.close();
  fs.rmSync(process.env.UPLOADS_DIR!, { recursive: true, force: true });
});

// ─── A. Room creation records history ────────────────────────────────────────

test('A: host creates a room → a durable historical record exists immediately', async () => {
  const roomId = await createRoomAs(tokens.a, 'History Room A');
  assert.equal(historyRows(roomId), 1, 'roomHistory row created at creation time');
  assert.equal(historyMemberRows(roomId, U.a), 1, 'host participation recorded at creation');

  const stats = await statsFor(tokens.a);
  assert.equal(stats.hostedRooms, 1, 'hosted count includes the new room before any cleanup');
  const entry = stats.recentRooms.find((r) => r.roomId === roomId);
  assert.ok(entry, 'room appears in recent rooms');
  assert.equal(entry.role, 'host');
});

// ─── B. Second user joining creates participation ────────────────────────────

test('B: a second user joining creates historical participation', async () => {
  const roomId = await createRoomAs(tokens.a, 'History Room B');
  const res = await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});
  assert.equal(res.status, 200);
  assert.equal(historyMemberRows(roomId, U.b), 1, 'joiner has one participation row');

  const stats = await statsFor(tokens.b);
  assert.equal(stats.joinedRooms, 1);
  assert.equal(stats.recentRooms.find((r) => r.roomId === roomId)?.role, 'member');
});

// ─── C. Member leave closes the interval ─────────────────────────────────────

test('C: member leaves → leftAt and durationSeconds are recorded', async () => {
  const roomId = await createRoomAs(tokens.a, 'History Room C');
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});

  // Backdate the join so the duration is deterministic.
  const backdated = new Date(Date.now() - 2700_000).toISOString();
  db.prepare('UPDATE roomHistoryMembers SET joinedAt = ? WHERE roomId = ? AND userId = ?').run(
    backdated,
    roomId,
    U.b
  );

  const res = await call(tokens.b, 'POST', `/api/rooms/${roomId}/leave`, {});
  assert.equal(res.status, 200);

  const row = db
    .prepare('SELECT leftAt, durationSeconds FROM roomHistoryMembers WHERE roomId = ? AND userId = ?')
    .get(roomId, U.b) as { leftAt: string | null; durationSeconds: number } | undefined;
  assert.ok(row, 'participation row still exists after leave');
  assert.ok(row.leftAt, 'leftAt recorded on leave');
  assert.ok(row.durationSeconds >= 2690 && row.durationSeconds <= 2700, `duration ≈ 2700s, got ${row.durationSeconds}`);
});

// ─── D. Host leave finalizes host participation ──────────────────────────────

test('D: host leaves → host participation is finalized with leftAt/duration', async () => {
  const roomId = await createRoomAs(tokens.a, 'History Room D');
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/leave`, {});

  const res = await call(tokens.a, 'POST', `/api/rooms/${roomId}/leave`, {});
  assert.equal(res.status, 200);

  const hostRow = db
    .prepare('SELECT leftAt, durationSeconds FROM roomHistoryMembers WHERE roomId = ? AND userId = ?')
    .get(roomId, U.a) as { leftAt: string | null; durationSeconds: number } | undefined;
  assert.ok(hostRow, 'host participation row exists');
  assert.ok(hostRow.leftAt, 'host participation finalized');
});

// ─── E. Room becomes empty → history still exists ────────────────────────────

test('E: room becomes empty → history row remains (history is not deleted on empty)', async () => {
  const roomId = await createRoomAs(tokens.a, 'History Room E');
  await call(tokens.a, 'POST', `/api/rooms/${roomId}/leave`, {});
  assert.equal(historyRows(roomId), 1, 'history survives the room becoming empty');
  assert.ok(historyEndedAt(roomId), 'endedAt is set at the moment the room became empty');
});

// ─── F + G + H + I + J + Q: cleanup deletes active state but never history ──

test('F/G/H/I/J/Q: 5-minute cleanup deletes the active room but history and stats survive', async () => {
  const roomId = await createRoomAs(tokens.a, 'History Room FGHIJQ');
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});
  await call(tokens.a, 'POST', `/api/rooms/${roomId}/leave`, {});
  // The room becomes empty at THIS moment (last member leaves). The
  // backdating below only simulates TTL expiry — it must not move endedAt.
  const becameEmptyAt = new Date().toISOString();
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/leave`, {});
  expireRoom(roomId);

  assert.ok(historyRows(roomId) === 1, 'history row exists before cleanup');

  const watchBefore = (await statsFor(tokens.b)).totalWatchSeconds;
  const deleted = cleanupEmptyRooms();
  assert.ok(deleted.includes(roomId), 'F: active room is deleted after the TTL');

  // F: active state gone.
  assert.equal(db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId), undefined, 'F: rooms row deleted');
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM roomMembers WHERE roomId = ?').get(roomId) as { n: number }).n,
    0,
    'F: active member rows deleted'
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM roomEvents WHERE roomId = ?').get(roomId) as { n: number }).n,
    0,
    'F: active event rows deleted'
  );

  // G: history rows survive.
  assert.equal(historyRows(roomId), 1, 'G: roomHistory survives cleanup');
  assert.equal(historyMemberRows(roomId), 2, 'G: roomHistoryMembers survive cleanup');
  const endedAt = historyEndedAt(roomId);
  assert.ok(endedAt, 'G: endedAt is set');
  const endedGap = Math.abs(Date.parse(endedAt!) - Date.parse(becameEmptyAt));
  assert.ok(endedGap < 5000, `G: endedAt = moment room became empty (gap ${endedGap}ms)`);

  // H: hosted count remains correct after cleanup.
  const hostStats = await statsFor(tokens.a);
  assert.equal(hostStats.hostedRooms, 6, 'H: hosted count is unchanged by cleanup');

  // I: joined count remains correct after cleanup.
  const joinStats = await statsFor(tokens.b);
  assert.equal(joinStats.joinedRooms, 4, 'I: joined count is unchanged by cleanup');

  // J: watch duration remains correct after cleanup (unchanged by the sweep).
  const watchAfter = (await statsFor(tokens.b)).totalWatchSeconds;
  assert.equal(watchAfter, watchBefore, 'J: watch duration persists across cleanup');
  const bEntry = (await statsFor(tokens.b)).recentRooms.find((r) => r.roomId === roomId);
  assert.equal(bEntry?.durationSeconds, participationDuration(roomId, U.b), 'J: per-room duration intact');

  // Q: cleanup never deleted the durable statistics themselves.
  assert.ok(
    (db.prepare('SELECT COUNT(*) AS n FROM roomHistory').get() as { n: number }).n > 0,
    'Q: roomHistory table still populated after cleanup'
  );
});

// ─── K. Reconnect/duplicate join does not duplicate participation ────────────

test('K: reconnect/duplicate join does not create duplicate historical participation', async () => {
  const roomId = await createRoomAs(tokens.a, 'History Room K');
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});

  // SSE reconnect / refresh: joinRoom returns the current state without
  // creating anything new.
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});
  assert.equal(historyMemberRows(roomId, U.b), 1, 'repeated joins produce exactly one participation row');

  const stats = await statsFor(tokens.b);
  assert.equal(stats.joinedRooms, 5, 'joined count still counts the room once');
});

// ─── L. Leave → rejoin accumulates duration on the same row ─────────────────

test('L: leave/rejoin accumulates duration on one participation row', async () => {
  const roomId = await createRoomAs(tokens.a, 'History Room L');
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});

  // Interval 1: 0..600s.
  const t1 = new Date(Date.now() - 600_000).toISOString();
  db.prepare('UPDATE roomHistoryMembers SET joinedAt = ? WHERE roomId = ? AND userId = ?').run(t1, roomId, U.b);
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/leave`, {});
  const d1 = participationDuration(roomId, U.b);
  assert.ok(d1 >= 590 && d1 <= 600, `first interval ≈ 600s, got ${d1}`);

  // Interval 2: rejoin for another 300s.
  const t2 = new Date(Date.now() - 300_000).toISOString();
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});
  db.prepare('UPDATE roomHistoryMembers SET joinedAt = ? WHERE roomId = ? AND userId = ?').run(t2, roomId, U.b);
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/leave`, {});

  assert.equal(historyMemberRows(roomId, U.b), 1, 'rejoin reuses the same participation row');
  const d2 = participationDuration(roomId, U.b);
  assert.ok(d2 >= 880 && d2 <= 910, `accumulated duration ≈ 900s, got ${d2}`);

  const stats = await statsFor(tokens.b);
  assert.equal(stats.joinedRooms, 6, 'rejoin does not double-count the room');
});

// ─── M. Multiple rooms produce correct cumulative statistics ────────────────

test('M: multiple rooms produce correct cumulative statistics after cleanup', async () => {
  // A hosts 3 more rooms; B joins all 3; every room expires and is cleaned up.
  for (let i = 0; i < 3; i++) {
    const id = await createRoomAs(tokens.a, `Cumulative ${i}`);
    await call(tokens.b, 'POST', `/api/rooms/${id}/join`, {});
    await call(tokens.a, 'POST', `/api/rooms/${id}/leave`, {});
    await call(tokens.b, 'POST', `/api/rooms/${id}/leave`, {});
    expireRoom(id);
  }
  cleanupEmptyRooms();

  // A hosted: A,B,C,D,E,FGHIJQ,K,L (8) + 3 cumulative = 11.
  const aStats = await statsFor(tokens.a);
  assert.equal(aStats.hostedRooms, 11, 'M: host cumulative count survives cleanup');
  assert.equal(aStats.joinedRooms, 11, 'M: host is also counted as participant of own rooms');

  // B joined: B,C,D,FGHIJQ,K,L (6) + 3 cumulative = 9.
  const bStats = await statsFor(tokens.b);
  assert.equal(bStats.joinedRooms, 9, 'M: joiner cumulative count survives cleanup');
});

// ─── N. A user cannot read another user's history ───────────────────────────

test('N: one user cannot read another user\'s room history', async () => {
  // C has never been in any room.
  const cStats = await statsFor(tokens.c);
  assert.equal(cStats.hostedRooms, 0, 'C sees no rooms hosted by others');
  assert.equal(cStats.joinedRooms, 0, 'C sees no rooms participated in by others');
  assert.equal(cStats.recentRooms.length, 0, 'C receives no history entries of other users');

  // B's recent rooms contain only rooms B actually participated in.
  const bStats = await statsFor(tokens.b);
  const allParticipated = bStats.recentRooms.every((r) => historyMemberRows(r.roomId, U.b) === 1);
  assert.ok(allParticipated, 'every entry in B\'s history is a room B participated in');
});

// ─── O. Historical rooms are never shown as active/joinable ─────────────────

test('O: historical room is not shown as an active or joinable room after cleanup', async () => {
  const roomId = await createRoomAs(tokens.a, 'Expired History Room O');
  await call(tokens.a, 'POST', `/api/rooms/${roomId}/leave`, {});
  expireRoom(roomId);
  cleanupEmptyRooms();

  const list = (await json(await call(tokens.a, 'GET', '/api/rooms'))).rooms as { id: string }[];
  assert.ok(!list.some((r) => r.id === roomId), 'O: expired room is absent from the active room list');

  const detail = await call(tokens.a, 'GET', `/api/rooms/${roomId}`);
  assert.equal(detail.status, 404, 'O: expired room is not joinable/fetchable as an active room');

  // But the history record still exists and is returned in profile stats.
  assert.equal(historyRows(roomId), 1, 'O: history record still exists');
  const stats = await statsFor(tokens.a);
  assert.ok(stats.recentRooms.some((r) => r.roomId === roomId), 'O: history entry remains in profile stats');
});

// ─── P. Empty-room grace period does not inflate watch duration ─────────────

test('P: 5-minute empty-room grace period does not inflate watch duration', async () => {
  const roomId = await createRoomAs(tokens.a, 'Grace Room P');
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});

  // B watches 10:00 → 10:45 (2700s), then leaves — duration must be ~2700s,
  // never 2700 + the 300s empty grace period.
  db.prepare('UPDATE roomHistoryMembers SET joinedAt = ? WHERE roomId = ? AND userId = ?').run(
    new Date(Date.now() - 2700_000).toISOString(),
    roomId,
    U.b
  );
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/leave`, {});

  // Host leaves too → the room is empty. Then wait out the TTL + cleanup.
  await call(tokens.a, 'POST', `/api/rooms/${roomId}/leave`, {});
  expireRoom(roomId);
  cleanupEmptyRooms();

  const bStats = await statsFor(tokens.b);
  const bEntry = bStats.recentRooms.find((r) => r.roomId === roomId);
  assert.ok(bEntry, 'P: participation entry exists after cleanup');
  assert.ok(
    bEntry.durationSeconds >= 2690 && bEntry.durationSeconds < 3000,
    `P: watch time ≈ 2700s (not inflated by the grace period), got ${bEntry.durationSeconds}`
  );
});

// ─── Extra: history survives host transfer ───────────────────────────────────

test('host transfer keeps the original creator as the historical host', async () => {
  const roomId = await createRoomAs(tokens.a, 'Transfer History');
  await call(tokens.b, 'POST', `/api/rooms/${roomId}/join`, {});
  await call(tokens.a, 'POST', `/api/rooms/${roomId}/leave`, {}); // host transfers to b

  const row = db.prepare('SELECT hostUserId FROM roomHistory WHERE roomId = ?').get(roomId) as {
    hostUserId: string;
  };
  assert.equal(row.hostUserId, U.a, 'history host is the original creator');

  const statsB = await statsFor(tokens.b);
  assert.equal(statsB.hostedRooms, 0, 'B does not count a transferred room as hosted');
});