// Live multi-GB test driver (manual, NOT part of npm test).
// Pure HTTP against a running server. Requirements:
//   BASE_URL        server base (default http://127.0.0.1:4000)
//   SESSION_COOKIE  full cookie value, e.g. "praconnect-session=..."
//   UPLOAD_FILE     path to the multi-GB MP4
//   STORAGE_ROOT    media storage dir (default uploads/library)
//   SERVER_PID      server process id (for RSS sampling)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4000';
const COOKIE = process.env.SESSION_COOKIE ?? '';
const FILE = process.env.UPLOAD_FILE ?? '';
const STORAGE_ROOT = process.env.STORAGE_ROOT ?? 'uploads/library';
const SERVER_PID = process.env.SERVER_PID ?? '';
const CHUNK = 8 * 1024 * 1024;

const log = (msg) => console.log(`[driver] ${msg}`);
const fail = (msg) => {
  console.error(`[driver] FAIL: ${msg}`);
  process.exit(1);
};

function rssMiB() {
  try {
    const out = execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `(Get-Process -Id ${SERVER_PID} -ErrorAction Stop).WorkingSet64`],
      { encoding: 'utf8', windowsHide: true }
    ).trim();
    return Number(out) / (1024 * 1024);
  } catch {
    return NaN;
  }
}

async function api(method, urlPath, opts = {}) {
  const headers = { cookie: COOKIE, ...(opts.headers ?? {}) };
  const init = { method, headers, redirect: 'follow' };
  if (opts.rawBody !== undefined) {
    init.body = opts.rawBody;
    headers['content-length'] = String(opts.rawBody.length);
  } else if (opts.json !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(opts.json);
  }
  const res = await fetch(BASE + urlPath, init);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, headers: res.headers, body };
}

async function waitForReady(id, timeoutMs = 15 * 60 * 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await api('GET', `/api/admin/media/${id}`);
    if (r.status !== 200) fail(`poll item status ${r.status}`);
    const st = r.body.item.status;
    if (st === 'ready') return r.body.item;
    if (st === 'failed') fail('conversion failed');
    await new Promise((res) => setTimeout(res, 2000));
  }
  fail('timed out waiting for ready');
}

const fileSize = fs.statSync(FILE).size;
log(`file: ${FILE} (${(fileSize / 1e9).toFixed(2)} GB, ${fileSize} bytes)`);

const samples = [];
const sampler = setInterval(() => {
  const m = rssMiB();
  if (Number.isFinite(m)) samples.push(m);
}, 2000);

// 1. Create metadata + publish.
const created = await api('POST', '/api/admin/media', {
  json: { title: 'LIVE MULTI-GB TEST', description: 'real 5 GiB upload validation', downloadAllowed: true, published: true },
});
if (created.status !== 201) fail(`create media ${created.status}: ${JSON.stringify(created.body)}`);
const id = created.body.item.id;
log(`media created: ${id}`);

// 2. Start the chunked upload session.
const started = await api('POST', `/api/admin/media/${id}/upload/start`, {
  json: { totalBytes: fileSize, chunkSize: CHUNK },
  headers: { 'x-filename': encodeURIComponent('multigb-5g.mp4'), 'x-mime-type': 'video/mp4' },
});
if (started.status !== 200) fail(`start session ${started.status}: ${JSON.stringify(started.body)}`);
const session = started.body.session;
const uploadId = session.id;
const chunkCount = session.chunkCount;
log(`session ${uploadId}: ${chunkCount} chunks @ ${CHUNK / 1024 / 1024} MiB`);

// 3. Upload chunks with a simulated interruption at ~40%.
const fd = fs.openSync(FILE, 'r');
const buf = Buffer.alloc(CHUNK);
const abortAt = Math.floor(chunkCount * 0.4);
let sent = 0;
let aborted = false;
for (let i = 0; i < chunkCount; i++) {
  const want = Math.min(CHUNK, fileSize - i * CHUNK);
  const got = fs.readSync(fd, buf, 0, want, i * CHUNK);
  if (got !== want) fail(`short read at chunk ${i}`);
  const r = await api('PUT', `/api/admin/media/${id}/upload/${uploadId}/chunks/${i}`, { rawBody: buf.subarray(0, got) });
  if (r.status !== 200) fail(`chunk ${i} -> ${r.status}: ${JSON.stringify(r.body)}`);
  sent += got;
  if (!aborted && i === abortAt) {
    log(`simulating interruption after chunk ${i} (${sent} bytes)`);
    aborted = true;
    break;
  }
  if (i % 64 === 0) log(`chunk ${i}/${chunkCount} (${(sent / 1e9).toFixed(2)} GB)`);
}

// 4. Resume: ask the server what is missing, then re-send only that.
const resume = await api('GET', `/api/admin/media/${id}/upload/${uploadId}`);
if (resume.status !== 200) fail(`resume fetch ${resume.status}`);
const missing = resume.body.session.missingChunks;
log(`server reports ${missing.length} missing chunks (aborted after ${abortAt})`);
if (missing.length !== chunkCount - abortAt - 1) fail(`missing set wrong: ${missing.length} != ${chunkCount - abortAt - 1}`);
for (let i = 0; i <= abortAt; i++) {
  if (missing.includes(i)) fail(`chunk ${i} was wrongly reported missing`);
}
let resumedBytes = 0;
for (let i = 0; i < chunkCount; i++) {
  if (!missing.includes(i)) continue;
  const want = Math.min(CHUNK, fileSize - i * CHUNK);
  const got = fs.readSync(fd, buf, 0, want, i * CHUNK);
  if (got !== want) fail(`short read on resume chunk ${i}`);
  const r = await api('PUT', `/api/admin/media/${id}/upload/${uploadId}/chunks/${i}`, { rawBody: buf.subarray(0, got) });
  if (r.status !== 200) fail(`resume chunk ${i} -> ${r.status}: ${JSON.stringify(r.body)}`);
  resumedBytes += got;
}
log(`resumed ${resumedBytes} bytes; total sent ${sent + resumedBytes} (expected ${fileSize})`);
fs.closeSync(fd);
if (sent + resumedBytes !== fileSize) fail('byte total mismatch after resume');

// 5. Complete → server assembles, validates, converts.
const done = await api('POST', `/api/admin/media/${id}/upload/${uploadId}/complete`);
if (done.status !== 200) fail(`complete ${done.status}: ${JSON.stringify(done.body)}`);
log('complete accepted — conversion running');
const item = await waitForReady(id);
log(`ready: playableKey=${item.playableKey} duration=${item.duration}s size=${item.sizeBytes}`);

// 6. Verify the playable file with ffprobe.
const playablePath = path.join(STORAGE_ROOT, item.playableKey);
if (!fs.existsSync(playablePath)) fail(`playable missing at ${playablePath}`);
const probe = execFileSync(
  'ffprobe',
  ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,codec_type', '-of', 'json', playablePath],
  { encoding: 'utf8', windowsHide: true }
);
const probeInfo = JSON.parse(probe);
log(`ffprobe duration=${probeInfo.format.duration}s streams=${JSON.stringify(probeInfo.streams)}`);
const playableSize = fs.statSync(playablePath).size;

// 7. Range streaming (early playback + mid-file seek) as a normal user would.
const head = await api('GET', `/api/media/${id}/download`, { headers: { Range: 'bytes=0-1023' } });
if (head.status !== 206) fail(`range head ${head.status}`);
const cr = head.headers.get('content-range') ?? '';
if (!cr.startsWith(`bytes 0-1023/`)) fail(`bad content-range: ${cr}`);
const mid = Math.floor(playableSize / 2);
const seek = await api('GET', `/api/media/${id}/download`, { headers: { Range: `bytes=${mid}-${mid + 1023}` } });
if (seek.status !== 206) fail(`range seek ${seek.status}`);
if (!seek.headers.get('content-range').startsWith(`bytes ${mid}-${mid + 1023}/`)) fail('bad seek content-range');

// 8. Full download — stream to disk, compare byte count.
const dlRes = await fetch(`${BASE}/api/media/${id}/download`, { headers: { cookie: COOKIE } });
if (dlRes.status !== 200) fail(`full download ${dlRes.status}`);
const dlLength = Number(dlRes.headers.get('content-length'));
const dlTarget = path.join(path.dirname(FILE), 'multigb-downloaded.mp4');
await new Promise((resolve, reject) => {
  const ws = fs.createWriteStream(dlTarget);
  dlRes.body.pipe(ws);
  ws.on('finish', resolve);
  ws.on('error', reject);
});
const dlSize = fs.statSync(dlTarget).size;
log(`download: content-length=${dlLength} written=${dlSize} (playable=${playableSize})`);
if (dlLength !== playableSize || dlSize !== playableSize) fail('download byte mismatch');

// 9. RSS report.
clearInterval(sampler);
const peak = Math.max(...samples);
const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
log(`server RSS: peak ${peak.toFixed(0)} MiB, avg ${avg.toFixed(0)} MiB over ${samples.length} samples (file was ${(fileSize / 1e9).toFixed(2)} GB)`);
if (peak > 2048) fail('server RSS exceeded 2 GiB — whole file likely buffered');

// 10. Cleanup: delete the item; verify storage objects are gone.
const del = await api('DELETE', `/api/admin/media/${id}`);
if (del.status !== 200) fail(`delete ${del.status}`);
const gone = await api('GET', `/api/admin/media/${id}`);
if (gone.status !== 404) fail('item still exists after delete');
for (const key of [item.storageKey, item.playableKey, item.posterKey].filter(Boolean)) {
  if (fs.existsSync(path.join(STORAGE_ROOT, key))) fail(`storage object survived delete: ${key}`);
}
log(`deleted ${id}; storage objects removed (${item.storageKey}, ${item.playableKey}, ${item.posterKey})`);
fs.unlinkSync(dlTarget);

console.log('[driver] ALL LIVE CHECKS PASSED');
