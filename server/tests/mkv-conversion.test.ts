// server/tests/mkv-conversion.test.ts
// Phase 6.9: local MKV upload + server-side FFmpeg conversion.
//
// These tests exercise the FULL conversion pipeline with a fake FFmpeg/FFprobe
// executor injected into the transcode module — no real FFmpeg binary needed,
// and no huge video fixtures are stored in Git. The fake executor records the
// exact argv passed to FFmpeg (asserting the safe argument-array contract) and
// can succeed, fail, or write a partial output before failing.
//
// Run: npx tsx --test server/tests/mkv-conversion.test.ts
//
// NOTE: DATABASE_PATH must be set BEFORE the db module is imported — this
// file uses dynamic imports on purpose (ESM hoists static imports).

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(os.tmpdir(), `praconnect-mkv-${process.pid}-${Date.now()}.db`);
process.env.ROOM_EMPTY_TTL_MS = '60000';
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `praconnect-mkv-uploads-${process.pid}-${Date.now()}`);

const { db } = await import('../db/index');
const { rooms, handleMediaServing, uploadsDir } = await import('../routes/rooms');
const { requireAuth } = await import('../middleware/auth');
const { createSession, SESSION_COOKIE_NAME } = await import('../auth/session');
const { setFfmpegExecutorForTesting } = await import('../uploads/transcode');

const app = new Hono();
app.route('/api/rooms', rooms);
app.use('/api/uploads/*', requireAuth);
app.on(['GET', 'HEAD'], '/api/uploads/:filename', handleMediaServing);

// ─── Fake FFmpeg/FFprobe executor ────────────────────────────────────────────

const fake = {
  convert: 'success' as 'success' | 'failure' | 'partial-failure',
  probeVideo: 'h264',
  probeAudio: 'aac',
  calls: [] as string[][],
};

async function fakeExecutor(args: string[], _timeoutMs: number) {
  fake.calls.push(args);
  const [bin, ...rest] = args;
  if (bin === 'ffprobe') {
    const selIdx = rest.indexOf('-select_streams');
    const selector = rest[selIdx + 1];
    if (selector === 'v:0') return { code: 0, stdout: `${fake.probeVideo}\n`, stderr: '' };
    if (selector === 'a:0') return { code: 0, stdout: `${fake.probeAudio}\n`, stderr: '' };
    return { code: 1, stdout: '', stderr: 'bad probe args' };
  }
  if (bin === 'ffmpeg') {
    const output = args[args.length - 1];
    if (fake.convert === 'success') {
      fs.writeFileSync(output, Buffer.alloc(4096, 0x42));
      return { code: 0, stdout: '', stderr: '' };
    }
    if (fake.convert === 'partial-failure') {
      fs.writeFileSync(output, Buffer.alloc(64, 0x50)); // partial output then crash
    }
    return { code: 1, stdout: '', stderr: 'Conversion failed: invalid data' };
  }
  return { code: 127, stdout: '', stderr: 'no such command' };
}

// ─── Small generated container fixtures (no real videos in Git) ──────────────

function mkvBytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), // EBML magic
    Buffer.from('matroska'.repeat(8)), // DocType string inside the sniff window
    Buffer.alloc(512, 0x11),
  ]);
}

function mp4Bytes(): Buffer {
  return Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(64, 0)]);
}

function movBytes(): Buffer {
  return Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from('ftypqt  '), Buffer.alloc(64, 0)]);
}

function webmBytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), // EBML magic
    Buffer.from('webmwebm'),
    Buffer.alloc(256, 0),
  ]);
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

async function call(token: string, method: string, url: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers['cookie'] = cookie(token);
  if (body !== undefined) headers['content-type'] = 'application/json';
  return app.request(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>;
}

async function upload(
  token: string,
  roomId: string,
  name: string,
  bytes: Buffer | Uint8Array,
  mime: string
): Promise<Response> {
  const form = new FormData();
  form.append('file', new Blob([bytes as any], { type: mime }), name);
  return app.request(`/api/rooms/${roomId}/media/upload`, {
    method: 'POST',
    headers: { cookie: cookie(token) },
    body: form,
  });
}

async function waitFor(cond: () => boolean, ms = 4000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return cond();
}

function sourceRecord(filename: string): { conversionStatus: string; playableFilename: string | null } | undefined {
  return db.prepare('SELECT conversionStatus, playableFilename FROM uploads WHERE filename = ?').get(filename) as
    | { conversionStatus: string; playableFilename: string | null }
    | undefined;
}

function uploadRows(): { filename: string }[] {
  return db.prepare('SELECT filename FROM uploads ORDER BY filename').all() as { filename: string }[];
}

const U = { host: 'mkv-host', member: 'mkv-member' };
let tokens: Record<string, string> = {};
let roomId = '';

before(async () => {
  setFfmpegExecutorForTesting(fakeExecutor);
  for (const [key, id] of Object.entries(U)) {
    seedUser(id, key, key, `${key}@test.dev`);
  }
  for (const [key, id] of Object.entries(U)) {
    tokens[key] = await login(id);
  }
  const created = await call(tokens.host, 'POST', '/api/rooms', { name: 'MKV Movie Night' });
  roomId = ((await json(created)).room as { id: string }).id;
  await call(tokens.member, 'POST', `/api/rooms/${roomId}/join`, {});
});

beforeEach(() => {
  fake.convert = 'success';
  fake.probeVideo = 'h264';
  fake.probeAudio = 'aac';
  fake.calls = [];
});

after(() => {
  db.close();
  fs.rmSync(uploadsDir, { recursive: true, force: true });
});

// ─── H. Valid Matroska container accepted ─────────────────────────────────────

test('H: valid Matroska/MKV upload is accepted and marked for conversion (media not published yet)', async () => {
  const res = await upload(tokens.host, roomId, 'movie.mkv', mkvBytes(), 'video/x-matroska');
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    ok: boolean;
    conversion: { status: string; sourceFilename: string };
    room: { currentMedia: unknown };
  };
  assert.equal(body.ok, true);
  assert.equal(body.conversion.status, 'processing');
  assert.match(body.conversion.sourceFilename, /^media-\d+-[0-9a-f-]{12}\.mkv$/);
  assert.equal(body.room.currentMedia, null, 'the room must not reference the raw MKV yet');

  const source = sourceRecord(body.conversion.sourceFilename);
  assert.ok(source, 'source record must exist');
  assert.ok(
    ['processing', 'ready'].includes(source.conversionStatus),
    `source status must be processing or ready (the fake converter can finish before the query), got ${source.conversionStatus}`
  );
  assert.ok(fs.existsSync(path.join(uploadsDir, body.conversion.sourceFilename)), 'source MKV stored on disk');
});

// ─── I. Fake .mkv rejected (content, not extension) ──────────────────────────

test('I: fake .mkv with invalid content is rejected', async () => {
  const beforeCount = fs.readdirSync(uploadsDir).filter((f) => f.startsWith('media-')).length;
  const res = await upload(tokens.host, roomId, 'fake.mkv', Buffer.from('this is definitely not a matroska file'), 'application/octet-stream');
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { code: string; message: string } };
  assert.equal(body.error.code, 'INVALID_MEDIA_TYPE');
  assert.match(body.error.message, /valid MKV/);

  const afterCount = fs.readdirSync(uploadsDir).filter((f) => f.startsWith('media-')).length;
  assert.equal(afterCount, beforeCount, 'rejected upload must not store a file');
  assert.ok(!fs.readdirSync(uploadsDir).some((f) => f.endsWith('.part')), 'no .part temp file may remain');
});

// ─── J. Zero-byte .mkv rejected ──────────────────────────────────────────────

test('J: zero-byte .mkv upload is rejected', async () => {
  const res = await upload(tokens.host, roomId, 'empty.mkv', new Uint8Array(0), 'video/x-matroska');
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'EMPTY_FILE');
});

// ─── K. Oversized .mkv rejected ──────────────────────────────────────────────

test('K: oversized .mkv upload is rejected and leaves no partial file', async () => {
  process.env.MAX_UPLOAD_BYTES = '1024';
  try {
    const res = await upload(tokens.host, roomId, 'big.mkv', Buffer.concat([mkvBytes(), Buffer.alloc(2048, 0x22)]), 'video/x-matroska');
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'FILE_TOO_LARGE');

    const leftovers = fs.readdirSync(uploadsDir);
    assert.ok(!leftovers.some((f) => f.endsWith('.part')), 'no .part temp file may remain');
  } finally {
    delete process.env.MAX_UPLOAD_BYTES;
  }
});

// ─── L. Interrupted MKV upload cleans up ─────────────────────────────────────

test('L: interrupted MKV upload leaves no partial file', async () => {
  const boundary = 'mkvIntBoundary123';
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="movie.mkv"\r\nContent-Type: video/x-matroska\r\n\r\n`;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(head));
      controller.enqueue(mkvBytes());
      controller.error(new Error('connection interrupted mid-upload'));
    },
  });

  await Promise.resolve(
    app.request(`/api/rooms/${roomId}/media/upload`, {
      method: 'POST',
      headers: { cookie: cookie(tokens.host), 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: stream as any,
      duplex: 'half',
    } as any)
  ).catch(() => null);

  const leftovers = fs.readdirSync(uploadsDir);
  assert.ok(!leftovers.some((f) => f.endsWith('.part')), 'interrupted upload must remove its .part file');
});

// ─── M. Hostile filenames neutralized ────────────────────────────────────────

test('M: hostile .mkv filenames are neutralized to safe generated names', async () => {
  const res = await upload(tokens.host, roomId, '../../evil.mkv', mkvBytes(), 'video/x-matroska');
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; conversion: { sourceFilename: string } };
  assert.equal(body.ok, true);
  assert.ok(!fs.existsSync(path.join(uploadsDir, '..', 'evil.mkv')), 'no file may escape the uploads dir');
  assert.match(body.conversion.sourceFilename, /^media-\d+-[0-9a-f-]{12}\.mkv$/);
  assert.ok(!body.conversion.sourceFilename.includes('..'), 'stored name is safe');
  assert.ok(fs.existsSync(path.join(uploadsDir, body.conversion.sourceFilename)), 'file exists under the safe name');
  // Let the background conversion finish so later tests see a quiet pipeline.
  await waitFor(() => sourceRecord(body.conversion.sourceFilename)?.conversionStatus === 'ready');
});

// ─── N. Host-only authorization ──────────────────────────────────────────────

test('N: only the room host can upload MKV media', async () => {
  const res = await upload(tokens.member, roomId, 'guest.mkv', mkvBytes(), 'video/x-matroska');
  assert.equal(res.status, 403);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'NOT_HOST');
});

// ─── O. Conversion success produces browser-compatible output ────────────────

test('O: MKV conversion success produces a browser-compatible MP4 and publishes it', async () => {
  fake.convert = 'success';
  const res = await upload(tokens.host, roomId, 'success.mkv', mkvBytes(), 'video/x-matroska');
  assert.equal(res.status, 200);
  const sourceName = ((await res.json()) as { conversion: { sourceFilename: string } }).conversion.sourceFilename;

  const ready = await waitFor(() => sourceRecord(sourceName)?.conversionStatus === 'ready');
  assert.ok(ready, 'source conversion must reach ready');

  const sourceRow = sourceRecord(sourceName)!;
  assert.match(sourceRow.playableFilename ?? '', /^media-\d+-[0-9a-f-]{12}\.mp4$/);

  const playable = db
    .prepare('SELECT filename, mimeType, size, sourceFilename, conversionStatus FROM uploads WHERE filename = ?')
    .get(sourceRow.playableFilename) as { filename: string; mimeType: string; size: number; sourceFilename: string; conversionStatus: string };
  assert.ok(playable, 'playable record must exist');
  assert.equal(playable.mimeType, 'video/mp4');
  assert.equal(playable.sourceFilename, sourceName);
  assert.equal(playable.conversionStatus, 'ready');
  assert.equal(playable.size, 4096, 'playable file matches the fake ffmpeg output');
  assert.ok(fs.existsSync(path.join(uploadsDir, playable.filename)), 'playable MP4 stored on disk');

  const detail = (await json(await call(tokens.host, 'GET', `/api/rooms/${roomId}`))).room as {
    currentMedia: { url: string };
  };
  assert.match(detail.currentMedia.url, /^\/api\/uploads\/media-\d+-[0-9a-f-]{12}\.mp4$/);
  assert.ok(!detail.currentMedia.url.toLowerCase().endsWith('.mkv'), 'room never references the raw MKV');

  // The playable file streams with ranges and the right MIME type.
  const head = await app.request(detail.currentMedia.url, { method: 'HEAD', headers: { cookie: cookie(tokens.member) } });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-type'), 'video/mp4');
  assert.equal(head.headers.get('accept-ranges'), 'bytes');
  const range = await app.request(detail.currentMedia.url, {
    method: 'GET',
    headers: { cookie: cookie(tokens.member), range: 'bytes=0-1023' },
  });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), 'bytes 0-1023/4096');

  // The exact argv passed to FFmpeg is safe: no shell, no user strings.
  const ffmpegCall = fake.calls.find((args) => args[0] === 'ffmpeg');
  assert.ok(ffmpegCall, 'ffmpeg must have been invoked');
  assert.ok(ffmpegCall.includes('-movflags') && ffmpegCall.includes('+faststart'), 'fast-start MP4 layout');
  assert.ok(ffmpegCall.includes('libx264'), 'H.264 video');
  assert.ok(ffmpegCall.includes('aac'), 'AAC audio');
  assert.ok(!ffmpegCall.some((arg) => arg.includes('success.mkv')), 'user filenames never reach ffmpeg argv');
});

// ─── P. Conversion failure never publishes unplayable media ──────────────────

test('P: MKV conversion failure does not publish any media', async () => {
  fake.convert = 'failure';
  const rowsBefore = uploadRows().length;
  const res = await upload(tokens.host, roomId, 'fail.mkv', mkvBytes(), 'video/x-matroska');
  assert.equal(res.status, 200);
  const sourceName = ((await res.json()) as { conversion: { sourceFilename: string } }).conversion.sourceFilename;

  const failed = await waitFor(() => sourceRecord(sourceName)?.conversionStatus === 'failed');
  assert.ok(failed, 'source conversion must reach failed');

  // Only the source row was added — a failed conversion never records a
  // playable file. Earlier tests legitimately published media to this room,
  // so the room may still hold an old MP4, but never anything from the
  // failed MKV source.
  assert.equal(uploadRows().length, rowsBefore + 1, 'failed conversion must not create a playable row');
  assert.equal(sourceRecord(sourceName)?.playableFilename, null, 'failed source must not link a playable file');

  const detail = (await json(await call(tokens.host, 'GET', `/api/rooms/${roomId}`))).room as {
    currentMedia: { url: string } | null;
  };
  assert.ok(!detail.currentMedia || !detail.currentMedia.url.toLowerCase().endsWith('.mkv'), 'no unplayable media may be published');
});

// ─── Q. Temporary conversion files are cleaned ───────────────────────────────

test('Q: partial conversion output is cleaned up on failure', async () => {
  fake.convert = 'partial-failure';
  const before = fs.readdirSync(uploadsDir).filter((f) => f.startsWith('media-'));
  const res = await upload(tokens.host, roomId, 'partial.mkv', mkvBytes(), 'video/x-matroska');
  assert.equal(res.status, 200);
  const sourceName = ((await res.json()) as { conversion: { sourceFilename: string } }).conversion.sourceFilename;

  await waitFor(() => sourceRecord(sourceName)?.conversionStatus === 'failed');

  const after = fs.readdirSync(uploadsDir).filter((f) => f.startsWith('media-'));
  assert.deepEqual(
    [...after].sort(),
    [...before, sourceName].sort(),
    'only the source file may remain — partial output must be deleted'
  );
  assert.ok(!fs.readdirSync(uploadsDir).some((f) => f.endsWith('.part')), 'no .part temp file may remain');
});

// ─── R. Room only receives playable media when conversion is ready ───────────

test('R: the room is only given the playable MP4 once conversion completes', async () => {
  fake.convert = 'success';
  const res = await upload(tokens.host, roomId, 'delayed.mkv', mkvBytes(), 'video/x-matroska');
  assert.equal(res.status, 200);
  const sourceName = ((await res.json()) as { conversion: { sourceFilename: string } }).conversion.sourceFilename;

// Immediately after upload: the room may still hold media from earlier tests,
// but never the freshly uploaded MKV source.
const detailNow = (await json(await call(tokens.host, 'GET', `/api/rooms/${roomId}`))).room as {
  currentMedia: { url: string } | null;
};
assert.ok(!detailNow.currentMedia || !detailNow.currentMedia.url.toLowerCase().endsWith('.mkv'), 'room must not reference the raw MKV');

await waitFor(() => sourceRecord(sourceName)?.conversionStatus === 'ready');

// After conversion: the persisted room:update event carries the MP4 URL.
const sourceRow = sourceRecord(sourceName)!;
assert.ok(sourceRow.playableFilename, 'playable file must be linked');
const detail = (await json(await call(tokens.host, 'GET', `/api/rooms/${roomId}`))).room as {
  currentMedia: { url: string };
};
assert.equal(detail.currentMedia.url, `/api/uploads/${sourceRow.playableFilename}`, 'room media is the converted MP4');

  const lastUpdate = db
    .prepare('SELECT payloadJson FROM roomEvents WHERE roomId = ? AND type = ? ORDER BY id DESC LIMIT 1')
    .get(roomId, 'room:update') as { payloadJson: string } | undefined;
  assert.ok(lastUpdate, 'room:update event persisted');
  const parsed = JSON.parse(lastUpdate.payloadJson) as { room: { currentMedia: { url: string } | null } };
  assert.ok(parsed.room.currentMedia, 'latest room:update carries media');
  assert.match(parsed.room.currentMedia.url, /\.mp4$/);
});

// ─── S/T/U. Regression: MP4 / WebM / MOV direct uploads still work ───────────

test('S: existing MP4 upload flow still publishes immediately', async () => {
  const res = await upload(tokens.host, roomId, 'regression.mp4', mp4Bytes(), 'video/mp4');
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; media: { url: string } };
  assert.equal(body.ok, true);
  assert.match(body.media.url, /\.mp4$/);
});

test('T: existing WebM upload flow still publishes immediately', async () => {
  const res = await upload(tokens.host, roomId, 'regression.webm', webmBytes(), 'video/webm');
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; media: { url: string } };
  assert.equal(body.ok, true);
  assert.match(body.media.url, /\.webm$/);
  const head = await app.request(body.media.url, { method: 'HEAD', headers: { cookie: cookie(tokens.member) } });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-type'), 'video/webm');
});

test('U: existing MOV upload flow still publishes immediately when codecs are browser-compatible', async () => {
  fake.probeVideo = 'h264';
  fake.probeAudio = 'aac';
  const res = await upload(tokens.host, roomId, 'regression.mov', movBytes(), 'video/quicktime');
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; media: { url: string } };
  assert.equal(body.ok, true);
  assert.match(body.media.url, /\.mov$/);
  const probeCalls = fake.calls.filter((args) => args[0] === 'ffprobe');
  assert.ok(probeCalls.length >= 2, 'ffprobe must have checked the actual codecs');
});

test('U2: MOV with browser-incompatible codecs is converted instead of published raw', async () => {
  fake.probeVideo = 'vp9'; // not h264 — most browsers cannot play this in a .mov
  fake.probeAudio = 'opus';
  const res = await upload(tokens.host, roomId, 'legacy.mov', movBytes(), 'video/quicktime');
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    conversion?: { status: string; sourceFilename: string };
    media?: { url: string };
    room: { currentMedia: { url: string } | null };
  };
  assert.equal(body.conversion?.status, 'processing', 'incompatible MOV must be converted');
  assert.equal(body.media, undefined, 'raw MOV must not be published in the response');
  assert.ok(body.conversion?.sourceFilename.endsWith('.mov'), 'source MOV stored for conversion');

  const sourceName = body.conversion!.sourceFilename;
  const ready = await waitFor(() => sourceRecord(sourceName)?.conversionStatus === 'ready');
  assert.ok(ready, 'converted MOV becomes ready');

  // The room only ever sees the converted MP4 — never the raw MOV.
  const detail = (await json(await call(tokens.host, 'GET', `/api/rooms/${roomId}`))).room as {
    currentMedia: { url: string };
  };
  assert.equal(detail.currentMedia.url, `/api/uploads/${sourceRecord(sourceName)!.playableFilename}`, 'room receives the converted MP4');
  assert.ok(!detail.currentMedia.url.toLowerCase().endsWith('.mov'), 'raw MOV must never be published');
});

// ─── V. Regression: playback synchronization unchanged ───────────────────────

test('V: playback synchronization still works after conversion is ready', async () => {
  const res = await call(tokens.host, 'POST', `/api/rooms/${roomId}/playback`, {
    isPlaying: true,
    position: 30,
  });
  assert.equal(res.status, 200);
  const room = (await json(res)).room as { playback: { isPlaying: boolean; position: number } };
  assert.equal(room.playback.isPlaying, true);
  assert.equal(room.playback.position, 30);
});