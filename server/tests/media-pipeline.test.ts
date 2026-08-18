// server/tests/media-pipeline.test.ts
// Phase C: resumable large-file media pipeline — end to end.
//
// Covers the full library lifecycle through the REAL HTTP routes:
//   - 10 GiB metadata cap (MAX_ADMIN_MEDIA_BYTES default)
//   - chunked upload (start → PUT chunks → complete), byte-exact
//   - resume (missing-chunk detection + re-send only the missing ones)
//   - retry (chunk-level idempotency + conversion-level retry after failure)
//   - cancellation (chunks + session removed, media restored)
//   - missing-chunk finalization rejection
//   - container validation (FFprobe), FFmpeg remux vs transcode argv safety
//   - conversion failure (partial outputs cleaned, chunks retained)
//   - HTTP streaming: 200 / 206 / HEAD / 416 + download permissions
//   - admin vs user authorization, published visibility
//   - Room media selection (host-only), library reference in room state
//   - playback synchronization (host controls, members observe)
//   - cleanup: expired sessions, orphan files, FFmpeg temp outputs
//
// FFmpeg is an INJECTED fake executor (deterministic, no binary dependency).
// The fake records the exact argv so the no-shell / no-user-filename contract
// is asserted directly.
//
// Run: npx tsx --test server/tests/media-pipeline.test.ts
//
// NOTE: env vars must be set BEFORE the modules are imported — this file
// uses dynamic imports on purpose (ESM hoists static imports).

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const TMP_ROOT = path.join(os.tmpdir(), `praconnect-pipeline-${process.pid}-${Date.now()}`);
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(TMP_ROOT, 'test.db');
process.env.MEDIA_STORAGE_DIR = path.join(TMP_ROOT, 'storage');
process.env.ADMIN_EMAIL = 'owner@example.com';
process.env.ROOM_EMPTY_TTL_MS = '60000';

fs.mkdirSync(TMP_ROOT, { recursive: true }); // before db/index opens the database

const { db } = await import('../db/index');
const { createApp } = await import('../app');
const { createSession, SESSION_COOKIE_NAME } = await import('../auth/session');
const { bootstrapAdminRole } = await import('../db/index');
const { getMediaStorage } = await import('../storage/mediaStorage');
const { setFfmpegExecutorForTesting, setFfmpegAvailabilityForTesting } = await import('../uploads/transcode');
const { conversionTempDir } = await import('../media/pipeline');
const { chunkKey } = await import('../media/uploads');
const { runMediaCleanup } = await import('../media/cleanup');

const app = createApp();

// ─── Fake FFmpeg/FFprobe executor ────────────────────────────────────────────

const fake = {
  probe: { code: 0, duration: '3600', video: 'h264', audio: 'aac' },
  convert: { code: 0 },
  calls: [] as string[][],
};

/** The playable output the fake converter produces for a given source. */
function playableBytes(src: string): Buffer {
  const head = Buffer.alloc(64);
  const fd = fs.openSync(src, 'r');
  try {
    fs.readSync(fd, head, 0, 64, 0);
  } finally {
    fs.closeSync(fd);
  }
  return Buffer.concat([Buffer.from('PLAYABLE-MP4:'), head]);
}

/** Expected playable bytes: the fake converter pads its 64-byte head read
 *  from the assembled source with trailing zeros. */
function expectedPlayable(srcHead: Buffer): Buffer {
  const head = Buffer.alloc(64);
  srcHead.copy(head, 0, 0, Math.min(64, srcHead.length));
  return Buffer.concat([Buffer.from('PLAYABLE-MP4:'), head]);
}

// Gate the fake converter so tests can hold a conversion in flight.
let convertGate: Promise<void> | null = null;
let convertGateRelease: (() => void) | null = null;

function releaseConvertGate(): void {
  convertGateRelease?.();
}

async function fakeExecutor(args: string[], _timeoutMs: number) {
  fake.calls.push(args);
  const [bin, ...rest] = args;
  if (bin === 'ffprobe') {
    if (fake.probe.code !== 0) {
      return { code: fake.probe.code, stdout: '', stderr: 'Invalid data found when processing input' };
    }
    return {
      code: 0,
      stdout: JSON.stringify({
        format: { duration: fake.probe.duration },
        streams: [
          { codec_type: 'video', codec_name: fake.probe.video },
          { codec_type: 'audio', codec_name: fake.probe.audio },
        ],
      }),
      stderr: '',
    };
  }
  if (bin === 'ffmpeg') {
    const output = rest[rest.length - 1];
    if (rest.includes('-frames:v')) {
      // Poster extraction.
      fs.writeFileSync(output, Buffer.from('POSTER-JPEG-BYTES'));
      return { code: 0, stdout: '', stderr: '' };
    }
    if (convertGate) await convertGate;
    const srcIndex = rest.indexOf('-i');
    const src = rest[srcIndex + 1];
    if (fake.convert.code !== 0) {
      // Partial output before the failure — the pipeline must clean it up.
      fs.writeFileSync(output, Buffer.alloc(64, 0x51));
      return { code: fake.convert.code, stdout: '', stderr: 'Conversion failed: bogus data' };
    }
    fs.writeFileSync(output, playableBytes(src));
    return { code: 0, stdout: '', stderr: '' };
  }
  return { code: 127, stdout: '', stderr: 'no such command' };
}

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

interface CallOpts {
  body?: unknown;
  rawBody?: Buffer;
  headers?: Record<string, string>;
}

async function call(token: string | null, method: string, url: string, opts: CallOpts = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers['cookie'] = cookie(token);
  Object.assign(headers, opts.headers ?? {});
  let body: string | undefined;
  if (opts.rawBody) {
    headers['content-type'] = headers['content-type'] ?? 'application/octet-stream';
    headers['content-length'] = String(opts.rawBody.length);
    return app.request(url, { method, headers, body: opts.rawBody });
  }
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers['content-type'] = headers['content-type'] ?? 'application/json';
  }
  return app.request(url, { method, headers, body });
}

async function json(res: Response): Promise<any> {
  return res.json();
}

interface MediaRow {
  id: string;
  title: string;
  status: string;
  published: boolean;
  downloadAllowed: boolean;
  sizeBytes: number;
  duration: number | null;
  playableKey?: string | null;
  storageKey?: string | null;
  posterKey?: string | null;
  [k: string]: any;
}

async function createMedia(adminToken: string, overrides: Record<string, unknown> = {}): Promise<MediaRow> {
  const res = await call(adminToken, 'POST', '/api/admin/media', {
    body: { title: 'Pipeline Movie', downloadAllowed: true, ...overrides },
  });
  assert.equal(res.status, 201);
  return (await json(res)).item;
}

const CHUNK = 256 * 1024; // server minimum chunk size

async function waitForSettled(adminToken: string, id: string, timeoutMs = 8000): Promise<MediaRow> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await call(adminToken, 'GET', `/api/admin/media/${id}`);
    if (res.status === 200) {
      const body = await json(res);
      if (body.item.status === 'ready' || body.item.status === 'failed') return body.item;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Media ${id} did not settle within ${timeoutMs}ms`);
}

/** Poll until an upload session's chunks are removed from storage. */
async function waitForChunkCleanup(uploadId: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await getMediaStorage().exists(chunkKey(uploadId, 0)))) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail(`chunks for upload ${uploadId} were not removed within ${timeoutMs}ms`);
}

/** Start a session and return { session, mediaId, uploadId } or the error. */
async function startSession(
  adminToken: string,
  id: string,
  totalBytes: number,
  opts: { chunkSize?: number; filename?: string; mime?: string } = {}
): Promise<any> {
  const res = await call(adminToken, 'POST', `/api/admin/media/${id}/upload/start`, {
    body: { totalBytes, chunkSize: opts.chunkSize ?? CHUNK },
    headers: {
      'x-filename': encodeURIComponent(opts.filename ?? 'movie.mp4'),
      'x-mime-type': opts.mime ?? 'video/mp4',
    },
  });
  return { status: res.status, body: await json(res) };
}

async function putChunk(adminToken: string, id: string, uploadId: string, index: number, bytes: Buffer): Promise<Response> {
  return call(adminToken, 'PUT', `/api/admin/media/${id}/upload/${uploadId}/chunks/${index}`, { rawBody: bytes });
}

async function completeUpload(adminToken: string, id: string, uploadId: string): Promise<Response> {
  return call(adminToken, 'POST', `/api/admin/media/${id}/upload/${uploadId}/complete`, {});
}

/** Full happy-path upload: session → every chunk → complete → settled item. */
async function runUpload(
  adminToken: string,
  id: string,
  bytes: Buffer,
  opts: { chunkSize?: number; filename?: string; mime?: string } = {}
): Promise<MediaRow> {
  const started = await startSession(adminToken, id, bytes.length, opts);
  assert.equal(started.status, 200, 'session must start');
  const session = started.body.session;
  for (let i = 0; i < session.chunkCount; i++) {
    const start = i * session.chunkSize;
    const end = Math.min(start + session.chunkSize, bytes.length);
    const res = await putChunk(adminToken, id, session.id, i, bytes.subarray(start, end));
    assert.equal(res.status, 200, `chunk ${i} must upload`);
  }
  const completed = await completeUpload(adminToken, id, session.id);
  assert.equal(completed.status, 200, 'complete must succeed');
  return waitForSettled(adminToken, id);
}

const ADMIN_ID = 'admin-id';
const HOST_ID = 'host-id';
const MEMBER_ID = 'member-id';
const USER_ID = 'user-id';

let adminToken: string;
let hostToken: string;
let memberToken: string;
let userToken: string;

before(async () => {
  seedUser(ADMIN_ID, 'Owner', 'owner', 'owner@example.com');
  seedUser(HOST_ID, 'Host', 'host', 'host@example.com');
  seedUser(MEMBER_ID, 'Member', 'member', 'member@example.com');
  seedUser(USER_ID, 'Regular', 'regular', 'regular@example.com');
  bootstrapAdminRole(); // ADMIN_EMAIL promotion
  adminToken = await login(ADMIN_ID);
  hostToken = await login(HOST_ID);
  memberToken = await login(MEMBER_ID);
  userToken = await login(USER_ID);
  setFfmpegExecutorForTesting(fakeExecutor);
  setFfmpegAvailabilityForTesting(true);
});

after(() => {
  setFfmpegExecutorForTesting(null);
  setFfmpegAvailabilityForTesting(null);
  db.close();
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

// ─── 1. 10 GiB metadata cap ──────────────────────────────────────────────────

test('1: MAX_ADMIN_MEDIA_BYTES accepts 10 GiB metadata and rejects anything above', async () => {
  const GIB = 1024 * 1024 * 1024;
  const item = await createMedia(adminToken, { title: 'Ten GiB Item' });

  // Exactly 10 GiB is allowed (safe upper bound, default).
  const ok = await startSession(adminToken, item.id, 10 * GIB, { chunkSize: 8 * 1024 * 1024 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.session.totalBytes, 10 * GIB);
  assert.equal(ok.body.session.chunkCount, 1280, '10 GiB / 8 MiB = 1280 chunks');

  // Cancel it so the media returns to draft.
  const cancelled = await call(adminToken, 'DELETE', `/api/admin/media/${item.id}/upload/${ok.body.session.id}`, {});
  assert.equal(cancelled.status, 200);

  // One byte above the cap is rejected up front, before any byte is streamed.
  const over = await startSession(adminToken, item.id, 10 * GIB + 1);
  assert.equal(over.status, 413);
  assert.equal(over.body.error.code, 'MEDIA_TOO_LARGE');

  // Nonsense sizes are rejected too.
  const zero = await startSession(adminToken, item.id, 0);
  assert.equal(zero.status, 400);
  const negative = await startSession(adminToken, item.id, -5);
  assert.equal(negative.status, 400);
});

// ─── 2. Chunk upload happy path ──────────────────────────────────────────────

test('2: chunked upload → conversion → ready, with byte-exact storage', async () => {
  const item = await createMedia(adminToken, { title: 'Happy Path' });
  const bytes = Buffer.from('THE-QUICK-BROWN-FOX-JUMPS-OVER-THE-LAZY-DOG-0123456789');
  const ready = await runUpload(adminToken, item.id, bytes);

  assert.equal(ready.status, 'ready');
  assert.equal(ready.duration, 3600, 'duration comes from the FFprobe probe');
  assert.equal(ready.mimeType, 'video/mp4');
  assert.equal(ready.playableKey, `playable-${item.id}.mp4`);
  assert.ok(ready.posterKey, 'a poster is generated');
  assert.equal(ready.storageKey, null, 'default policy keeps only the playable version');

  const playable = await getMediaStorage().stat(ready.playableKey);
  assert.ok(playable, 'playable must exist in storage');
  assert.equal(playable.size, ready.sizeBytes);

  // The playable bytes equal what the fake converter wrote from the source,
  // whose head is the first 64 bytes of the uploaded fixture.
  const read = await getMediaStorage().read(ready.playableKey);
  assert.ok(read);
  const chunks: Buffer[] = [];
  for await (const c of read.stream as AsyncIterable<Buffer>) chunks.push(Buffer.from(c));
  assert.deepEqual(Buffer.concat(chunks), expectedPlayable(bytes));

  // Chunks and the session are gone after a successful conversion.
  const sessionRow = db.prepare('SELECT id FROM mediaUploadSessions WHERE mediaId = ?').get(item.id);
  assert.equal(sessionRow, undefined, 'session row is cleaned up after success');
});

// ─── 3. Chunk validation ─────────────────────────────────────────────────────

test('3: invalid chunk indexes and byte counts are rejected', async () => {
  const item = await createMedia(adminToken, { title: 'Chunk Validation' });
  const bytes = Buffer.alloc(4 * CHUNK, 7); // 1 MiB → 4 chunks
  const started = await startSession(adminToken, item.id, bytes.length);
  assert.equal(started.status, 200);
  const session = started.body.session;

  // Index out of range.
  const badIndex = await putChunk(adminToken, item.id, session.id, 99, Buffer.alloc(10, 1));
  assert.equal(badIndex.status, 400);

  // Byte count above the session contract (declared but impossible).
  const oversized = await call(adminToken, 'PUT', `/api/admin/media/${item.id}/upload/${session.id}/chunks/0`, {
    rawBody: Buffer.alloc(CHUNK + 1, 1),
  });
  assert.equal(oversized.status, 400);

  // Correct chunk succeeds.
  const good = await putChunk(adminToken, item.id, session.id, 0, bytes.subarray(0, CHUNK));
  assert.equal(good.status, 200);

  // Session mismatch (wrong upload id) → 404.
  const mismatch = await putChunk(adminToken, item.id, 'no-such-upload', 0, Buffer.alloc(8, 1));
  assert.equal(mismatch.status, 404);

  await call(adminToken, 'DELETE', `/api/admin/media/${item.id}/upload/${session.id}`, {});
});

// ─── 4. Resume ───────────────────────────────────────────────────────────────

test('4: resume reports missing chunks and only those are re-sent', async () => {
  const item = await createMedia(adminToken, { title: 'Resume' });
  const bytes = Buffer.alloc(5 * CHUNK, 3); // 5 chunks
  const started = await startSession(adminToken, item.id, bytes.length);
  assert.equal(started.status, 200);
  const session = started.body.session;

  // Upload chunks 0, 1, 3, 4 — skip chunk 2 (simulated dropped request).
  for (const i of [0, 1, 3, 4]) {
    const res = await putChunk(adminToken, item.id, session.id, i, bytes.subarray(i * CHUNK, (i + 1) * CHUNK));
    assert.equal(res.status, 200);
  }

  // The session reports exactly chunk 2 missing.
  const state = await call(adminToken, 'GET', `/api/admin/media/${item.id}/upload/${session.id}`);
  assert.equal(state.status, 200);
  const stateBody = await json(state);
  assert.deepEqual(stateBody.session.missingChunks, [2]);
  assert.equal(stateBody.session.receivedChunks, 4);

  // "Resume" by starting again → same session, same missing chunk.
  const resumed = await startSession(adminToken, item.id, bytes.length);
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.created, false, 'existing session is returned, not recreated');
  assert.deepEqual(resumed.body.session.missingChunks, [2]);

  // Only the missing chunk is re-sent.
  const fix = await putChunk(adminToken, item.id, session.id, 2, bytes.subarray(2 * CHUNK, 3 * CHUNK));
  assert.equal(fix.status, 200);

  const completed = await completeUpload(adminToken, item.id, session.id);
  assert.equal(completed.status, 200);
  const ready = await waitForSettled(adminToken, item.id);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.sizeBytes, expectedPlayable(bytes).length, 'playable reflects the full 5-chunk source');
});

// ─── 5. Chunk-level retry (idempotent re-send replaces bytes) ────────────────

test('5: re-sending a chunk is idempotent and replaces its bytes', async () => {
  const item = await createMedia(adminToken, { title: 'Chunk Retry' });
  const bytes = Buffer.alloc(2 * CHUNK, 9);
  const started = await startSession(adminToken, item.id, bytes.length);
  const session = started.body.session;

  await putChunk(adminToken, item.id, session.id, 0, bytes.subarray(0, CHUNK));
  const first = await putChunk(adminToken, item.id, session.id, 0, bytes.subarray(0, CHUNK));
  assert.equal(first.status, 200);
  const firstBody = await json(first);
  assert.equal(firstBody.session.receivedChunks, 1, 're-send does not inflate the chunk counter');

  // A corrupted retry (different bytes, same index) replaces the object
  // without inflating the total.
  const replacement = Buffer.alloc(CHUNK, 5);
  await putChunk(adminToken, item.id, session.id, 0, replacement);
  const state = await call(adminToken, 'GET', `/api/admin/media/${item.id}/upload/${session.id}`);
  const stateBody = await json(state);
  assert.equal(stateBody.session.receivedBytes, CHUNK, 'replacement does not inflate the total');

  await putChunk(adminToken, item.id, session.id, 1, bytes.subarray(CHUNK, 2 * CHUNK));
  const full = await call(adminToken, 'GET', `/api/admin/media/${item.id}/upload/${session.id}`);
  assert.equal((await json(full)).session.receivedBytes, 2 * CHUNK, 'full 1 MiB total');
  const completed = await completeUpload(adminToken, item.id, session.id);
  assert.equal(completed.status, 200);
  const ready = await waitForSettled(adminToken, item.id);
  assert.equal(ready.status, 'ready');
});

// ─── 6. Cancellation ─────────────────────────────────────────────────────────

test('6: cancelling an upload removes chunks + session and restores the media', async () => {
  const item = await createMedia(adminToken, { title: 'Cancel Me' });
  const bytes = Buffer.alloc(3 * CHUNK, 1);
  const started = await startSession(adminToken, item.id, bytes.length);
  assert.equal(started.status, 200);
  const session = started.body.session;

  await putChunk(adminToken, item.id, session.id, 0, bytes.subarray(0, CHUNK));
  await putChunk(adminToken, item.id, session.id, 1, bytes.subarray(CHUNK, 2 * CHUNK));
  const chunkKey0 = chunkKey(session.id, 0);
  assert.equal(await getMediaStorage().exists(chunkKey0), true, 'chunks are on disk before cancel');

  const cancelled = await call(adminToken, 'DELETE', `/api/admin/media/${item.id}/upload/${session.id}`, {});
  assert.equal(cancelled.status, 200);

  assert.equal(await getMediaStorage().exists(chunkKey0), false, 'chunks deleted');
  const row = db.prepare('SELECT id FROM mediaUploadSessions WHERE id = ?').get(session.id);
  assert.equal(row, undefined, 'session row deleted');

  const media = await json(await call(adminToken, 'GET', `/api/admin/media/${item.id}`));
  assert.equal(media.item.status, 'draft', 'media returns to its previous status');

  // A fresh session can start right after cancellation.
  const again = await startSession(adminToken, item.id, bytes.length);
  assert.equal(again.status, 200);
  assert.equal(again.body.created, true);
  await call(adminToken, 'DELETE', `/api/admin/media/${item.id}/upload/${again.body.session.id}`, {});
});

// ─── 7. Finalization with missing chunks ─────────────────────────────────────

test('7: complete rejects when chunks are missing (409 with the list)', async () => {
  const item = await createMedia(adminToken, { title: 'Missing Chunks' });
  const bytes = Buffer.alloc(4 * CHUNK, 2);
  const started = await startSession(adminToken, item.id, bytes.length);
  const session = started.body.session;

  await putChunk(adminToken, item.id, session.id, 0, bytes.subarray(0, CHUNK));
  const res = await completeUpload(adminToken, item.id, session.id);
  assert.equal(res.status, 409);
  const body = await json(res);
  assert.equal(body.error.code, 'MEDIA_CONFLICT');
  assert.match(body.error.message, /Missing chunk/);
  assert.match(body.error.message, /1/);
  assert.match(body.error.message, /2/);

  // The session is still active (nothing was finalized).
  const state = await json(await call(adminToken, 'GET', `/api/admin/media/${item.id}/upload/${session.id}`));
  assert.equal(state.session.status, 'active');
  await call(adminToken, 'DELETE', `/api/admin/media/${item.id}/upload/${session.id}`, {});
});

// ─── 7b. Fresh sessions must report EVERY chunk missing ─────────────────────

test('7b: a fresh session reports every chunk missing — never an empty list', async () => {
  const item = await createMedia(adminToken, { title: 'Fresh Missing List' });
  const started = await startSession(adminToken, item.id, 3 * CHUNK);
  assert.equal(started.status, 200);
  assert.deepEqual(
    started.body.session.missingChunks,
    [0, 1, 2],
    'a brand-new session has every index missing — [] would make clients skip everything'
  );
  await call(adminToken, 'DELETE', `/api/admin/media/${item.id}/upload/${started.body.session.id}`, {});
});

// ─── 7c. Chunk bodies without Content-Length are measured while streaming ───

test('7c: a chunk body without Content-Length is measured — never assumed', async () => {
  const item = await createMedia(adminToken, { title: 'No Content-Length' });
  const bytes = Buffer.alloc(2 * CHUNK, 30);
  const started = await startSession(adminToken, item.id, bytes.length);
  assert.equal(started.status, 200);
  const session = started.body.session;

  // A ReadableStream body is sent chunked — the server never sees a
  // Content-Length header and must measure the actual byte count.
  const sendChunked = async (index: number, body: Buffer): Promise<Response> =>
    (await app.request(
      `/api/admin/media/${item.id}/upload/${session.id}/chunks/${index}`,
      {
        method: 'PUT',
        headers: { cookie: cookie(adminToken), 'content-type': 'application/octet-stream' },
        body: Readable.toWeb(Readable.from([body])),
        duplex: 'half',
      } as Parameters<typeof app.request>[1]
    )) as Response;

  const ok = await sendChunked(0, bytes.subarray(0, CHUNK));
  assert.equal(ok.status, 200, 'a chunked body without Content-Length is accepted and measured');

  const short = await sendChunked(1, Buffer.alloc(CHUNK - 100, 30));
  assert.equal(short.status, 400, 'a short chunk is rejected by the measured count');

  await call(adminToken, 'DELETE', `/api/admin/media/${item.id}/upload/${session.id}`, {});
});

// ─── 7d. Expired sessions reject further chunks ─────────────────────────────

test('7d: an expired upload session rejects further chunks', async () => {
  const item = await createMedia(adminToken, { title: 'Expired Session' });
  const bytes = Buffer.alloc(2 * CHUNK, 31);
  const started = await startSession(adminToken, item.id, bytes.length);
  assert.equal(started.status, 200);
  const session = started.body.session;

  const good = await putChunk(adminToken, item.id, session.id, 0, bytes.subarray(0, CHUNK));
  assert.equal(good.status, 200);

  db.prepare('UPDATE mediaUploadSessions SET expiresAt = ? WHERE id = ?').run(
    new Date(Date.now() - 1000).toISOString(),
    session.id
  );

  const expired = await putChunk(adminToken, item.id, session.id, 1, bytes.subarray(CHUNK, 2 * CHUNK));
  assert.equal(expired.status, 409);
  assert.equal((await json(expired)).error.code, 'MEDIA_CONFLICT');

  await call(adminToken, 'DELETE', `/api/admin/media/${item.id}/upload/${session.id}`, {});
});

// ─── 7e. Complete must verify stored byte totals, not just existence ────────

test('7e: complete rejects when stored chunk bytes do not add up to the session total', async () => {
  const item = await createMedia(adminToken, { title: 'Byte Total Check' });
  const bytes = Buffer.alloc(2 * CHUNK, 32);
  const started = await startSession(adminToken, item.id, bytes.length);
  assert.equal(started.status, 200);
  const session = started.body.session;

  await putChunk(adminToken, item.id, session.id, 0, bytes.subarray(0, CHUNK));
  // Corrupt the stored object directly (bypasses the route validation) —
  // every index still exists, but the byte total no longer matches.
  await getMediaStorage().write(chunkKey(session.id, 0), Readable.from([Buffer.from('TOO-SMALL')]));
  await putChunk(adminToken, item.id, session.id, 1, bytes.subarray(CHUNK, 2 * CHUNK));

  const rejected = await completeUpload(adminToken, item.id, session.id);
  assert.equal(rejected.status, 409, 'complete must not trust index presence alone');
  assert.equal((await json(rejected)).error.code, 'MEDIA_CONFLICT');

  // Restore the chunk and finalize normally.
  await putChunk(adminToken, item.id, session.id, 0, bytes.subarray(0, CHUNK));
  const completed = await completeUpload(adminToken, item.id, session.id);
  assert.equal(completed.status, 200);
  const ready = await waitForSettled(adminToken, item.id);
  assert.equal(ready.status, 'ready');
});

// ─── 8. Container validation + conversion failure + retry ────────────────────

test('8: invalid container (FFprobe rejects) → failed; retry succeeds after fix', async () => {
  const item = await createMedia(adminToken, { title: 'Container Validation' });
  const bytes = Buffer.alloc(2 * CHUNK, 4);
  const started = await startSession(adminToken, item.id, bytes.length);
  const session = started.body.session;

  await putChunk(adminToken, item.id, session.id, 0, bytes.subarray(0, CHUNK));
  await putChunk(adminToken, item.id, session.id, 1, bytes.subarray(CHUNK, 2 * CHUNK));

  // FFprobe rejects the container.
  fake.probe.code = 1;
  const completed = await completeUpload(adminToken, item.id, session.id);
  assert.equal(completed.status, 200);
  let media = await waitForSettled(adminToken, item.id);
  assert.equal(media.status, 'failed', 'invalid container → failed');

  // Chunks are retained for the retry; the session is still completed.
  assert.equal(await getMediaStorage().exists(chunkKey(session.id, 0)), true, 'chunks kept after failed conversion');
  const sessionRow = db.prepare('SELECT id FROM mediaUploadSessions WHERE id = ?').get(session.id);
  assert.ok(sessionRow, 'session row kept after failed conversion');

  // Retry: FFprobe is fixed → complete again → conversion reruns → ready.
  fake.probe.code = 0;
  const retried = await completeUpload(adminToken, item.id, session.id);
  assert.equal(retried.status, 200, 'retry finalization succeeds');
  media = await waitForSettled(adminToken, item.id);
  assert.equal(media.status, 'ready', 'retry after failure converts successfully');
  await waitForChunkCleanup(session.id);
  assert.equal(await getMediaStorage().exists(chunkKey(session.id, 0)), false, 'chunks removed after success');
});

test('8b: FFmpeg conversion failure cleans partial outputs but keeps chunks', async () => {
  const item = await createMedia(adminToken, { title: 'Conversion Failure' });
  const bytes = Buffer.alloc(3 * CHUNK, 6);
  const started = await startSession(adminToken, item.id, bytes.length);
  const session = started.body.session;
  for (let i = 0; i < session.chunkCount; i++) {
    const start = i * session.chunkSize;
    const end = Math.min(start + session.chunkSize, bytes.length);
    await putChunk(adminToken, item.id, session.id, i, bytes.subarray(start, end));
  }

  fake.convert.code = 1;
  await completeUpload(adminToken, item.id, session.id);
  let media = await waitForSettled(adminToken, item.id);
  assert.equal(media.status, 'failed');

  assert.equal(media.playableKey, null, 'no playable reference on failure');
  assert.equal(media.posterKey, null, 'no poster reference on failure');
  assert.equal(await getMediaStorage().exists(`playable-${item.id}.mp4`), false, 'partial playable removed');
  assert.equal(await getMediaStorage().exists(`poster-${item.id}.jpg`), false, 'no stray poster');
  assert.equal(await getMediaStorage().exists(chunkKey(session.id, 0)), true, 'chunks kept for retry');

  // No temp artifacts survive the failed run.
  assert.equal(fs.readdirSync(conversionTempDir()).length, 0);

  // Retry now succeeds.
  fake.convert.code = 0;
  await completeUpload(adminToken, item.id, session.id);
  media = await waitForSettled(adminToken, item.id);
  assert.equal(media.status, 'ready');
});

// ─── 9. FFmpeg argv contract ─────────────────────────────────────────────────

test('9: FFmpeg runs via argv arrays only — remux vs transcode, faststart, no user input', async () => {
  const item = await createMedia(adminToken, { title: 'FFmpeg Contract' });
  const bytes = Buffer.alloc(2 * CHUNK, 8);
  await runUpload(adminToken, item.id, bytes);

  const convertCalls = fake.calls.filter((args) => args[0] === 'ffmpeg' && !args.includes('-frames:v'));
  assert.ok(convertCalls.length >= 1);

  for (const args of convertCalls) {
    // Remux for H.264/AAC sources.
    assert.ok(args.includes('-c') && args.includes('copy'), 'H.264/AAC source is remuxed');
    assert.ok(args.includes('-movflags') && args.includes('+faststart'), 'faststart is always set');
    assert.ok(args.includes('-max_muxing_queue_size'));
    // No shell metacharacters anywhere (Windows absolute paths legitimately
    // contain backslashes — they are inert argv elements via execFile).
    assert.ok(!args.some((a) => /[;&|`$<>]/.test(a)), 'argv must be shell-safe');
    // User-controlled strings never appear.
    assert.ok(!args.some((a) => a.includes('movie.mp4') || a.includes('THE-QUICK')), 'no user filename in argv');
    // Input/output paths are absolute, inside the conversion temp dir.
    const srcIndex = args.indexOf('-i');
    const src = args[srcIndex + 1];
    const out = args[args.length - 1];
    assert.ok(path.isAbsolute(src) && path.isAbsolute(out));
    assert.ok(src.startsWith(conversionTempDir()));
    assert.ok(out.startsWith(conversionTempDir()));
  }

  // A non-remuxable source (e.g. HEVC) triggers a full transcode instead.
  fake.calls.length = 0;
  fake.probe.video = 'hevc';
  const transcodeItem = await createMedia(adminToken, { title: 'Transcode Path' });
  await runUpload(adminToken, transcodeItem.id, Buffer.alloc(CHUNK, 8));
  const transcodeCall = fake.calls.find((args) => args[0] === 'ffmpeg' && !args.includes('-frames:v'));
  assert.ok(transcodeCall, 'a transcode call must exist');
  assert.ok(transcodeCall.includes('-c:v') && transcodeCall.includes('libx264'), 'HEVC is transcoded to H.264');
  assert.ok(transcodeCall.includes('-c:a') && transcodeCall.includes('aac'));
  assert.ok(!transcodeCall.includes('copy'), 'no remux for incompatible codecs');
  fake.probe.video = 'h264';
});

// ─── 10. Streaming: 200 / 206 / HEAD / 416 ──────────────────────────────────

test('10: streaming serves full, partial, suffix, HEAD, and 416 responses', async () => {
  const item = await createMedia(adminToken, { published: true, title: 'Streaming' });
  const src = Buffer.alloc(5 * CHUNK, 11);
  const ready = await runUpload(adminToken, item.id, src);
  const playable = expectedPlayable(src); // deterministic fake output
  const size = playable.length;
  assert.equal(ready.sizeBytes, size);

  // Full GET → 200 with the exact playable bytes.
  const full = await call(userToken, 'GET', `/api/media/${item.id}/download`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-length'), String(size));
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), playable);

  // Prefix range → 206.
  const prefix = await call(userToken, 'GET', `/api/media/${item.id}/download`, { headers: { Range: 'bytes=0-9' } });
  assert.equal(prefix.status, 206);
  assert.equal(prefix.headers.get('content-range'), `bytes 0-9/${size}`);
  assert.deepEqual(Buffer.from(await prefix.arrayBuffer()), playable.subarray(0, 10));

  // Middle range (seek target).
  const mid = await call(userToken, 'GET', `/api/media/${item.id}/download`, {
    headers: { Range: `bytes=${size - 40}-${size - 21}` },
  });
  assert.equal(mid.status, 206);
  assert.deepEqual(Buffer.from(await mid.arrayBuffer()), playable.subarray(size - 40, size - 20));

  // Suffix range.
  const suffix = await call(userToken, 'GET', `/api/media/${item.id}/download`, { headers: { Range: 'bytes=-7' } });
  assert.equal(suffix.status, 206);
  assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), playable.subarray(size - 7));

  // Unsatisfiable → 416 with the correct full-size header.
  const tooFar = await call(userToken, 'GET', `/api/media/${item.id}/download`, {
    headers: { Range: `bytes=${size}-` },
  });
  assert.equal(tooFar.status, 416);
  assert.equal(tooFar.headers.get('content-range'), `bytes */${size}`);

  // HEAD → headers only, no body.
  const head = await call(userToken, 'HEAD', `/api/media/${item.id}/download`);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(size));
  assert.equal(head.headers.get('accept-ranges'), 'bytes');
  assert.equal(await head.text(), '');

  // HEAD with an unsatisfiable range → 416.
  const head416 = await call(userToken, 'HEAD', `/api/media/${item.id}/download`, {
    headers: { Range: `bytes=${size + 1}-` },
  });
  assert.equal(head416.status, 416);

  // Range beyond the last byte is clamped to the end.
  const clamp = await call(userToken, 'GET', `/api/media/${item.id}/download`, {
    headers: { Range: `bytes=${size - 3}-999999999` },
  });
  assert.equal(clamp.status, 206);
  assert.equal(clamp.headers.get('content-range'), `bytes ${size - 3}-${size - 1}/${size}`);
});

// ─── 11. Download permission ─────────────────────────────────────────────────

test('11: downloadAllowed gates users; admins bypass; unpublished stays 404', async () => {
  const locked = await createMedia(adminToken, { published: true, downloadAllowed: false, title: 'Locked Download' });
  await runUpload(adminToken, locked.id, Buffer.alloc(CHUNK, 12));

  const userRes = await call(userToken, 'GET', `/api/media/${locked.id}/download`);
  assert.equal(userRes.status, 403);
  const adminRes = await call(adminToken, 'GET', `/api/media/${locked.id}/download`);
  assert.equal(adminRes.status, 200, 'admin policy allows download of any item');

  // Unpublished ready item → users 404, admins 200.
  const hidden = await createMedia(adminToken, { published: false, title: 'Hidden Download' });
  await runUpload(adminToken, hidden.id, Buffer.alloc(CHUNK, 13));
  assert.equal((await call(userToken, 'GET', `/api/media/${hidden.id}/download`)).status, 404);
  assert.equal((await call(adminToken, 'GET', `/api/media/${hidden.id}/download`)).status, 200);
});

// ─── 12. Authorization ───────────────────────────────────────────────────────

test('12: normal users cannot start/uploads/complete/cancel/publish/delete', async () => {
  const item = await createMedia(adminToken, { title: 'Authz Target' });
  const uploadId = 'some-upload';

  const attempts = [
    ['POST', `/api/admin/media/${item.id}/upload/start`, { totalBytes: 10 }],
    ['GET', `/api/admin/media/${item.id}/upload/${uploadId}`],
    ['PUT', `/api/admin/media/${item.id}/upload/${uploadId}/chunks/0`],
    ['POST', `/api/admin/media/${item.id}/upload/${uploadId}/complete`],
    ['DELETE', `/api/admin/media/${item.id}/upload/${uploadId}`],
    ['POST', `/api/admin/media/${item.id}/publish`],
    ['POST', `/api/admin/media/${item.id}/unpublish`],
    ['PATCH', `/api/admin/media/${item.id}`, { title: 'nope' }],
    ['DELETE', `/api/admin/media/${item.id}`],
    ['POST', `/api/admin/media/${item.id}/poster`],
  ] as const;

  for (const [method, url, body] of attempts) {
    const res = await call(userToken, method, url, body !== undefined ? { body } : {});
    assert.equal(res.status, 403, `${method} ${url} as user must be 403`);
  }

  // Unauthenticated → 401 everywhere.
  for (const [method, url] of [
    ['GET', '/api/admin/media'],
    ['POST', `/api/admin/media/${item.id}/upload/start`],
    ['GET', `/api/media/${item.id}/download`],
  ] as const) {
    const res = await call(null, method, url, method === 'POST' ? { body: { totalBytes: 10 } } : {});
    assert.equal(res.status, 401, `${method} ${url} unauthenticated must be 401`);
  }
});

// ─── 13. Published visibility for users ──────────────────────────────────────

test('13: users only see published + ready items (never processing/uploading)', async () => {
  const ready = await createMedia(adminToken, { published: true, title: 'Visible To Users' });
  await runUpload(adminToken, ready.id, Buffer.alloc(CHUNK, 14));

  const uploading = await createMedia(adminToken, { published: true, title: 'Uploading Item' });
  await startSession(adminToken, uploading.id, 2 * CHUNK);

  const list = await json(await call(userToken, 'GET', '/api/media'));
  const titles = list.items.map((m: MediaRow) => m.title);
  assert.ok(titles.includes('Visible To Users'));
  assert.ok(!titles.includes('Uploading Item'));

  // An in-flight item has no playable bytes yet — even admins get 404 from
  // the user download route (there is nothing to stream), while the admin API
  // still exposes the item in every state.
  assert.equal((await call(userToken, 'GET', `/api/media/${uploading.id}`)).status, 404);
  assert.equal((await call(adminToken, 'GET', `/api/media/${uploading.id}/download`)).status, 404, 'nothing to stream yet');
  assert.equal((await call(adminToken, 'GET', `/api/admin/media/${uploading.id}`)).status, 200, 'admin API sees all states');

  const sessionRow = db
    .prepare('SELECT id FROM mediaUploadSessions WHERE mediaId = ? ORDER BY createdAt DESC LIMIT 1')
    .get(uploading.id) as { id: string } | undefined;
  if (sessionRow) {
    await call(adminToken, 'DELETE', `/api/admin/media/${uploading.id}/upload/${sessionRow.id}`, {});
  }
});

// ─── 14. Room media selection (host-only) ────────────────────────────────────

let roomId = '';

async function createRoomAndJoin(): Promise<void> {
  const res = await call(hostToken, 'POST', '/api/rooms', {
    body: {
      name: 'Library Watch Party',
      category: 'Movie',
      privacy: 'public',
      maxParticipants: 4,
    },
  });
  assert.equal(res.status, 201);
  const room = (await json(res)).room;
  roomId = room.id;
  const join = await call(memberToken, 'POST', `/api/rooms/${roomId}/join`, {});
  assert.equal(join.status, 200);
}

test('14: host selects published library media → room stores a mediaId reference', async () => {
  const item = await createMedia(adminToken, { published: true, title: 'Room Library Pick' });
  await runUpload(adminToken, item.id, Buffer.alloc(CHUNK, 15));
  await createRoomAndJoin();

  const res = await call(hostToken, 'POST', `/api/rooms/${roomId}/media/library`, { body: { mediaId: item.id } });
  assert.equal(res.status, 200);
  const room = (await json(res)).room;

  assert.equal(room.currentMedia.mediaType, 'library');
  assert.equal(room.currentMedia.mediaId, item.id, 'room stores a mediaId reference, never a path');
  assert.equal(room.currentMedia.title, 'Room Library Pick');
  assert.equal(room.currentMedia.duration, 3600);
  assert.equal(room.currentMedia.mimeType, 'video/mp4');
  assert.ok(!('url' in room.currentMedia) || room.currentMedia.url === undefined, 'no direct URL in room state');
  assert.ok(!JSON.stringify(room.currentMedia).includes('/api/media/'), 'no download URL leaks into room state');

  // A member sees the same reference.
  const memberView = await call(memberToken, 'GET', `/api/rooms/${roomId}`);
  assert.equal(memberView.status, 200);
  const memberRoom = (await json(memberView)).room;
  assert.equal(memberRoom.currentMedia.mediaId, item.id);

  // Host-only: a member changing room media → 403 NOT_HOST.
  const denied = await call(memberToken, 'POST', `/api/rooms/${roomId}/media/library`, { body: { mediaId: item.id } });
  assert.equal(denied.status, 403);
  assert.equal((await json(denied)).error.code, 'NOT_HOST');
});

test('14b: unpublished / non-ready / missing library media is rejected', async () => {
  const unpublished = await createMedia(adminToken, { published: false, title: 'Hidden Library Pick' });
  await runUpload(adminToken, unpublished.id, Buffer.alloc(CHUNK, 16));

  const hiddenRes = await call(hostToken, 'POST', `/api/rooms/${roomId}/media/library`, { body: { mediaId: unpublished.id } });
  assert.equal(hiddenRes.status, 404);

  const draft = await createMedia(adminToken, { published: true, title: 'Draft Library Pick' });
  const draftRes = await call(hostToken, 'POST', `/api/rooms/${roomId}/media/library`, { body: { mediaId: draft.id } });
  assert.equal(draftRes.status, 404, 'non-ready media cannot be selected');

  const missing = await call(hostToken, 'POST', `/api/rooms/${roomId}/media/library`, { body: { mediaId: 'no-such-id' } });
  assert.equal(missing.status, 404);

  const noBody = await call(hostToken, 'POST', `/api/rooms/${roomId}/media/library`, {});
  assert.equal(noBody.status, 400, 'mediaId is required');
});

// ─── 15. Playback synchronization ────────────────────────────────────────────

test('15: host controls playback; members observe; library stream stays separate', async () => {
  // Each participant streams the library file through their own session —
  // the authorized download endpoint answers for the member.
  const mediaRow = db
    .prepare(`SELECT id FROM media WHERE title = 'Room Library Pick'`)
    .get() as { id: string };
  const memberStream = await call(memberToken, 'GET', `/api/media/${mediaRow.id}/download`, {
    headers: { Range: 'bytes=0-9' },
  });
  assert.equal(memberStream.status, 206, 'member streams library media independently');

  const play = await call(hostToken, 'POST', `/api/rooms/${roomId}/playback`, {
    body: { isPlaying: true, position: 120 },
  });
  assert.equal(play.status, 200);
  const playRoom = (await json(play)).room;
  assert.equal(playRoom.playback.isPlaying, true);
  assert.equal(playRoom.playback.position, 120);

  // Members see the authoritative state.
  const memberRoom = (await json(await call(memberToken, 'GET', `/api/rooms/${roomId}`))).room;
  assert.equal(memberRoom.playback.isPlaying, true);
  assert.equal(memberRoom.playback.position, 120);

  // Pause + seek propagate too.
  const seek = await call(hostToken, 'POST', `/api/rooms/${roomId}/playback`, {
    body: { isPlaying: false, position: 600 },
  });
  assert.equal(seek.status, 200);
  const seekRoom = (await json(seek)).room;
  assert.equal(seekRoom.playback.isPlaying, false);
  assert.equal(seekRoom.playback.position, 600);

  // Members cannot drive playback.
  const denied = await call(memberToken, 'POST', `/api/rooms/${roomId}/playback`, { body: { isPlaying: true, position: 0 } });
  assert.equal(denied.status, 403);
  assert.equal((await json(denied)).error.code, 'NOT_HOST');

  // A random user (not a member) gets membership required.
  const outsider = await call(userToken, 'POST', `/api/rooms/${roomId}/playback`, { body: { isPlaying: true } });
  assert.equal(outsider.status, 403);
});

// ─── 16. Cleanup ─────────────────────────────────────────────────────────────

test('16: expired sessions, orphan files, and FFmpeg temp outputs are swept', async () => {
  const storage = getMediaStorage();

  // A tiny stub used to write storage objects from disk.
  const stub = path.join(TMP_ROOT, 'stub.bin');
  fs.writeFileSync(stub, Buffer.from('STUB'));

  // 16a. Expired upload session → chunks + row removed, media marked failed.
  const staleItem = await createMedia(adminToken, { title: 'Stale Session' });
  const started = await startSession(adminToken, staleItem.id, 2 * CHUNK);
  const session = started.body.session;
  await putChunk(adminToken, staleItem.id, session.id, 0, Buffer.alloc(CHUNK, 21));
  db.prepare('UPDATE mediaUploadSessions SET expiresAt = ? WHERE id = ?').run(
    new Date(Date.now() - 60_000).toISOString(),
    session.id
  );

  const result = await runMediaCleanup();
  assert.ok(result.expiredSessions >= 1, 'expired session swept');
  assert.equal(await storage.exists(chunkKey(session.id, 0)), false, 'its chunks are gone');
  assert.equal(db.prepare('SELECT id FROM mediaUploadSessions WHERE id = ?').get(session.id), undefined);
  const staleMedia = await json(await call(adminToken, 'GET', `/api/admin/media/${staleItem.id}`));
  assert.equal(staleMedia.item.status, 'failed', 'media without chunks is marked failed');

  // 16b. Orphan playable file (no row references it, older than retention).
  const orphanKey = 'playable-orphan-test.mp4';
  await storage.write(orphanKey, fs.createReadStream(stub));
  const orphanAbs = path.join(process.env.MEDIA_STORAGE_DIR!, orphanKey);
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  fs.utimesSync(orphanAbs, old, old);
  const before = await storage.exists(orphanKey);
  assert.equal(before, true);
  await runMediaCleanup();
  assert.equal(await storage.exists(orphanKey), false, 'orphan file swept');

  // 16c. Leftover FFmpeg temp file (old mtime) is removed.
  const tmpDir = conversionTempDir();
  fs.mkdirSync(tmpDir, { recursive: true });
  const staleTmp = path.join(tmpDir, 'lib-stale-12345678.source.mp4');
  fs.writeFileSync(staleTmp, Buffer.alloc(16, 1));
  fs.utimesSync(staleTmp, old, old);
  await runMediaCleanup();
  assert.equal(fs.existsSync(staleTmp), false, 'stale temp file swept');

  // 16d. Referenced files are never swept.
  const referenced = db.prepare(`SELECT playableKey FROM media WHERE playableKey IS NOT NULL LIMIT 1`).get() as {
    playableKey: string;
  } | undefined;
  if (referenced) {
    assert.equal(await storage.exists(referenced.playableKey), true, 'referenced playable survives cleanup');
  }

  // 16e. A fresh, unreferenced file younger than the grace period is kept
  // (protects in-flight writes).
  const youngKey = 'playable-young-orphan.mp4';
  await storage.write(youngKey, fs.createReadStream(stub));
  await runMediaCleanup();
  assert.equal(await storage.exists(youngKey), true, 'young unreferenced files are never swept');
  await storage.delete(youngKey);
});

// ─── 17. Chunk objects are never exposed to users ────────────────────────────

test('17: storage keys never leak through public responses or room state', async () => {
  const mediaRow = db
    .prepare(`SELECT id, playableKey, storageKey, posterKey FROM media WHERE status = 'ready' AND published = 1 LIMIT 1`)
    .get() as { id: string; playableKey: string | null; storageKey: string | null; posterKey: string | null } | undefined;
  assert.ok(mediaRow, 'a ready published item exists');

  const publicItem = (await json(await call(userToken, 'GET', `/api/media/${mediaRow.id}`))).item;
  for (const key of ['playableKey', 'storageKey', 'posterKey']) {
    assert.ok(!(key in publicItem), `${key} must not leak to users`);
  }
  assert.ok(!JSON.stringify(publicItem).includes(mediaRow.playableKey!), 'opaque key string never leaks');
});

// ─── 18. Upload sessions guard against double-start ──────────────────────────

test('18: starting a second upload while conversion runs is refused (MEDIA_BUSY)', async () => {
  const item = await createMedia(adminToken, { title: 'Busy Guard' });
  const bytes = Buffer.alloc(2 * CHUNK, 22);
  const started = await startSession(adminToken, item.id, bytes.length);
  const session = started.body.session;
  await putChunk(adminToken, item.id, session.id, 0, bytes.subarray(0, CHUNK));
  await putChunk(adminToken, item.id, session.id, 1, bytes.subarray(CHUNK, 2 * CHUNK));

  // Hold the FFmpeg conversion in flight so the media stays 'processing'.
  convertGateRelease = null;
  convertGate = new Promise<void>((resolve) => (convertGateRelease = resolve));
  await completeUpload(adminToken, item.id, session.id);

  // The conversion is now running; a new session must be refused and the
  // in-flight chunks must survive untouched.
  const busy = await startSession(adminToken, item.id, bytes.length);
  assert.equal(busy.status, 409);
  assert.equal(busy.body.error.code, 'MEDIA_BUSY');
  assert.equal(await getMediaStorage().exists(chunkKey(session.id, 0)), true, 'in-flight chunks never touched');

  // Release the conversion with a failure → media fails, chunks retained.
  fake.convert.code = 1;
  releaseConvertGate();
  convertGate = null;
  let media = await waitForSettled(adminToken, item.id);
  assert.equal(media.status, 'failed');
  assert.equal(await getMediaStorage().exists(chunkKey(session.id, 0)), true, 'chunks retained for retry');

  // After failure, a fresh upload is allowed and replaces the old session.
  fake.convert.code = 0;
  const restarted = await startSession(adminToken, item.id, bytes.length);
  assert.equal(restarted.status, 200);
  assert.equal(restarted.body.created, true);
  assert.equal(db.prepare('SELECT id FROM mediaUploadSessions WHERE id = ?').get(session.id), undefined, 'stale failed session swept');

  // While that new session is active, a second start resumes it instead of
  // creating a duplicate.
  const again = await startSession(adminToken, item.id, bytes.length);
  assert.equal(again.status, 200);
  assert.equal(again.body.created, false, 'resume, not duplicate');

  await call(adminToken, 'DELETE', `/api/admin/media/${item.id}/upload/${again.body.session.id}`, {});
});
