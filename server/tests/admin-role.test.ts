// server/tests/admin-role.test.ts
// Phase A/D: Multi-admin authorization + Admin/User role separation.
// Tests ADMIN_EMAILS parsing, case/whitespace normalization, single-admin fallback,
// idempotency, existing admin preservation, requireAdmin middleware,
// /api/auth/me response, and admin media endpoint access for Admin A and Admin B.
//
// Run: npx tsx --test server/tests/admin-role.test.ts
//
// NOTE: env vars must be set BEFORE the modules are imported — this file
// uses dynamic imports on purpose (ESM hoists static imports).

import os from 'node:os';
import path from 'node:path';
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(os.tmpdir(), `praconnect-admin-${process.pid}-${Date.now()}.db`);
process.env.ADMIN_EMAILS = 'sumansourabhj@gmail.com, sumanj15122008@gmail.com';

const { db, bootstrapAdminRole, parseAdminEmails } = await import('../db/index');
const { requireAuth, requireAdmin } = await import('../middleware/auth');
const { sanitizeUser, hashPassword } = await import('../auth/auth');
const { createSession, SESSION_COOKIE_NAME } = await import('../auth/session');
const { createPendingSignup } = await import('../auth/pendingSignup');
const { createApp } = await import('../app');

// ─── Test app: real routes (createApp) + a requireAdmin stub ────────────────

const app = createApp();

const stubApp = new Hono();
stubApp.get('/whoami', requireAuth, (c) => c.json({ user: c.get('user') }));
stubApp.get('/admin-only', requireAdmin, (c) => c.json({ ok: true, user: c.get('user') }));
stubApp.post('/admin-only', requireAdmin, (c) => c.json({ ok: true, user: c.get('user') }));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function seedUser(id: string, name: string, username: string, email: string, passwordHash: string | null = null): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, name, username, email, passwordHash, avatarUrl, emailVerified, role, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, NULL, 1, 'user', ?, ?)`
  ).run(id, name, username, email, passwordHash, now, now);
}

function seedAdmin(id: string, name: string, username: string, email: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, name, username, email, passwordHash, avatarUrl, emailVerified, role, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, NULL, NULL, 1, 'admin', ?, ?)`
  ).run(id, name, username, email, now, now);
}

async function login(userId: string): Promise<string> {
  return createSession(userId);
}

function cookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

async function call(
  target: Hono,
  token: string | null,
  method: string,
  url: string,
  body?: unknown
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers['cookie'] = cookie(token);
  if (body !== undefined) headers['content-type'] = 'application/json';
  return target.request(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ADMIN_A_ID = 'admin-a-id';
const ADMIN_B_ID = 'admin-b-id';
const NORMAL_USER_ID = 'normal-user-id';
const EXISTING_ADMIN_ID = 'pre-existing-admin-id';

let adminAToken: string;
let adminBToken: string;
let normalUserToken: string;
let existingAdminToken: string;

before(async () => {
  seedUser(ADMIN_A_ID, 'Admin A', 'admina', 'sumansourabhj@gmail.com');
  seedUser(ADMIN_B_ID, 'Admin B', 'adminb', 'sumanj15122008@gmail.com', await hashPassword('AdminBPass123'));
  seedUser(NORMAL_USER_ID, 'Normal User', 'normaluser', 'normaluser@example.com');
  seedAdmin(EXISTING_ADMIN_ID, 'Existing Admin', 'existingadmin', 'existing-admin@example.com');

  // The server-side bootstrap promotes the accounts named by ADMIN_EMAILS.
  bootstrapAdminRole();

  adminAToken = await login(ADMIN_A_ID);
  adminBToken = await login(ADMIN_B_ID);
  normalUserToken = await login(NORMAL_USER_ID);
  existingAdminToken = await login(EXISTING_ADMIN_ID);
});

// ─── A & B: ADMIN_EMAILS promotes Admin A and Admin B ────────────────────────

test('A: ADMIN_EMAILS promotes Admin A (sumansourabhj@gmail.com)', () => {
  const row = db.prepare('SELECT role FROM users WHERE id = ?').get(ADMIN_A_ID) as { role: string };
  assert.equal(row.role, 'admin', 'Admin A must have role admin');
});

test('B: ADMIN_EMAILS promotes Admin B (sumanj15122008@gmail.com)', () => {
  const row = db.prepare('SELECT role FROM users WHERE id = ?').get(ADMIN_B_ID) as { role: string };
  assert.equal(row.role, 'admin', 'Admin B must have role admin');
});

// ─── C: Normal user remains user ─────────────────────────────────────────────

test('C: normal user remains user', () => {
  const row = db.prepare('SELECT role FROM users WHERE id = ?').get(NORMAL_USER_ID) as { role: string };
  assert.equal(row.role, 'user', 'normal user must remain role user');
});

// ─── D: ADMIN_EMAIL fallback when ADMIN_EMAILS is missing or empty ───────────

test('D: parseAdminEmails falls back to ADMIN_EMAIL when ADMIN_EMAILS is unset or empty', () => {
  const fallback = parseAdminEmails({ ADMIN_EMAIL: 'fallback@example.com' });
  assert.deepEqual(fallback, ['fallback@example.com']);

  const emptyList = parseAdminEmails({ ADMIN_EMAILS: '  ', ADMIN_EMAIL: 'fallback2@example.com' });
  assert.deepEqual(emptyList, ['fallback2@example.com']);
});

// ─── E: ADMIN_EMAILS precedence ──────────────────────────────────────────────

test('E: parseAdminEmails gives ADMIN_EMAILS precedence over ADMIN_EMAIL', () => {
  const parsed = parseAdminEmails({
    ADMIN_EMAILS: 'primary1@example.com, primary2@example.com',
    ADMIN_EMAIL: 'ignored@example.com',
  });
  assert.deepEqual(parsed, ['primary1@example.com', 'primary2@example.com']);
});

// ─── F: Whitespace normalization ─────────────────────────────────────────────

test('F: parseAdminEmails trims whitespace around comma-separated entries', () => {
  const parsed = parseAdminEmails({
    ADMIN_EMAILS: '  user1@example.com  , \n  user2@example.com \t ,  ',
  });
  assert.deepEqual(parsed, ['user1@example.com', 'user2@example.com']);
});

// ─── G: Case normalization ───────────────────────────────────────────────────

test('G: parseAdminEmails normalizes emails to lowercase (case-insensitive)', () => {
  const parsed = parseAdminEmails({
    ADMIN_EMAILS: 'SUMANSOURABHJ@GMAIL.COM, SumanJ15122008@Gmail.Com',
  });
  assert.deepEqual(parsed, ['sumansourabhj@gmail.com', 'sumanj15122008@gmail.com']);
});

// ─── H: Duplicate config normalization ───────────────────────────────────────

test('H: parseAdminEmails deduplicates repeated configured emails', () => {
  const parsed = parseAdminEmails({
    ADMIN_EMAILS: 'admin@example.com, ADMIN@example.com, admin@example.com',
  });
  assert.deepEqual(parsed, ['admin@example.com']);
});

// ─── I: Unknown configured email does not crash or throw ─────────────────────

test('I: unknown configured email in bootstrap does not crash or throw', () => {
  assert.doesNotThrow(() => {
    bootstrapAdminRole({ ADMIN_EMAILS: 'nonexistent1@example.com, nonexistent2@example.com' });
  });
});

// ─── J: Existing admin not demoted ───────────────────────────────────────────

test('J: existing admin is preserved and not demoted even if omitted from config', () => {
  bootstrapAdminRole({ ADMIN_EMAILS: 'sumansourabhj@gmail.com' });
  const row = db.prepare('SELECT role FROM users WHERE id = ?').get(EXISTING_ADMIN_ID) as { role: string };
  assert.equal(row.role, 'admin', 'Existing admin must remain admin');
});

// ─── K: Bootstrap idempotency ────────────────────────────────────────────────

test('K: bootstrapAdminRole is idempotent', () => {
  const first = bootstrapAdminRole({ ADMIN_EMAILS: 'sumansourabhj@gmail.com, sumanj15122008@gmail.com' });
  const second = bootstrapAdminRole({ ADMIN_EMAILS: 'sumansourabhj@gmail.com, sumanj15122008@gmail.com' });
  assert.deepEqual(first, second);
  const rowA = db.prepare('SELECT role FROM users WHERE id = ?').get(ADMIN_A_ID) as { role: string };
  const rowB = db.prepare('SELECT role FROM users WHERE id = ?').get(ADMIN_B_ID) as { role: string };
  assert.equal(rowA.role, 'admin');
  assert.equal(rowB.role, 'admin');
});

// ─── G1: Login bootstraps the admin role BEFORE the auth response ────────────

test('G1: login promotes a designated admin BEFORE the auth response (DB role=user at request time)', async () => {
  // Reproduce the real-world bug: the account exists with role='user' (it was
  // registered before the ADMIN_EMAILS bootstrap config was live). The login
  // request itself must promote it so the RESPONSE already carries role=admin
  // — the browser never sees role=user.
  db.prepare("UPDATE users SET role = 'user' WHERE id = ?").run(ADMIN_B_ID);

  const res = await call(app, null, 'POST', '/api/auth/login', {
    identifier: 'sumanj15122008@gmail.com',
    password: 'AdminBPass123',
  });
  assert.equal(res.status, 200, 'login must succeed for the configured admin');
  const body = (await res.json()) as { authenticated: boolean; user: { role: string; email: string } };
  assert.equal(body.authenticated, true);
  assert.equal(body.user.email, 'sumanj15122008@gmail.com');
  assert.equal(
    body.user.role,
    'admin',
    'login response must carry role=admin immediately — bootstrap runs BEFORE the response is built'
  );

  const row = db.prepare('SELECT role FROM users WHERE id = ?').get(ADMIN_B_ID) as { role: string };
  assert.equal(row.role, 'admin', 'the users.role row must be promoted during the login request');
});

// ─── G2: OTP email verification bootstraps the admin role BEFORE the response ─

test('G2: OTP email verification promotes a designated admin BEFORE the auth response', async () => {
  // The verify-email (signup activation) path must also promote a configured
  // admin at activation time — not after a restart or a later login.
  const extra = 'otp-promo-admin@example.com';
  const prev = process.env.ADMIN_EMAILS ?? '';
  process.env.ADMIN_EMAILS = `${prev},${extra}`;
  try {
    const otp = await createPendingSignup('OTP Admin', 'otppromoadmin', extra, 'not-a-real-hash');

    const res = await call(app, null, 'POST', '/api/auth/verify-email', { email: extra, otp });
    assert.equal(res.status, 200, 'verify-email must succeed');
    const body = (await res.json()) as { authenticated: boolean; user: { role: string; email: string } };
    assert.equal(body.authenticated, true);
    assert.equal(body.user.email, extra);
    assert.equal(
      body.user.role,
      'admin',
      'verify-email response must carry role=admin immediately — activation promotes configured admins'
    );

    const row = db.prepare('SELECT role FROM users WHERE email = ?').get(extra) as { role: string };
    assert.equal(row.role, 'admin', 'the activated user row must be promoted');
  } finally {
    process.env.ADMIN_EMAILS = prev;
  }
});

// ─── L: Forged role rejected ─────────────────────────────────────────────────

test('L: a forged { role: "admin" } in request body is completely ignored', async () => {
  const res = await call(stubApp, normalUserToken, 'POST', '/admin-only', { role: 'admin' });
  assert.equal(res.status, 403, 'forged role in body must be rejected with 403');

  const whoami = await call(stubApp, normalUserToken, 'GET', '/whoami');
  const body = (await whoami.json()) as { user: { role: string } };
  assert.equal(body.user.role, 'user', 'role must come from DB session');
});

// ─── M: /api/auth/me returns correct roles ───────────────────────────────────

test('M: /api/auth/me returns role="admin" for both admins and role="user" for normal user', async () => {
  const meA = await call(app, adminAToken, 'GET', '/api/auth/me');
  assert.equal(meA.status, 200);
  const bodyA = (await meA.json()) as { authenticated: boolean; user: { role: string; email: string } };
  assert.equal(bodyA.authenticated, true);
  assert.equal(bodyA.user.role, 'admin');
  assert.equal(bodyA.user.email, 'sumansourabhj@gmail.com');

  const meB = await call(app, adminBToken, 'GET', '/api/auth/me');
  assert.equal(meB.status, 200);
  const bodyB = (await meB.json()) as { authenticated: boolean; user: { role: string; email: string } };
  assert.equal(bodyB.authenticated, true);
  assert.equal(bodyB.user.role, 'admin');
  assert.equal(bodyB.user.email, 'sumanj15122008@gmail.com');

  const meNormal = await call(app, normalUserToken, 'GET', '/api/auth/me');
  assert.equal(meNormal.status, 200);
  const bodyNormal = (await meNormal.json()) as { authenticated: boolean; user: { role: string; email: string } };
  assert.equal(bodyNormal.authenticated, true);
  assert.equal(bodyNormal.user.role, 'user');
  assert.equal(bodyNormal.user.email, 'normaluser@example.com');
});

// ─── N & O: Admin A and Admin B can access admin media endpoints ─────────────

test('N+O: Admin A and Admin B have identical privileges and can manage media created by each other', async () => {
  // Admin A lists admin media
  const listA = await call(app, adminAToken, 'GET', '/api/admin/media');
  assert.equal(listA.status, 200);

  // Admin A creates a draft media item
  const createRes = await call(app, adminAToken, 'POST', '/api/admin/media', {
    title: 'Admin A Movie',
    description: 'Created by Admin A',
  });
  assert.equal(createRes.status, 201);
  const created = (await createRes.json()) as { item: { id: string; title: string; createdByUserId: string } };
  const mediaId = created.item.id;
  assert.equal(created.item.createdByUserId, ADMIN_A_ID);

  // Admin B lists admin media and sees the item
  const listB = await call(app, adminBToken, 'GET', '/api/admin/media');
  assert.equal(listB.status, 200);
  const bodyB = (await listB.json()) as { items: Array<{ id: string }> };
  assert.ok(bodyB.items.some((i) => i.id === mediaId), 'Admin B must see Admin A media');

  // Admin B edits metadata of Admin A media
  const patchRes = await call(app, adminBToken, 'PATCH', `/api/admin/media/${mediaId}`, {
    title: 'Updated by Admin B',
  });
  assert.equal(patchRes.status, 200);
  const patched = (await patchRes.json()) as { item: { title: string } };
  assert.equal(patched.item.title, 'Updated by Admin B');

  // Admin B publishes the media
  const pubRes = await call(app, adminBToken, 'POST', `/api/admin/media/${mediaId}/publish`);
  assert.equal(pubRes.status, 200);

  // Admin A unpublishes the media
  const unpubRes = await call(app, adminAToken, 'POST', `/api/admin/media/${mediaId}/unpublish`);
  assert.equal(unpubRes.status, 200);

  // Admin B deletes the media
  const delRes = await call(app, adminBToken, 'DELETE', `/api/admin/media/${mediaId}`);
  assert.equal(delRes.status, 200);
});

// ─── P: Normal user gets 403 on admin media routes ───────────────────────────

test('P: normal user receives 403 on all admin media endpoints', async () => {
  const getRes = await call(app, normalUserToken, 'GET', '/api/admin/media');
  assert.equal(getRes.status, 403);

  const postRes = await call(app, normalUserToken, 'POST', '/api/admin/media', { title: 'Unauthorized' });
  assert.equal(postRes.status, 403);

  const patchRes = await call(app, normalUserToken, 'PATCH', '/api/admin/media/some-id', { title: 'Unauthorized' });
  assert.equal(patchRes.status, 403);

  const delRes = await call(app, normalUserToken, 'DELETE', '/api/admin/media/some-id');
  assert.equal(delRes.status, 403);

  const startRes = await call(app, normalUserToken, 'POST', '/api/admin/media/some-id/upload/start', { totalBytes: 1000 });
  assert.equal(startRes.status, 403);
});

// ─── Q: Unauthenticated gets 401 ─────────────────────────────────────────────

test('Q: unauthenticated requests to admin media receive 401', async () => {
  const getRes = await call(app, null, 'GET', '/api/admin/media');
  assert.equal(getRes.status, 401);

  const postRes = await call(app, null, 'POST', '/api/admin/media', { title: 'Unauthorized' });
  assert.equal(postRes.status, 401);
});