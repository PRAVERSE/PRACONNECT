// server/tests/room-media-performance.test.ts
// Performance & regression tests for PraConnect Room Media Library playback.
//
// Verifies:
//   1. HTTP Range streaming (206, Accept-Ranges, Content-Range, Content-Length)
//   2. High-offset seek without whole-file buffering
//   3. Invalid Range headers (416)
//   4. HEAD requests for probe sizing
//   5. Cache-Control headers for browser media buffer efficiency
//   6. Room media selection error responses (MEDIA_NOT_FOUND, MEDIA_NOT_READY, MEDIA_UNAVAILABLE)
//   7. Static client source verification (no blob downloads, direct streaming)

import os from 'node:os';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';

const TMP_ROOT = path.join(os.tmpdir(), `praconnect-perf-${process.pid}-${Date.now()}`);
fs.mkdirSync(TMP_ROOT, { recursive: true });

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(TMP_ROOT, 'test.db');
process.env.MEDIA_STORAGE_DIR = path.join(TMP_ROOT, 'storage');
process.env.ROOM_EMPTY_TTL_MS = '60000';

const { db, closeDatabase } = await import('../db/index');
const { generateId } = await import('../auth/auth');
const { createSession } = await import('../auth/session');
const { media } = await import('../routes/media');
const { rooms } = await import('../routes/rooms');
const { LocalDiskStorage, setMediaStorageForTesting } = await import('../storage/mediaStorage');
const { createRoom, joinRoom } = await import('../rooms/service');

// ─── Setup isolated test environment ──────────────────────────────────────────

const TEST_DIR = path.join(TMP_ROOT, 'storage');
fs.mkdirSync(TEST_DIR, { recursive: true });

const storage = new LocalDiskStorage(TEST_DIR);
setMediaStorageForTesting(storage);

after(() => {
  try {
    closeDatabase?.();
  } catch {}
  try {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch {}
});

const app = new Hono();
app.route('/api/media', media);
app.route('/api/rooms', rooms);

async function call(
  token: string,
  method: string,
  url: string,
  opts?: { body?: unknown; headers?: Record<string, string> }
): Promise<Response> {
  const headers = new Headers(opts?.headers ?? {});
  headers.set('Cookie', `praconnect-session=${token}`);
  let body: string | undefined;
  if (opts?.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(opts.body);
  }
  return app.request(`http://localhost${url}`, { method, headers, body });
}

// Seed admin and user
const adminUser = {
  id: generateId(),
  name: 'Admin Tester',
  username: `admin_perf_${Date.now()}`,
  email: `admin-perf-${Date.now()}@example.com`,
  role: 'admin',
  passwordHash: 'hash',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
db.prepare(
  `INSERT INTO users (id, name, username, email, role, passwordHash, createdAt, updatedAt)
   VALUES (@id, @name, @username, @email, @role, @passwordHash, @createdAt, @updatedAt)`
).run(adminUser);

const normalUser = {
  id: generateId(),
  name: 'Normal Member',
  username: `member_perf_${Date.now()}`,
  email: `member-perf-${Date.now()}@example.com`,
  role: 'user',
  passwordHash: 'hash',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
db.prepare(
  `INSERT INTO users (id, name, username, email, role, passwordHash, createdAt, updatedAt)
   VALUES (@id, @name, @username, @email, @role, @passwordHash, @createdAt, @updatedAt)`
).run(normalUser);

const adminToken = await createSession(adminUser.id);
const userToken = await createSession(normalUser.id);

// ─── Tests ───────────────────────────────────────────────────────────────────

test('1. HTTP Range Streaming on Ready Library Media returns 206 and partial slice', async () => {
  const mediaId = generateId();
  const playableKey = `playable-${mediaId}.mp4`;
  const fileSize = 10 * 1024 * 1024; // 10 MB simulated file
  const fullPath = path.join(TEST_DIR, playableKey);

  // Write a sparse/sized file
  const fd = fs.openSync(fullPath, 'w');
  fs.writeSync(fd, Buffer.from('MP4HEADER-START'), 0, 15, 0);
  fs.writeSync(fd, Buffer.from('MP4SEEK-MID'), 0, 11, 5 * 1024 * 1024);
  fs.writeSync(fd, Buffer.from('MP4TRAILER-END'), 0, 14, fileSize - 14);
  fs.closeSync(fd);

  db.prepare(
    `INSERT INTO media (id, title, description, mimeType, sizeBytes, storageKey, playableKey, downloadAllowed, published, status, createdByUserId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    mediaId,
    'Fast Start Video',
    'Description',
    'video/mp4',
    fileSize,
    null,
    playableKey,
    1,
    1,
    'ready',
    adminUser.id,
    new Date().toISOString(),
    new Date().toISOString()
  );

  // Range 0-1048575 (first 1 MB)
  const rangeRes = await call(userToken, 'GET', `/api/media/${mediaId}/download`, {
    headers: { Range: 'bytes=0-1048575' },
  });

  assert.equal(rangeRes.status, 206, 'Must return 206 Partial Content');
  assert.equal(rangeRes.headers.get('accept-ranges'), 'bytes');
  assert.equal(rangeRes.headers.get('content-range'), `bytes 0-1048575/${fileSize}`);
  assert.equal(rangeRes.headers.get('content-length'), '1048576');
  assert.equal(rangeRes.headers.get('content-type'), 'video/mp4');
  assert.equal(rangeRes.headers.get('cache-control'), 'private, max-age=86400');

  const buf = Buffer.from(await rangeRes.arrayBuffer());
  assert.equal(buf.length, 1048576);
  assert.ok(buf.toString('utf8', 0, 15).startsWith('MP4HEADER-START'));
});

test('2. Seeking at high offset returns 206 without buffering whole file', async () => {
  const mediaId = generateId();
  const playableKey = `playable-${mediaId}.mp4`;
  const fileSize = 1000 * 1024 * 1024; // 1 GB simulated file size
  const fullPath = path.join(TEST_DIR, playableKey);

  const fd = fs.openSync(fullPath, 'w');
  fs.writeSync(fd, Buffer.from('SEEK-TARGET-DATA'), 0, 16, 500 * 1024 * 1024);
  fs.writeSync(fd, Buffer.from('E'), 0, 1, fileSize - 1);
  fs.closeSync(fd);

  db.prepare(
    `INSERT INTO media (id, title, description, mimeType, sizeBytes, storageKey, playableKey, downloadAllowed, published, status, createdByUserId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    mediaId,
    '1GB Movie',
    'Description',
    'video/mp4',
    fileSize,
    null,
    playableKey,
    1,
    1,
    'ready',
    adminUser.id,
    new Date().toISOString(),
    new Date().toISOString()
  );

  const start = 500 * 1024 * 1024;
  const end = start + 1024 * 1024 - 1; // 1 MB chunk at 500MB
  const seekRes = await call(userToken, 'GET', `/api/media/${mediaId}/download`, {
    headers: { Range: `bytes=${start}-${end}` },
  });

  assert.equal(seekRes.status, 206);
  assert.equal(seekRes.headers.get('content-range'), `bytes ${start}-${end}/${fileSize}`);
  assert.equal(seekRes.headers.get('content-length'), '1048576');

  const buf = Buffer.from(await seekRes.arrayBuffer());
  assert.equal(buf.length, 1048576);
  assert.ok(buf.toString('utf8', 0, 16).startsWith('SEEK-TARGET-DATA'));
});

test('3. Invalid Range headers return 416 Range Not Satisfiable', async () => {
  const mediaId = generateId();
  const playableKey = `playable-${mediaId}.mp4`;
  const fileSize = 1000;
  const fullPath = path.join(TEST_DIR, playableKey);
  fs.writeFileSync(fullPath, Buffer.alloc(fileSize));

  db.prepare(
    `INSERT INTO media (id, title, description, mimeType, sizeBytes, storageKey, playableKey, downloadAllowed, published, status, createdByUserId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    mediaId,
    'Small Clip',
    'Description',
    'video/mp4',
    fileSize,
    null,
    playableKey,
    1,
    1,
    'ready',
    adminUser.id,
    new Date().toISOString(),
    new Date().toISOString()
  );

  const res = await call(userToken, 'GET', `/api/media/${mediaId}/download`, {
    headers: { Range: 'bytes=5000-6000' },
  });
  assert.equal(res.status, 416);
  assert.equal(res.headers.get('content-range'), `bytes */${fileSize}`);
});

test('4. HEAD requests respond with headers only', async () => {
  const mediaId = generateId();
  const playableKey = `playable-${mediaId}.mp4`;
  const fileSize = 5000;
  const fullPath = path.join(TEST_DIR, playableKey);
  fs.writeFileSync(fullPath, Buffer.alloc(fileSize));

  db.prepare(
    `INSERT INTO media (id, title, description, mimeType, sizeBytes, storageKey, playableKey, downloadAllowed, published, status, createdByUserId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    mediaId,
    'Head Clip',
    'Description',
    'video/mp4',
    fileSize,
    null,
    playableKey,
    1,
    1,
    'ready',
    adminUser.id,
    new Date().toISOString(),
    new Date().toISOString()
  );

  const headFull = await call(userToken, 'HEAD', `/api/media/${mediaId}/download`);
  assert.equal(headFull.status, 200);
  assert.equal(headFull.headers.get('content-length'), '5000');
  assert.equal(headFull.headers.get('accept-ranges'), 'bytes');

  const headRange = await call(userToken, 'HEAD', `/api/media/${mediaId}/download`, {
    headers: { Range: 'bytes=0-99' },
  });
  assert.equal(headRange.status, 206);
  assert.equal(headRange.headers.get('content-range'), `bytes 0-99/${fileSize}`);
  assert.equal(headRange.headers.get('content-length'), '100');
});

test('5. Room media selection validates media ready/published/storage status', async () => {
  const room = createRoom(adminUser.id, {
    name: 'Performance Test Room',
    category: 'Movie',
    privacy: 'public',
    maxParticipants: 10,
  });
  const roomId = room.id;
  joinRoom(roomId, normalUser.id);

  // 1. Non-existent media -> MEDIA_NOT_FOUND (404)
  const notFound = await call(adminToken, 'POST', `/api/rooms/${roomId}/media/library`, {
    body: { mediaId: 'non-existent-id' },
  });
  assert.equal(notFound.status, 404);
  const notFoundJson = (await notFound.json()) as any;
  assert.equal(notFoundJson.error.code, 'MEDIA_NOT_FOUND');

  // 2. Draft/processing media -> MEDIA_NOT_READY (404)
  const draftId = generateId();
  db.prepare(
    `INSERT INTO media (id, title, description, mimeType, sizeBytes, storageKey, playableKey, downloadAllowed, published, status, createdByUserId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    draftId,
    'Processing Movie',
    '',
    'video/mp4',
    1000,
    null,
    null,
    1,
    1,
    'processing',
    adminUser.id,
    new Date().toISOString(),
    new Date().toISOString()
  );
  const notReady = await call(adminToken, 'POST', `/api/rooms/${roomId}/media/library`, {
    body: { mediaId: draftId },
  });
  assert.equal(notReady.status, 404);
  const notReadyJson = (await notReady.json()) as any;
  assert.equal(notReadyJson.error.code, 'MEDIA_NOT_READY');

  // 3. Unpublished media -> MEDIA_UNAVAILABLE (404)
  const unpubId = generateId();
  db.prepare(
    `INSERT INTO media (id, title, description, mimeType, sizeBytes, storageKey, playableKey, downloadAllowed, published, status, createdByUserId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    unpubId,
    'Unpublished Movie',
    '',
    'video/mp4',
    1000,
    null,
    'playable-key.mp4',
    1,
    0,
    'ready',
    adminUser.id,
    new Date().toISOString(),
    new Date().toISOString()
  );
  const unpub = await call(adminToken, 'POST', `/api/rooms/${roomId}/media/library`, {
    body: { mediaId: unpubId },
  });
  assert.equal(unpub.status, 404);
  const unpubJson = (await unpub.json()) as any;
  assert.equal(unpubJson.error.code, 'MEDIA_UNAVAILABLE');

  // 4. Ready published media with existing playable file -> 200 OK
  const readyId = generateId();
  const readyKey = `playable-${readyId}.mp4`;
  fs.writeFileSync(path.join(TEST_DIR, readyKey), Buffer.alloc(4096));

  db.prepare(
    `INSERT INTO media (id, title, description, mimeType, sizeBytes, durationSeconds, storageKey, playableKey, downloadAllowed, published, status, createdByUserId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    readyId,
    'Ready Watch Party Movie',
    '',
    'video/mp4',
    4096,
    120,
    null,
    readyKey,
    1,
    1,
    'ready',
    adminUser.id,
    new Date().toISOString(),
    new Date().toISOString()
  );

  const readyRes = await call(adminToken, 'POST', `/api/rooms/${roomId}/media/library`, {
    body: { mediaId: readyId },
  });
  assert.equal(readyRes.status, 200);
  const readyJson = (await readyRes.json()) as any;
  assert.equal(readyJson.room.currentMedia.mediaId, readyId);
  assert.equal(readyJson.room.currentMedia.mediaType, 'library');
  assert.equal(readyJson.room.currentMedia.title, 'Ready Watch Party Movie');
  assert.equal(readyJson.room.currentMedia.duration, 120);
  assert.equal(readyJson.room.currentMedia.storageKey, undefined, 'Must not leak storageKey');
});

test('6. Static verification: RoomView.tsx uses direct streaming without full-file blob download', () => {
  const roomViewSource = fs.readFileSync(path.resolve('src/components/room/RoomView.tsx'), 'utf8');

  // Assert no blob / arrayBuffer / FileReader downloads for library media
  assert.doesNotMatch(
    roomViewSource,
    /await\s+fetch\([^)]+\)\.then\([^)]+\.blob\(\)\)/i,
    'Must not download video as a blob'
  );
  assert.doesNotMatch(
    roomViewSource,
    /response\.blob\(\)/i,
    'Must not call response.blob() in RoomView'
  );
  assert.doesNotMatch(
    roomViewSource,
    /URL\.createObjectURL\(\s*await/i,
    'Must not create blob URL from fetched stream'
  );

  // Assert video element has preload="metadata" and playsInline
  assert.ok(
    roomViewSource.includes('preload="metadata"'),
    'RoomView video must have preload="metadata"'
  );
  assert.ok(
    roomViewSource.includes('playsInline'),
    'RoomView video must have playsInline'
  );
  assert.ok(
    roomViewSource.includes('[ROOM MEDIA DEBUG]'),
    'RoomView must include [ROOM MEDIA DEBUG] instrumentation'
  );
  assert.ok(
    roomViewSource.includes('[ROOM LIBRARY DEBUG]'),
    'RoomView must include [ROOM LIBRARY DEBUG] instrumentation'
  );
});

test('7. Regression verification: "Preparing your movie for streaming" is NEVER rendered for library media', () => {
  const roomViewSource = fs.readFileSync(path.resolve('src/components/room/RoomView.tsx'), 'utf8');

  // Verify that library media bypasses mediaConversion and renders video directly
  assert.ok(
    roomViewSource.includes("currentRoom.currentMedia?.mediaType !== 'library'"),
    'mediaConversion overlay must explicitly exclude library media'
  );
  assert.ok(
    roomViewSource.includes('[ROOM LIBRARY DEBUG] conversion-bypassed'),
    'RoomView must log conversion-bypassed for library media'
  );
});

test('8. AppContext preserves mediaId in mapServerRoomToItem', () => {
  const appContextSource = fs.readFileSync(path.resolve('src/context/AppContext.tsx'), 'utf8');
  assert.ok(
    appContextSource.includes('mediaId: r.currentMedia.mediaId'),
    'AppContext mapServerRoomToItem must map mediaId into currentMedia'
  );
});

test('9. RoomView includes ROOM VIDEO DEBUG diagnostics', () => {
  const roomViewSource = fs.readFileSync(path.resolve('src/components/room/RoomView.tsx'), 'utf8');
  assert.ok(
    roomViewSource.includes('[ROOM VIDEO DEBUG] currentMedia'),
    'RoomView must log [ROOM VIDEO DEBUG] currentMedia'
  );
  assert.ok(
    roomViewSource.includes('[ROOM VIDEO DEBUG] stream-url'),
    'RoomView must log [ROOM VIDEO DEBUG] stream-url'
  );
  assert.ok(
    roomViewSource.includes('[ROOM VIDEO DEBUG] loadstart'),
    'RoomView must log [ROOM VIDEO DEBUG] loadstart'
  );
  assert.ok(
    roomViewSource.includes('[ROOM VIDEO DEBUG] metadata'),
    'RoomView must log [ROOM VIDEO DEBUG] metadata'
  );
  assert.ok(
    roomViewSource.includes('[ROOM VIDEO DEBUG] canplay'),
    'RoomView must log [ROOM VIDEO DEBUG] canplay'
  );
  assert.ok(
    roomViewSource.includes('[ROOM VIDEO DEBUG] playing'),
    'RoomView must log [ROOM VIDEO DEBUG] playing'
  );
  assert.ok(
    roomViewSource.includes('[ROOM VIDEO DEBUG] error'),
    'RoomView must log [ROOM VIDEO DEBUG] error'
  );
});
