// server/tests/media-library.test.ts
// Phase B + C: Media Library backend — admin + user behavior.
//
// Covers: admin auth, user auth, media CRUD, published visibility,
// unpublished visibility, search, pagination, delete authorization, download
// authorization, storage path safety, lifecycle transitions, invalid metadata
// rejection, and the rule that users can never modify media. The upload path
// uses the Phase C resumable chunked pipeline (start → PUT chunks → complete →
// FFmpeg) with an injected fake FFmpeg/FFprobe executor — deterministic, no
// binary dependency, and no large fixtures.
//
// Run: npx tsx --test server/tests/media-library.test.ts
//
// NOTE: env vars must be set BEFORE the modules are imported — this file
// uses dynamic imports on purpose (ESM hoists static imports).

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const TMP_ROOT = path.join(os.tmpdir(), `praconnect-media-${process.pid}-${Date.now()}`);
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(TMP_ROOT, 'test.db');
process.env.MEDIA_STORAGE_DIR = path.join(TMP_ROOT, 'storage');
process.env.MEDIA_MAX_SIZE_BYTES = '524288'; // 512 KB cap for oversize tests
process.env.ADMIN_EMAIL = 'owner@example.com';
process.env.MEDIA_RETAIN_ORIGINAL = 'true'; // keep the original for download tests

fs.mkdirSync(TMP_ROOT, { recursive: true }); // before db/index opens the database

const { db } = await import('../db/index');
const { createApp } = await import('../app');
const { createSession, SESSION_COOKIE_NAME } = await import('../auth/session');
const { bootstrapAdminRole } = await import('../db/index');
const { LocalDiskStorage, isSafeStorageKey, MAX_STORAGE_KEY_LENGTH, getMediaStorage } = await import('../storage/mediaStorage');
const { sanitizeOriginalFilename, parseRange } = await import('../media/service');
const { setFfmpegExecutorForTesting, setFfmpegAvailabilityForTesting } = await import('../uploads/transcode');
const { conversionTempDir } = await import('../media/pipeline');

const app = createApp();

// ─── Fake FFmpeg/FFprobe executor ────────────────────────────────────────────
// The fake converts by COPYING the source bytes into the playable output, so
// the tests can assert byte-exact round trips through the pipeline. It also
// records every argv for the safety-contract assertions.

const fakeCalls: string[][] = [];

async function fakeExecutor(args: string[], _timeoutMs: number) {
  fakeCalls.push(args);
  const [bin, ...rest] = args;
  if (bin === 'ffprobe') {
    return {
      code: 0,
      stdout: JSON.stringify({
        format: { duration: '3600' },
        streams: [
          { codec_type: 'video', codec_name: 'h264' },
          { codec_type: 'audio', codec_name: 'aac' },
        ],
      }),
      stderr: '',
    };
  }
  if (bin === 'ffmpeg') {
    const output = rest[rest.length - 1];
    if (rest.includes('-frames:v')) {
      fs.writeFileSync(output, Buffer.from('POSTER-JPEG-BYTES'));
      return { code: 0, stdout: '', stderr: '' };
    }
    const srcIndex = rest.indexOf('-i');
    const src = rest[srcIndex + 1];
    fs.copyFileSync(src, output);
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

interface MediaRow { id: string; [k: string]: any }

async function createMedia(adminToken: string, overrides: Record<string, unknown> = {}): Promise<MediaRow> {
  const res = await call(adminToken, 'POST', '/api/admin/media', {
    body: { title: 'Test Movie', description: 'A test description.', downloadAllowed: true, ...overrides },
  });
  assert.equal(res.status, 201, 'create should succeed');
  const body = await json(res);
  return body.item;
}

const CHUNK = 256 * 1024; // server minimum — used for small fixtures

/** Poll GET /api/admin/media/:id until status settles (ready|failed). */
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

/**
 * Phase C resumable chunked upload: create session → PUT each chunk (raw
 * body, byte-exact slices) → complete → wait for the conversion to settle.
 * Returns a Response-shaped object ({ status, body }) so call sites keep the
 * old contract (res.status / json(res)).
 */
async function uploadFile(
  adminToken: string,
  id: string,
  bytes: Buffer,
  opts: { filename?: string; mime?: string; chunkSize?: number } = {}
): Promise<Response> {
  const started = await call(adminToken, 'POST', `/api/admin/media/${id}/upload/start`, {
    body: { totalBytes: bytes.length, chunkSize: opts.chunkSize ?? CHUNK },
    headers: {
      'x-filename': encodeURIComponent(opts.filename ?? 'movie.mp4'),
      'x-mime-type': opts.mime ?? 'video/mp4',
    },
  });
  if (started.status !== 200) {
    return Response.json({ item: null, error: (await json(started)).error }, { status: started.status });
  }
  const session = (await json(started)).session;
  const { chunkSize, chunkCount, id: uploadId } = session;

  for (let i = 0; i < chunkCount; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, bytes.length);
    const res = await call(adminToken, 'PUT', `/api/admin/media/${id}/upload/${uploadId}/chunks/${i}`, {
      rawBody: bytes.subarray(start, end),
    });
    if (res.status !== 200) {
      return Response.json({ item: null, error: (await json(res)).error }, { status: res.status });
    }
  }

  const completed = await call(adminToken, 'POST', `/api/admin/media/${id}/upload/${uploadId}/complete`, {});
  if (completed.status !== 200) {
    return Response.json({ item: null, error: (await json(completed)).error }, { status: completed.status });
  }

  const item = await waitForSettled(adminToken, id);
  return Response.json({ item }, { status: 200 });
}

/** Create metadata + chunked upload → ready item. */
async function createReadyMedia(adminToken: string, overrides: Record<string, unknown> = {}): Promise<MediaRow> {
  const item = await createMedia(adminToken, overrides);
  const res = await uploadFile(adminToken, item.id, Buffer.from('FAKE-VIDEO-BYTES-0123456789'));
  assert.equal(res.status, 200, 'upload should succeed');
  const body = await json(res);
  return body.item;
}

const ADMIN_ID = 'admin-id';
const USER_ID = 'user-id';
const USER2_ID = 'user2-id';

let adminToken: string;
let userToken: string;
let user2Token: string;

before(async () => {
  seedUser(ADMIN_ID, 'Owner', 'owner', 'owner@example.com');
  seedUser(USER_ID, 'Regular', 'regular', 'regular@example.com');
  seedUser(USER2_ID, 'Other User', 'other', 'other@example.com');
  bootstrapAdminRole(); // ADMIN_EMAIL must be set for the promotion
  adminToken = await login(ADMIN_ID);
  userToken = await login(USER_ID);
  user2Token = await login(USER2_ID);
  setFfmpegExecutorForTesting(fakeExecutor);
  setFfmpegAvailabilityForTesting(true);
});

after(() => {
  setFfmpegExecutorForTesting(null);
  setFfmpegAvailabilityForTesting(null);
  db.close();
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

// ─── 1. Admin auth ───────────────────────────────────────────────────────────

test('1: admin routes require an authenticated admin (401 / 403 ADMIN_REQUIRED)', async () => {
  for (const [method, url, body] of [
    ['GET', '/api/admin/media', undefined],
    ['POST', '/api/admin/media', { title: 'x' }],
    ['GET', '/api/admin/media/some-id', undefined],
    ['PATCH', '/api/admin/media/some-id', { title: 'y' }],
    ['DELETE', '/api/admin/media/some-id', undefined],
    ['POST', '/api/admin/media/some-id/publish', undefined],
    ['POST', '/api/admin/media/some-id/unpublish', undefined],
    ['POST', '/api/admin/media/some-id/upload/start', { totalBytes: 10 }],
  ] as const) {
    // Unauthenticated → 401.
    const unauth = await call(null, method, url, body !== undefined ? { body } : {});
    assert.equal(unauth.status, 401, `${method} ${url} unauthenticated should be 401`);
    const unauthBody = await json(unauth);
    assert.equal(unauthBody.error.code, 'UNAUTHENTICATED');

    // Authenticated non-admin → 403 FORBIDDEN.
    const forbidden = await call(userToken, method, url, body !== undefined ? { body } : {});
    assert.equal(forbidden.status, 403, `${method} ${url} as user should be 403`);
    const forbiddenBody = await json(forbidden);
    assert.equal(forbiddenBody.error.code, 'FORBIDDEN');
  }
});

test('1b: user routes require authentication (401)', async () => {
  for (const url of ['/api/media', '/api/media/some-id', '/api/media/some-id/download']) {
    const res = await call(null, 'GET', url);
    assert.equal(res.status, 401, `${url} should be 401`);
  }
});

// ─── 2. Create + metadata validation ─────────────────────────────────────────

test('2: admin creates media metadata as a draft with defaults', async () => {
  const item = await createMedia(adminToken, { published: true, downloadAllowed: false });
  assert.equal(item.status, 'draft');
  assert.equal(item.published, true);
  assert.equal(item.downloadAllowed, false);
  assert.equal(item.sizeBytes, 0);
  assert.equal(item.storageKey, null);
  assert.equal(item.createdByUserId, ADMIN_ID);

  // The creator's name comes from the admin read path (joined with users).
  const fetched = await call(adminToken, 'GET', `/api/admin/media/${item.id}`);
  const fetchedBody = await json(fetched);
  assert.equal(fetchedBody.item.creatorName, 'Owner');
});

test('3: invalid metadata is rejected with VALIDATION_ERROR', async () => {
  const cases: Record<string, unknown>[] = [
    { title: '' },
    { title: '   ' },
    { title: 'x'.repeat(201) },
    { title: 'ok', description: 'x'.repeat(2001) },
    { title: 'ok', mimeType: 'text/html' },
    { title: 'ok', mimeType: 'video' },
    { title: 'ok', sizeBytes: -5 },
    { title: 'ok', sizeBytes: 'huge' },
    { title: 'ok', downloadAllowed: 'yes' },
    { title: 'ok', published: 1 },
    { title: 'ok', sizeBytes: 10 ** 20 },
  ];
  for (const body of cases) {
    const res = await call(adminToken, 'POST', '/api/admin/media', { body });
    assert.equal(res.status, 400, `should reject ${JSON.stringify(body)}`);
    const resBody = await json(res);
    assert.equal(resBody.error.code, 'VALIDATION_ERROR');
  }
});

test('3b: PATCH rejects invalid metadata too', async () => {
  const item = await createMedia(adminToken);
  const bad = await call(adminToken, 'PATCH', `/api/admin/media/${item.id}`, { body: { title: '' } });
  assert.equal(bad.status, 400);
  const tooLong = await call(adminToken, 'PATCH', `/api/admin/media/${item.id}`, {
    body: { description: 'z'.repeat(2500) },
  });
  assert.equal(tooLong.status, 400);
});

// ─── 4. Upload lifecycle (Phase C resumable chunks) ──────────────────────────

test('4: chunked upload finalizes, converts, and reports REAL byte counts', async () => {
  const item = await createMedia(adminToken);
  const bytes = Buffer.from('REAL-BYTE-CONTENT-HELLO-WORLD');
  const res = await uploadFile(adminToken, item.id, bytes);
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.item.status, 'ready');
  assert.equal(body.item.sizeBytes, bytes.length, 'size must be the ACTUAL playable byte count');
  assert.equal(body.item.mimeType, 'video/mp4', 'the playable version is always MP4');
  assert.equal(body.item.originalFilename, 'movie.mp4');
  assert.equal(body.item.durationSeconds ?? body.item.duration, 3600, 'duration comes from the FFprobe probe');
  assert.ok(body.item.playableKey, 'a playable key must be assigned');
  assert.ok(isSafeStorageKey(body.item.playableKey));
  assert.ok(body.item.storageKey, 'the retained original gets a storage key');

  const playable = await getMediaStorage().stat(body.item.playableKey);
  assert.ok(playable, 'playable file must exist in storage');
  assert.equal(playable.size, bytes.length);

  const original = await getMediaStorage().stat(body.item.storageKey);
  assert.ok(original, 'retained original must exist in storage');
  assert.equal(original.size, bytes.length);

  // The FFmpeg pipeline ran with the safe argument-array contract: no shell,
  // and the playable MP4 uses faststart.
  const convertCall = fakeCalls.find((args) => args[0] === 'ffmpeg' && !args.includes('-frames:v'));
  assert.ok(convertCall, 'a conversion call must be recorded');
  assert.ok(convertCall.includes('-movflags') && convertCall.includes('+faststart'));
  assert.ok(!convertCall.some((a) => /[;&|`$<>]/.test(a)), 'no shell metacharacters in argv');
  assert.ok(!convertCall.includes('movie.mp4'), 'the user filename never reaches FFmpeg argv');
});

test('4b: MIME resolution falls back to the extension; unknown types are rejected', async () => {
  const item = await createMedia(adminToken);

  // Header is octet-stream but the extension is a video → accepted.
  const res1 = await uploadFile(adminToken, item.id, Buffer.from('x'.repeat(64)), {
    filename: 'clip.webm',
    mime: 'application/octet-stream',
  });
  assert.equal(res1.status, 200);

  // A clearly non-video file (no header, unknown extension) → rejected.
  const res2 = await uploadFile(adminToken, item.id, Buffer.from('x'.repeat(64)), {
    filename: 'notes.txt',
    mime: '',
  });
  assert.equal(res2.status, 400);
  const body2 = await json(res2);
  assert.equal(body2.error.code, 'VALIDATION_ERROR');

  // A non-video MIME header is not trusted.
  const res3 = await uploadFile(adminToken, item.id, Buffer.from('x'.repeat(64)), {
    filename: 'movie.mp4',
    mime: 'text/html',
  });
  assert.equal(res3.status, 200, 'video/* from the extension wins over a bogus header');
});

test('4c: oversized uploads are rejected up front (413 MEDIA_TOO_LARGE)', async () => {
  const missing = await call(adminToken, 'POST', '/api/admin/media/no-such-id/upload/start', {
    body: { totalBytes: 64 },
    headers: { 'x-filename': encodeURIComponent('movie.mp4'), 'x-mime-type': 'video/mp4' },
  });
  assert.equal(missing.status, 404);

  const item = await createMedia(adminToken);
  const oversized = await call(adminToken, 'POST', `/api/admin/media/${item.id}/upload/start`, {
    body: { totalBytes: 600 * 1024 },
    headers: { 'x-filename': encodeURIComponent('movie.mp4'), 'x-mime-type': 'video/mp4' },
  });
  assert.equal(oversized.status, 413);
  const body = await json(oversized);
  assert.equal(body.error.code, 'MEDIA_TOO_LARGE');

  // The pre-check rejects before any byte is read — the item stays a clean
  // draft with no file reference, ready for a smaller retry.
  const after = await call(adminToken, 'GET', `/api/admin/media/${item.id}`);
  const afterBody = await json(after);
  assert.equal(afterBody.item.status, 'draft');
  assert.equal(afterBody.item.storageKey, null);
});

test('4d: re-upload replaces the playable bytes in place', async () => {
  const item = await createReadyMedia(adminToken);
  const firstKey = item.playableKey;
  const firstSize = item.sizeBytes;

  const res = await uploadFile(adminToken, item.id, Buffer.from('NEW-CONTENT'.repeat(20)));
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.item.playableKey, firstKey, 'playable key is deterministic per item');
  assert.equal(body.item.sizeBytes, 'NEW-CONTENT'.repeat(20).length);

  const stored = await getMediaStorage().read(firstKey);
  assert.ok(stored, 'the playable file still exists');
  const out = Buffer.from(await nodeStreamToBuffer(stored.stream));
  assert.equal(out.toString(), 'NEW-CONTENT'.repeat(20), 'bytes are actually replaced');
  assert.notEqual(body.item.sizeBytes, firstSize);
});

// ─── 5. Published visibility ─────────────────────────────────────────────────

test('5: users only see published + ready media', async () => {
  // Ready + published → visible.
  const visible = await createReadyMedia(adminToken, { published: true, title: 'Visible Movie' });
  // Ready + unpublished → hidden.
  await createReadyMedia(adminToken, { published: false, title: 'Hidden Movie' });
  // Draft (metadata only) → hidden.
  await createMedia(adminToken, { published: true, title: 'Draft Movie' });

  const list = await call(userToken, 'GET', '/api/media');
  assert.equal(list.status, 200);
  const listBody = await json(list);
  const titles = listBody.items.map((m: MediaRow) => m.title);
  assert.ok(titles.includes('Visible Movie'));
  assert.ok(!titles.includes('Hidden Movie'));
  assert.ok(!titles.includes('Draft Movie'));

  // Detail: visible item resolves, hidden items 404.
  const okDetail = await call(userToken, 'GET', `/api/media/${visible.id}`);
  assert.equal(okDetail.status, 200);

  const hidden = db.prepare(`SELECT id FROM media WHERE title = 'Hidden Movie'`).get() as { id: string };
  const hiddenDetail = await call(userToken, 'GET', `/api/media/${hidden.id}`);
  assert.equal(hiddenDetail.status, 404, 'unpublished media must 404 for users');

  const draft = db.prepare(`SELECT id FROM media WHERE title = 'Draft Movie'`).get() as { id: string };
  const draftDetail = await call(userToken, 'GET', `/api/media/${draft.id}`);
  assert.equal(draftDetail.status, 404, 'non-ready media must 404 for users');
});

test('5b: admin sees everything through admin endpoints', async () => {
  const list = await call(adminToken, 'GET', '/api/admin/media');
  assert.equal(list.status, 200);
  const body = await json(list);
  assert.ok(body.items.length >= 4, 'admin sees drafts, unpublished, and published items');
  const statuses = new Set(body.items.map((m: MediaRow) => m.status));
  assert.ok(statuses.has('draft'));
  assert.ok(statuses.has('ready'));
});

// ─── 6. Search ───────────────────────────────────────────────────────────────

test('6: search matches title and description, case-insensitively', async () => {
  await createReadyMedia(adminToken, { published: true, title: 'Summer Party Reel', description: 'Great vibes from the beach.' });
  await createReadyMedia(adminToken, { published: true, title: 'Winter Trip', description: 'A recap nobody reads.' });

  const byTitle = await json(await call(userToken, 'GET', '/api/media?q=SUMMER'));
  const titles1 = byTitle.items.map((m: MediaRow) => m.title);
  assert.ok(titles1.includes('Summer Party Reel'));
  assert.ok(!titles1.includes('Winter Trip'));

  const byDesc = await json(await call(userToken, 'GET', '/api/media?q=recap'));
  const titles2 = byDesc.items.map((m: MediaRow) => m.title);
  assert.ok(titles2.includes('Winter Trip'));

  const none = await json(await call(userToken, 'GET', '/api/media?q=zzzzz'));
  assert.equal(none.total, 0);
  assert.equal(none.items.length, 0);
});

test('6b: admin search works the same and covers drafts', async () => {
  await createMedia(adminToken, { title: 'Secret Draft Item' });
  const res = await call(adminToken, 'GET', '/api/admin/media?q=secret%20draft');
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.total, 1);
  assert.equal(body.items[0].title, 'Secret Draft Item');
});

test('6c: pagination is enforced and reported', async () => {
  for (let i = 0; i < 5; i++) {
    await createReadyMedia(adminToken, { published: true, title: `Paged Movie ${i}` });
  }
  const page1 = await json(await call(userToken, 'GET', '/api/media?q=Paged&page=1&pageSize=2'));
  assert.equal(page1.items.length, 2);
  assert.equal(page1.total, 5);
  assert.equal(page1.page, 1);
  assert.equal(page1.hasMore, true);

  const page3 = await json(await call(userToken, 'GET', '/api/media?q=Paged&page=3&pageSize=2'));
  assert.equal(page3.items.length, 1);
  assert.equal(page3.hasMore, false);

  const invalid = await call(userToken, 'GET', '/api/media?page=0&pageSize=1000');
  assert.equal(invalid.status, 400);
});

// ─── 7. Download authorization + HTTP Range streaming ────────────────────────

test('7: users can download published + ready + downloadAllowed media', async () => {
  const allowed = await createReadyMedia(adminToken, {
    published: true,
    downloadAllowed: true,
    title: 'Downloadable Movie',
  });
  const res = await call(userToken, 'GET', `/api/media/${allowed.id}/download`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'video/mp4');
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(bytes.toString(), 'FAKE-VIDEO-BYTES-0123456789');

  // A user's response never leaks storage bookkeeping.
  const detail = await json(await call(userToken, 'GET', `/api/media/${allowed.id}`));
  assert.ok(!('storageKey' in detail.item));
  assert.ok(!('playableKey' in detail.item));
  assert.ok(!('posterKey' in detail.item));
});

test('7b: download is blocked when downloadAllowed is false', async () => {
  const locked = await createReadyMedia(adminToken, {
    published: true,
    downloadAllowed: false,
    title: 'Locked Movie',
  });
  const res = await call(userToken, 'GET', `/api/media/${locked.id}/download`);
  assert.equal(res.status, 403);
  const body = await json(res);
  assert.equal(body.error.code, 'FORBIDDEN');
});

test('7c: unpublished or non-ready media is not downloadable by users', async () => {
  const unpublished = await createReadyMedia(adminToken, { published: false, title: 'Offline Movie' });
  const hiddenRes = await call(userToken, 'GET', `/api/media/${unpublished.id}/download`);
  assert.equal(hiddenRes.status, 404);

  const draft = await createMedia(adminToken, { published: true, title: 'No File Movie' });
  const draftRes = await call(userToken, 'GET', `/api/media/${draft.id}/download`);
  assert.equal(draftRes.status, 404);
});

test('7d: admin download policy covers unpublished media', async () => {
  const unpublished = await createReadyMedia(adminToken, { published: false, title: 'Admin Only Movie' });
  const res = await call(adminToken, 'GET', `/api/media/${unpublished.id}/download`);
  assert.equal(res.status, 200);
});

test('7e: HTTP Range requests return 206 with correct slices (seek works)', async () => {
  const item = await createReadyMedia(adminToken, { published: true, title: 'Range Movie' });
  const full = 'FAKE-VIDEO-BYTES-0123456789';
  const size = full.length;

  const res = await call(userToken, 'GET', `/api/media/${item.id}/download`, {
    headers: { Range: 'bytes=0-3' },
  });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), `bytes 0-3/${size}`);
  assert.equal(res.headers.get('content-length'), '4');
  const slice = Buffer.from(await res.arrayBuffer()).toString();
  assert.equal(slice, full.slice(0, 4));

  // Suffix range.
  const suffix = await call(userToken, 'GET', `/api/media/${item.id}/download`, {
    headers: { Range: 'bytes=-5' },
  });
  assert.equal(suffix.status, 206);
  assert.equal(Buffer.from(await suffix.arrayBuffer()).toString(), full.slice(-5));

  // Unsatisfiable range → 416 with the full-size Content-Range.
  const tooFar = await call(userToken, 'GET', `/api/media/${item.id}/download`, {
    headers: { Range: 'bytes=999999-' },
  });
  assert.equal(tooFar.status, 416);
  assert.equal(tooFar.headers.get('content-range'), `bytes */${size}`);
});

test('7f: HEAD answers with headers only (Content-Length + Accept-Ranges)', async () => {
  const item = await createReadyMedia(adminToken, { published: true, title: 'Head Movie' });
  const full = 'FAKE-VIDEO-BYTES-0123456789';

  const res = await call(userToken, 'HEAD', `/api/media/${item.id}/download`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-length'), String(full.length));
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.equal(res.headers.get('content-type'), 'video/mp4');
  assert.equal(await res.text(), '', 'HEAD must not return a body');

  const ranged = await call(userToken, 'HEAD', `/api/media/${item.id}/download`, {
    headers: { Range: 'bytes=10-14' },
  });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('content-range'), `bytes 10-14/${full.length}`);
  assert.equal(ranged.headers.get('content-length'), '5');
});

// ─── 8. Edit / publish / unpublish / delete ─────────────────────────────────

test('8: admin edits metadata and publish/unpublish flips visibility', async () => {
  const item = await createReadyMedia(adminToken, { published: false, title: 'Editable Movie' });

  const patched = await call(adminToken, 'PATCH', `/api/admin/media/${item.id}`, {
    body: { title: 'Editable Movie v2', description: 'Edited description.', downloadAllowed: false },
  });
  assert.equal(patched.status, 200);
  const patchedBody = await json(patched);
  assert.equal(patchedBody.item.title, 'Editable Movie v2');
  assert.equal(patchedBody.item.description, 'Edited description.');
  assert.equal(patchedBody.item.downloadAllowed, false);

  // Unpublished → users cannot see it.
  const hidden = await call(userToken, 'GET', `/api/media/${item.id}`);
  assert.equal(hidden.status, 404);

  // Publish → users can see it.
  const pub = await call(adminToken, 'POST', `/api/admin/media/${item.id}/publish`);
  assert.equal(pub.status, 200);
  assert.equal((await json(pub)).item.published, true);
  const visible = await call(userToken, 'GET', `/api/media/${item.id}`);
  assert.equal(visible.status, 200);

  // Unpublish → hidden again.
  const unpub = await call(adminToken, 'POST', `/api/admin/media/${item.id}/unpublish`);
  assert.equal(unpub.status, 200);
  assert.equal((await json(unpub)).item.published, false);
  const hiddenAgain = await call(userToken, 'GET', `/api/media/${item.id}`);
  assert.equal(hiddenAgain.status, 404);
});

test('8b: users can never modify media', async () => {
  const item = await createReadyMedia(adminToken, { published: true });
  for (const [method, url, body] of [
    ['PATCH', `/api/admin/media/${item.id}`, { title: 'Hacked' }],
    ['DELETE', `/api/admin/media/${item.id}`, undefined],
    ['POST', `/api/admin/media/${item.id}/publish`, undefined],
    ['POST', `/api/admin/media/${item.id}/unpublish`, undefined],
    ['POST', `/api/admin/media/${item.id}/upload/start`, { totalBytes: 10 }],
    ['DELETE', `/api/admin/media/${item.id}/upload/some-session`, undefined],
    ['POST', '/api/admin/media', { title: 'Hacked' }],
  ] as const) {
    const res = await call(userToken, method, url, body !== undefined ? { body } : {});
    assert.equal(res.status, 403, `${method} ${url} as user should be 403`);
  }

  // User endpoints simply do not expose mutations.
  const noRoute = await call(userToken, 'PATCH', `/api/media/${item.id}`, { body: { title: 'Hacked' } });
  assert.equal(noRoute.status, 404);
});

test('8c: delete removes the row and the stored files', async () => {
  const item = await createReadyMedia(adminToken, { title: 'Doomed Movie' });
  const keys = [item.storageKey, item.playableKey, item.posterKey].filter(Boolean);
  const res = await call(adminToken, 'DELETE', `/api/admin/media/${item.id}`);
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.ok, true);

  const row = db.prepare('SELECT id FROM media WHERE id = ?').get(item.id);
  assert.equal(row, undefined, 'row must be deleted');
  for (const key of keys) {
    assert.equal(await getMediaStorage().exists(key), false, `file ${key} must be deleted`);
  }

  const again = await call(adminToken, 'DELETE', `/api/admin/media/${item.id}`);
  assert.equal(again.status, 404);
});

test('8d: admin cannot modify media that does not exist', async () => {
  const res = await call(adminToken, 'PATCH', '/api/admin/media/nope', { body: { title: 'x' } });
  assert.equal(res.status, 404);
  const pub = await call(adminToken, 'POST', '/api/admin/media/nope/publish');
  assert.equal(pub.status, 404);
});

// ─── 9. Storage path safety ──────────────────────────────────────────────────

test('9: LocalDiskStorage rejects traversal keys and keeps writes in root', async () => {
  const storage = new LocalDiskStorage(path.join(TMP_ROOT, 'safe-root'));
  const evilKeys = [
    '../escape.txt',
    '..\\escape.txt',
    '..',
    'a/b',
    'a\\b',
    '/etc/passwd',
    'C:\\windows\\system32',
    '',
    'a'.repeat(MAX_STORAGE_KEY_LENGTH + 1),
    '.hidden',
    '..hidden',
  ];
  for (const key of evilKeys) {
    assert.equal(isSafeStorageKey(key), false, `key should be unsafe: ${JSON.stringify(key)}`);
    await assert.rejects(() => storage.write(key, ReadableFrom(Buffer.from('x'))), /Unsafe storage key/);
    await assert.rejects(() => storage.read(key));
    await assert.rejects(() => storage.delete(key));
  }

  // A legit key round-trips and never escapes.
  const key = 'm-abc123-x.mp4';
  assert.equal(isSafeStorageKey(key), true);
  await storage.write(key, ReadableFrom(Buffer.from('hello-storage')));
  assert.equal((await storage.stat(key))?.size, 'hello-storage'.length);
  const read = await storage.read(key);
  const out = Buffer.from(await nodeStreamToBuffer(read!.stream));
  assert.equal(out.toString(), 'hello-storage');
  assert.equal(await storage.exists(key), true);

  // Range read.
  const part = await storage.read(key, { start: 0, end: 4 });
  const partBuf = Buffer.from(await nodeStreamToBuffer(part!.stream));
  assert.equal(partBuf.toString(), 'hello');

  await storage.delete(key);
  assert.equal(await storage.exists(key), false);
  assert.equal(await storage.read(key), null);
  assert.equal(await storage.stat(key), null);
});

function ReadableFrom(buf: Buffer): Readable {
  return Readable.from([buf]);
}

async function nodeStreamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

// ─── 10. Filename + range unit safety ────────────────────────────────────────

test('10: sanitizeOriginalFilename strips paths and control characters', () => {
  assert.equal(sanitizeOriginalFilename('..\\..\\evil.mp4'), 'evil.mp4');
  assert.equal(sanitizeOriginalFilename('../../evil.mp4'), 'evil.mp4');
  assert.equal(sanitizeOriginalFilename('C:\\Users\\x\\clip.mov'), 'clip.mov');
  assert.equal(sanitizeOriginalFilename('trail\u0000ing.mp4'), 'trailing.mp4');
  assert.equal(sanitizeOriginalFilename(''), null);
  assert.equal(sanitizeOriginalFilename('..'), null);
  assert.equal(sanitizeOriginalFilename('x'.repeat(500))?.length, 200);
});

test('10b: parseRange handles full, suffix, open-ended, and unsatisfiable ranges', () => {
  assert.equal(parseRange(undefined, 100), null);
  assert.deepEqual(parseRange('bytes=0-3', 100), { start: 0, end: 3 });
  assert.deepEqual(parseRange('bytes=95-', 100), { start: 95, end: 99 });
  assert.deepEqual(parseRange('bytes=-5', 100), { start: 95, end: 99 });
  assert.deepEqual(parseRange('bytes=0-0', 1), { start: 0, end: 0 });
  assert.deepEqual(parseRange('bytes=0-999', 100), { start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=100-', 100), { error: 'unsatisfiable' });
  assert.deepEqual(parseRange('bytes=10-5', 100), { error: 'unsatisfiable' });
  assert.equal(parseRange('bytes=0-1,5-9', 100), null, 'multi-range is ignored');
  assert.equal(parseRange('chunks=0-1', 100), null, 'non-bytes unit is ignored');
});

// ─── 11. Honest empty library ────────────────────────────────────────────────

test('11: a fresh library reports an empty page — no fake media', async () => {
  const res = await call(userToken, 'GET', '/api/media?q=zzz-does-not-exist');
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.items.length, 0);
  assert.equal(body.total, 0);
  assert.equal(body.hasMore, false);
});

test('12: conversion temp directory never accumulates pipeline artifacts', async () => {
  const dir = conversionTempDir();
  let leftovers = 0;
  try {
    leftovers = fs.readdirSync(dir).length;
  } catch {
    // no directory at all is fine
  }
  assert.equal(leftovers, 0, 'no source/playable/poster temp files may survive a run');
});
