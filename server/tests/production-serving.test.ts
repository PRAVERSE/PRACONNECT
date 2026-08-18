// server/tests/production-serving.test.ts
// Phase 6.7: production static serving, SPA fallback, health/readiness,
// static-file security (traversal, .env, SQLite, uploads), and graceful
// shutdown. Uses temporary fixture directories; all fixtures are removed
// after the suite.
//
// Run: npx tsx --test server/tests/production-serving.test.ts
//
// NOTE: DATABASE_PATH / UPLOADS_DIR must be set BEFORE the db module is
// imported — dynamic imports on purpose (ESM hoists static imports).

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(os.tmpdir(), `praconnect-prod-${process.pid}-${Date.now()}.db`);
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `praconnect-prod-uploads-${process.pid}-${Date.now()}`);
process.env.APP_URL = 'https://app.example.com';

const { db, closeDatabase } = await import('../db/index');
const { createApp } = await import('../app');
const { createShutdownHandler } = await import('../shutdown');
const { isApiPath, safePathSegments, resolveStaticFile } = await import('../static');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SECRET_ENV_CONTENT = 'SECRET_ENV_VALUE=do-not-expose\n';
const SECRET_DB_CONTENT = 'SQLITE-SECRET-BYTES-do-not-expose';

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'praconnect-proddist-'));
const distDir = path.join(rootDir, 'dist');
const secretDir = path.join(rootDir, 'secrets');

before(() => {
  fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(distDir, 'index.html'), '<html><body>SPA ROOT</body></html>');
  fs.writeFileSync(path.join(distDir, 'assets', 'app-hash.js'), 'console.log("asset");');
  fs.writeFileSync(path.join(distDir, 'robots.txt'), 'User-agent: *\nDisallow: /api/\n');

  // Secret files live OUTSIDE dist/ — a vulnerable handler would have to
  // escape dist/ to reach them.
  fs.mkdirSync(secretDir, { recursive: true });
  fs.writeFileSync(path.join(secretDir, '.env'), SECRET_ENV_CONTENT);
  fs.writeFileSync(path.join(secretDir, 'praconnect.db'), SECRET_DB_CONTENT);
});

after(() => {
  try {
    closeDatabase();
  } catch {
    // already closed
  }
  fs.rmSync(rootDir, { recursive: true, force: true });
  fs.rmSync(process.env.UPLOADS_DIR!, { recursive: true, force: true });
});

const app = createApp({ staticDir: distDir });

async function call(method: string, url: string, extraHeaders?: Record<string, string>): Promise<Response> {
  return app.request(url, {
    method,
    headers: extraHeaders ?? {},
  });
}

// ─── Resolver unit tests ──────────────────────────────────────────────────────

test('path classifier: API paths never count as static routes', () => {
  assert.equal(isApiPath('/api'), true);
  assert.equal(isApiPath('/api/rooms'), true);
  assert.equal(isApiPath('/api/nonexistent'), true);
  assert.equal(isApiPath('/api/uploads/x.mp4'), true);
  assert.equal(isApiPath('/room/ABC123'), false);
  assert.equal(isApiPath('/'), false);
});

test('path segmentation rejects traversal, backslashes, and NUL', () => {
  assert.equal(safePathSegments('/..%2fsecrets%2f.env'), null);
  assert.equal(safePathSegments('/%2e%2e/praconnect.db'), null);
  assert.equal(safePathSegments('/..%5c.env'), null);
  assert.equal(safePathSegments('/assets%2f..%2f.env'), null);
  assert.equal(safePathSegments('/%00.env'), null);
  assert.deepEqual(safePathSegments('/assets/app-hash.js'), ['assets', 'app-hash.js']);
});

test('static resolver never escapes dist/ and finds real files', () => {
  assert.equal(resolveStaticFile(distDir, '/..%2fsecrets%2f.env'), null, 'encoded traversal blocked');
  assert.equal(resolveStaticFile(distDir, '/../secrets/.env'), null, 'raw traversal blocked');
  assert.equal(resolveStaticFile(distDir, '/assets/../.env'), null, 'mixed traversal blocked');
  assert.equal(resolveStaticFile(distDir, '/assets/app-hash.js'), path.join(distDir, 'assets', 'app-hash.js'));
  assert.equal(resolveStaticFile(distDir, '/'), path.join(distDir, 'index.html'), 'root resolves to index.html');
  assert.equal(resolveStaticFile(distDir, '/missing-file.xyz'), null);
  assert.equal(resolveStaticFile(distDir, '/assets'), null, 'directories are not served');
});

// ─── A. Health / readiness ────────────────────────────────────────────────────

test('A: /health returns 200 JSON', async () => {
  const res = await call('GET', '/health');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(await res.json(), { ok: true });
});

test('A2: /ready returns 200 while the database is reachable', async () => {
  const res = await call('GET', '/ready');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

// ─── B. Existing API routes remain reachable ─────────────────────────────────

test('B: /api/rooms is still served by the API (auth guard intact)', async () => {
  const res = await call('GET', '/api/rooms');
  assert.equal(res.status, 401);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  const body = await res.json() as { error: { code: string } };
  assert.equal(body.error.code, 'UNAUTHENTICATED');
});

// ─── C. /api/nonexistent never returns index.html ────────────────────────────

test('C: unknown API routes return JSON 404, not the SPA shell', async () => {
  const res = await call('GET', '/api/nonexistent');
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  const body = await res.json() as { error: { code: string } };
  assert.equal(body.error.code, 'NOT_FOUND');
  const text = await call('GET', '/api/nonexistent').then((r) => r.text());
  assert.ok(!text.includes('SPA ROOT'), 'API 404 must not contain index.html');
});

// ─── D. SPA fallback for client routes ───────────────────────────────────────

test('D: browser client routes receive dist/index.html', async () => {
  for (const route of ['/', '/room/ABC123', '/login', '/signup', '/settings']) {
    const res = await call('GET', route);
    assert.equal(res.status, 200, `${route} should be 200`);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    const text = await res.text();
    assert.ok(text.includes('SPA ROOT'), `${route} should serve index.html`);
  }
});

// ─── E. Existing static assets are served directly ───────────────────────────

test('E: static assets are served with correct bytes and content type', async () => {
  const res = await call('GET', '/assets/app-hash.js');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /javascript/);
  assert.equal(await res.text(), 'console.log("asset");');

  const robots = await call('GET', '/robots.txt');
  assert.equal(robots.status, 200);
  assert.match(robots.headers.get('content-type') ?? '', /text\/plain/);
  assert.ok((await robots.text()).includes('Disallow: /api/'));
});

// ─── F. Missing file behavior is deterministic ───────────────────────────────

test('F: missing non-API paths deterministically fall back to the SPA shell', async () => {
  const res = await call('GET', '/no-such-file.xyz');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  assert.ok((await res.text()).includes('SPA ROOT'));
});

// ─── G. Path traversal cannot escape dist/ ───────────────────────────────────

test('G: traversal attempts never expose files outside dist/', async () => {
  const attempts = [
    '/..%2f..%2fsecrets%2f.env',
    '/..%2f..%2fsecrets%2fpraconnect.db',
    '/%2e%2e%2f%2e%2e%2fsecrets%2f.env',
    '/..%2f..%2f..%2fetc%2fpasswd',
  ];
  for (const route of attempts) {
    const res = await call('GET', route);
    assert.ok([200, 404].includes(res.status), `${route} -> ${res.status}`);
    const text = await res.text();
    assert.ok(!text.includes(SECRET_ENV_CONTENT), `${route} must not leak .env`);
    assert.ok(!text.includes(SECRET_DB_CONTENT), `${route} must not leak the database`);
  }
});

test('G2: raw dot-segment paths are normalized away by the URL parser and still safe', async () => {
  const res = await call('GET', '/../secrets/.env');
  const text = await res.text();
  assert.ok(!text.includes(SECRET_ENV_CONTENT), 'raw traversal must not leak .env');
});

// ─── H. Uploads keep the existing authorization path ─────────────────────────

test('H: /api/uploads/* stays behind auth (401 without a session)', async () => {
  const res = await call('GET', '/api/uploads/missing.mp4');
  assert.equal(res.status, 401);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  const body = await res.json() as { error: { code: string } };
  assert.equal(body.error.code, 'UNAUTHENTICATED');
});

// ─── I/J. .env and SQLite files are never served ─────────────────────────────

test('I: /.env is never served — SPA fallback only', async () => {
  const res = await call('GET', '/.env');
  assert.equal(res.status, 200, 'falls back to the SPA shell');
  const text = await res.text();
  assert.ok(!text.includes('SECRET_ENV_VALUE'), 'env content must not be exposed');
});

test('J: /praconnect.db is never served — SPA fallback only', async () => {
  const res = await call('GET', '/praconnect.db');
  assert.equal(res.status, 200, 'falls back to the SPA shell');
  const text = await res.text();
  assert.ok(!text.includes('SQLITE-SECRET-BYTES'), 'database content must not be exposed');
});

// ─── L. Non-GET requests are not SPA-fallback'd ──────────────────────────────

test('L: POST to an unknown non-API path returns JSON 404', async () => {
  const res = await call('POST', '/room/ABC123');
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
});

// ─── M. Static serving stays disabled outside production ─────────────────────

test('M: without production mode or an explicit override, client routes are JSON 404', async () => {
  const devApp = createApp(); // NODE_ENV=test, no staticDir, no STATIC_DIR
  const res = await devApp.request('/room/ABC123');
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
});

// ─── K. Graceful shutdown lifecycle ──────────────────────────────────────────

test('K: shutdown closes the server, runs cleanup once, and guards double calls', async () => {
  const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));

  let cleaned = 0;
  let exited: number | null = null;
  const closed = new Promise<void>((resolve) => server.on('close', () => resolve()));

  const handler = createShutdownHandler(server, {
    cleanup: () => {
      cleaned += 1;
    },
    exit: (code) => {
      exited = code;
    },
    timeoutMs: 2000,
  });

  handler('SIGTERM');
  await closed;
  assert.equal(cleaned, 1, 'cleanup ran exactly once');
  assert.equal(exited, 0, 'clean exit code');

  handler('SIGINT'); // second signal must be a no-op
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(cleaned, 1, 'no duplicate cleanup on double shutdown');
  assert.equal(exited, 0, 'no duplicate exit on double shutdown');
});

test('K2: closing the database is idempotent and /ready reflects it (last test)', async () => {
  // closeDatabase may already be closed by a prior test run — verify both paths.
  closeDatabase();
  assert.equal(db.open, false, 'database closed');
  closeDatabase(); // second call must be a safe no-op
  assert.equal(db.open, false);

  const res = await call('GET', '/ready');
  assert.equal(res.status, 503, '/ready fails once the database is unavailable');
  const body = await res.json() as { ok: boolean };
  assert.equal(body.ok, false);
});